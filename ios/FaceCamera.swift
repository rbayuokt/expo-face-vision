import AVFoundation
import ExpoModulesCore
import UIKit
import Vision

internal struct CameraProps {
  var front = true
  var active = true
  var inferenceFps: Double = 15
  var detection = DetectionOptions()
  var frameStats = false
  var contain = false
}

internal enum CameraEvent {
  case frame, ready, error
}

/**
 Owns the capture session so the view stays a thin UIKit shell and nothing UIKit gets
 released on the capture queues.

 Geometry: the video and photo connections rotate buffers to the interface orientation
 and are never mirrored, so every analysed buffer is upright and un-mirrored for both
 cameras. Vision then runs with `.up` and the Y plane can be read as is. Only the
 preview layer mirrors (front camera); JS mirrors the overlay to match.
 */
internal final class FaceCamera: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  let session = AVCaptureSession()
  weak var previewLayer: AVCaptureVideoPreviewLayer?
  /// Called on the main thread.
  var emit: ((CameraEvent, [String: Any]) -> Void)?

  private let sessionQueue = DispatchQueue(label: "expo.modules.facevision.session")
  private let videoQueue = DispatchQueue(label: "expo.modules.facevision.video", qos: .userInitiated)
  private let videoOutput = AVCaptureVideoDataOutput()
  private let photoOutput = AVCapturePhotoOutput()

  // Session queue.
  private var props = CameraProps()
  private var visible = false
  private var inBackground = false
  private var orientation: UIInterfaceOrientation = .portrait
  private var input: AVCaptureDeviceInput?
  private var configuredPreset: AVCaptureSession.Preset?
  private var outputsAdded = false
  private var reportedDenied = false
  private var photoDelegates: [Int64: PhotoDelegate] = [:]

  // Video queue; `analysis` is written from the session queue under the lock.
  private let lock = NSLock()
  private var analysis = CameraProps()
  private var lastProcessed: CFTimeInterval = 0
  private var readyEmitted = false

  override init() {
    super.init()
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    center.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    center.addObserver(self, selector: #selector(sessionInterrupted(_:)), name: .AVCaptureSessionWasInterrupted, object: session)
    center.addObserver(self, selector: #selector(sessionRuntimeError(_:)), name: .AVCaptureSessionRuntimeError, object: session)
    inBackground = UIApplication.shared.applicationState == .background
  }

  // MARK: - Inputs from the view (main thread)

  func update(props: CameraProps) {
    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      self.props = props
      self.lock.lock()
      self.analysis = props
      self.lock.unlock()
      self.reconcile()
    }
  }

  func update(visible: Bool) {
    sessionQueue.async { [weak self] in
      self?.visible = visible
      self?.reconcile()
    }
  }

  func update(orientation: UIInterfaceOrientation) {
    sessionQueue.async { [weak self] in
      guard let self = self, self.orientation != orientation else { return }
      self.orientation = orientation
      self.orientConnections()
      self.resetReady()
    }
  }

  func shutdown() {
    NotificationCenter.default.removeObserver(self)
    videoOutput.setSampleBufferDelegate(nil, queue: nil)
    sessionQueue.async { [session] in
      if session.isRunning {
        session.stopRunning()
      }
    }
  }

  // MARK: - Session

  private func reconcile() {
    guard props.active && visible && !inBackground else {
      stop()
      return
    }
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      stop()
      if !reportedDenied {
        reportedDenied = true
        send(.error, ["code": "CAMERA_PERMISSION_DENIED", "message": "Camera permission is not granted. Call requestCameraPermissionsAsync() first."])
      }
      return
    }
    reportedDenied = false

    guard configure() else {
      stop()
      return
    }
    if !session.isRunning {
      session.startRunning()
      resetReady()
    }
  }

  private func stop() {
    if session.isRunning {
      session.stopRunning()
    }
  }

  private func configure() -> Bool {
    let position: AVCaptureDevice.Position = props.front ? .front : .back
    let preset: AVCaptureSession.Preset
    switch props.detection.performanceMode {
    case "fast": preset = .vga640x480
    case "accurate": preset = .hd1920x1080
    default: preset = .hd1280x720
    }
    if input?.device.position == position && configuredPreset == preset && outputsAdded {
      return true
    }

    session.beginConfiguration()
    defer {
      session.commitConfiguration()
      resetReady()
    }

    if input?.device.position != position {
      if let old = input {
        session.removeInput(old)
        input = nil
      }
      guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
        let newInput = try? AVCaptureDeviceInput(device: device),
        session.canAddInput(newInput) else {
        send(.error, ["code": "CAMERA_UNAVAILABLE", "message": "No usable \(props.front ? "front" : "back") camera."])
        return false
      }
      session.addInput(newInput)
      input = newInput
    }

    session.sessionPreset = session.canSetSessionPreset(preset) ? preset : .high
    configuredPreset = preset

    if !outputsAdded {
      videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
      videoOutput.alwaysDiscardsLateVideoFrames = true
      videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
      guard session.canAddOutput(videoOutput), session.canAddOutput(photoOutput) else {
        send(.error, ["code": "CAMERA_UNAVAILABLE", "message": "Could not attach the camera outputs."])
        return false
      }
      session.addOutput(videoOutput)
      session.addOutput(photoOutput)
      outputsAdded = true
    }

    // A new input rebuilds the connections, so orientation and mirroring go again.
    orientConnections()
    return true
  }

  private func orientConnections() {
    for connection in [videoOutput.connection(with: .video), photoOutput.connection(with: .video)] {
      guard let connection = connection else { continue }
      FaceCamera.rotate(connection, to: orientation)
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = false
      }
    }
    let orientation = self.orientation
    DispatchQueue.main.async { [weak previewLayer] in
      if let connection = previewLayer?.connection {
        FaceCamera.rotate(connection, to: orientation)
      }
    }
  }

  static func rotate(_ connection: AVCaptureConnection, to orientation: UIInterfaceOrientation) {
    if #available(iOS 17.0, *) {
      let angle: CGFloat
      switch orientation {
      case .landscapeRight: angle = 0
      case .landscapeLeft: angle = 180
      case .portraitUpsideDown: angle = 270
      default: angle = 90
      }
      if connection.isVideoRotationAngleSupported(angle) {
        connection.videoRotationAngle = angle
      }
    } else if connection.isVideoOrientationSupported {
      connection.videoOrientation = AVCaptureVideoOrientation(rawValue: orientation.rawValue) ?? .portrait
    }
  }

  private func resetReady() {
    videoQueue.async { [weak self] in
      self?.readyEmitted = false
    }
  }

  private func send(_ event: CameraEvent, _ payload: [String: Any]) {
    DispatchQueue.main.async { [weak self] in
      self?.emit?(event, payload)
    }
  }

  // MARK: - Lifecycle

  @objc private func didEnterBackground() {
    sessionQueue.async { [weak self] in
      self?.inBackground = true
      self?.reconcile()
    }
  }

  @objc private func willEnterForeground() {
    sessionQueue.async { [weak self] in
      self?.inBackground = false
      self?.reconcile()
    }
  }

  @objc private func sessionInterrupted(_ notification: Notification) {
    let raw = notification.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int
    let reason = raw.flatMap(AVCaptureSession.InterruptionReason.init(rawValue:))
    // Backgrounding is handled above and isn't worth an error.
    if reason == .videoDeviceNotAvailableInBackground {
      return
    }
    send(.error, ["code": "CAMERA_UNAVAILABLE", "message": "The camera was interrupted (reason \(raw ?? -1))."])
  }

  @objc private func sessionRuntimeError(_ notification: Notification) {
    let error = notification.userInfo?[AVCaptureSessionErrorKey] as? AVError
    send(.error, ["code": "CAMERA_UNAVAILABLE", "message": error?.localizedDescription ?? "The camera session failed."])
    if error?.code == .mediaServicesWereReset {
      sessionQueue.async { [weak self] in
        self?.reconcile()
      }
    }
  }

  // MARK: - Frames (video queue)

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let size = CGSize(width: CVPixelBufferGetWidth(buffer), height: CVPixelBufferGetHeight(buffer))
    let frame: [String: Any] = ["width": Double(size.width), "height": Double(size.height)]

    lock.lock()
    let config = analysis
    lock.unlock()

    // The queue is serial and late frames are discarded, so detections never overlap.
    let start = CACurrentMediaTime()
    guard config.inferenceFps > 0, start - lastProcessed >= 1 / config.inferenceFps else { return }
    lastProcessed = start

    // Android fires this on the first analysed frame too.
    if !readyEmitted {
      readyEmitted = true
      send(.ready, ["frame": frame])
    }

    let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .up, options: [:])
    guard var faces = try? FaceDetector.detect(handler: handler, options: config.detection, size: size) else { return }
    if config.frameStats {
      for i in faces.indices {
        if let stats = RegionStatsCalculator.stats(yPlaneOf: buffer, rect: faces[i].bounds) {
          faces[i].dictionary["stats"] = stats
        }
      }
    }

    send(.frame, [
      "faces": faces.map(\.dictionary),
      "frame": frame,
      "mirrored": config.front,
      "timestamp": start * 1000,
      "processingTime": (CACurrentMediaTime() - start) * 1000
    ])
  }

  // MARK: - Photo

  func takePhoto(quality: Double, promise: Promise) {
    sessionQueue.async { [weak self] in
      guard let self = self, self.session.isRunning, self.photoOutput.connection(with: .video) != nil else {
        promise.reject(FaceVisionException(.cameraUnavailable, "The camera is not running."))
        return
      }
      let settings = AVCapturePhotoSettings()
      let id = settings.uniqueID
      let delegate = PhotoDelegate { [weak self] data, error in
        self?.sessionQueue.async {
          self?.photoDelegates[id] = nil
        }
        guard let data = data, let source = CGImageSourceCreateWithData(data as CFData, nil) else {
          promise.reject(FaceVisionException(.cameraUnavailable, "The photo capture failed.", cause: error))
          return
        }
        do {
          // The connection isn't mirrored and the EXIF orientation is baked in here.
          let image = try FaceImageProcessor.decodeUpright(source, nil, maxDimension: nil)
          promise.resolve(try FaceImageProcessor.write(image, png: false, quality: min(max(quality, 0), 1)))
        } catch {
          promise.reject(error)
        }
      }
      self.photoDelegates[id] = delegate
      self.photoOutput.capturePhoto(with: settings, delegate: delegate)
    }
  }
}

private final class PhotoDelegate: NSObject, AVCapturePhotoCaptureDelegate {
  private let completion: (Data?, Error?) -> Void

  init(completion: @escaping (Data?, Error?) -> Void) {
    self.completion = completion
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    completion(error == nil ? photo.fileDataRepresentation() : nil, error)
  }
}

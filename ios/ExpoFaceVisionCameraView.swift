import AVFoundation
import ExpoModulesCore
import UIKit

public final class ExpoFaceVisionCameraView: ExpoView {
  let onFrame = EventDispatcher()
  let onCameraReady = EventDispatcher()
  let onCameraError = EventDispatcher()

  var props = CameraProps()

  private let camera: FaceCamera
  private let previewLayer: AVCaptureVideoPreviewLayer

  public required init(appContext: AppContext? = nil) {
    let camera = FaceCamera()
    self.camera = camera
    previewLayer = AVCaptureVideoPreviewLayer(session: camera.session)
    super.init(appContext: appContext)

    clipsToBounds = true
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
    camera.previewLayer = previewLayer
    camera.emit = { [weak self] event, payload in
      guard let self = self else { return }
      switch event {
      case .frame: self.onFrame(payload)
      case .ready: self.onCameraReady(payload)
      case .error: self.onCameraError(payload)
      }
    }
  }

  deinit {
    camera.shutdown()
  }

  func applyProps() {
    previewLayer.videoGravity = props.contain ? .resizeAspect : .resizeAspectFill
    camera.update(props: props)
  }

  func takePhoto(quality: Double, promise: Promise) {
    camera.takePhoto(quality: quality, promise: promise)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    previewLayer.frame = bounds
    CATransaction.commit()
    // Rotation always relayouts, so this is where the interface orientation is picked up.
    if let orientation = window?.windowScene?.interfaceOrientation, orientation != .unknown {
      camera.update(orientation: orientation)
    }
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    camera.update(visible: window != nil)
  }
}

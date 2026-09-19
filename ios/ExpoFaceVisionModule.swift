import AVFoundation
import ExpoModulesCore

internal struct TakePhotoOptions: Record {
  @Field var quality: Double = 0.9
}

public class ExpoFaceVisionModule: Module {
  // Expo's default async queue is shared by every module; keep the heavy work off it.
  private let processingQueue = DispatchQueue(label: "expo.modules.facevision", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("ExpoFaceVision")

    Function("getCapabilities") { () -> [String: Any] in
      return [
        "platform": "ios",
        "landmarks": FaceDetector.landmarkTypes,
        "contours": FaceDetector.contourTypes,
        "tracking": "library",
        "smileProbability": false,
        "eyeOpenProbability": false,
        "blink": "eye-aspect-ratio",
        // Pitch is iOS 15+, and so is the minimum deployment target.
        "headPose": ["yaw": true, "pitch": true, "roll": true],
        "faceConfidence": true,
        "contoursSingleFaceOnly": false
      ]
    }

    AsyncFunction("getCameraPermissionsAsync") { () -> [String: Any] in
      return Self.permissionResponse()
    }

    AsyncFunction("requestCameraPermissionsAsync") { (promise: Promise) in
      // Asking without the usage string kills the app instead of failing.
      guard Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") != nil else {
        promise.reject(FaceVisionException(.cameraUnavailable, "NSCameraUsageDescription is missing from Info.plist."))
        return
      }
      AVCaptureDevice.requestAccess(for: .video) { _ in
        promise.resolve(Self.permissionResponse())
      }
    }

    AsyncFunction("detectFaces") { (uri: String, options: DetectionOptions) -> [String: Any] in
      return try FaceImageProcessor.detectFaces(uri: uri, options: options)
    }
    .runOnQueue(processingQueue)

    AsyncFunction("analyzeRegion") { (uri: String, rect: RectRecord?) -> [String: Any] in
      return try FaceImageProcessor.analyzeRegion(uri: uri, rect: rect?.cgRect)
    }
    .runOnQueue(processingQueue)

    AsyncFunction("cropFace") { (uri: String, rect: RectRecord, options: CropOptions) -> [String: Any] in
      return try FaceImageProcessor.cropFace(uri: uri, rect: rect.cgRect, options: options)
    }
    .runOnQueue(processingQueue)

    AsyncFunction("alignFace") { (uri: String, rect: RectRecord, leftEye: PointRecord, rightEye: PointRecord, options: CropOptions) -> [String: Any] in
      return try FaceImageProcessor.alignFace(
        uri: uri,
        rect: rect.cgRect,
        leftEye: leftEye.cgPoint,
        rightEye: rightEye.cgPoint,
        options: options
      )
    }
    .runOnQueue(processingQueue)

    View(ExpoFaceVisionCameraView.self) {
      Events("onFrame", "onCameraReady", "onCameraError")

      Prop("facing") { (view: ExpoFaceVisionCameraView, facing: String) in
        view.props.front = facing == "front"
      }

      Prop("active") { (view: ExpoFaceVisionCameraView, active: Bool) in
        view.props.active = active
      }

      Prop("inferenceFps") { (view: ExpoFaceVisionCameraView, fps: Double) in
        view.props.inferenceFps = fps
      }

      Prop("detection") { (view: ExpoFaceVisionCameraView, detection: DetectionOptions) in
        view.props.detection = detection
      }

      Prop("frameStats") { (view: ExpoFaceVisionCameraView, enabled: Bool) in
        view.props.frameStats = enabled
      }

      Prop("resizeMode") { (view: ExpoFaceVisionCameraView, mode: String) in
        view.props.contain = mode == "contain"
      }

      OnViewDidUpdateProps { (view: ExpoFaceVisionCameraView) in
        view.applyProps()
      }

      AsyncFunction("takePhoto") { (view: ExpoFaceVisionCameraView, options: TakePhotoOptions, promise: Promise) in
        view.takePhoto(quality: options.quality, promise: promise)
      }
    }
  }

  private static func permissionResponse() -> [String: Any] {
    let status: String
    let canAskAgain: Bool
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      status = "granted"
      canAskAgain = true
    case .notDetermined:
      status = "undetermined"
      canAskAgain = true
    default:
      status = "denied"
      canAskAgain = false
    }
    return ["status": status, "granted": status == "granted", "canAskAgain": canAskAgain, "expires": "never"]
  }
}

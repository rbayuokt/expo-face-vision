import ExpoModulesCore

internal enum FaceVisionErrorCode: String {
  case invalidUri = "INVALID_URI"
  case fileNotFound = "FILE_NOT_FOUND"
  case invalidImage = "INVALID_IMAGE"
  case detectionFailed = "DETECTION_FAILED"
  case imageWriteFailed = "IMAGE_WRITE_FAILED"
  case invalidArgument = "INVALID_ARGUMENT"
  case cameraUnavailable = "CAMERA_UNAVAILABLE"
  case cameraPermissionDenied = "CAMERA_PERMISSION_DENIED"
}

/**
 Expo's `Exception` derives its code from the class name (`FooException` -> `ERR_FOO`).
 Overriding `code` keeps JS on the stable codes documented in the TS types.
 */
internal final class FaceVisionException: Exception, @unchecked Sendable {
  private let errorCode: String
  private let message: String

  init(_ code: FaceVisionErrorCode, _ message: String, cause: Error? = nil) {
    self.errorCode = code.rawValue
    self.message = message
    super.init()
    self.cause = cause
  }

  override var code: String {
    errorCode
  }

  override var reason: String {
    message
  }
}

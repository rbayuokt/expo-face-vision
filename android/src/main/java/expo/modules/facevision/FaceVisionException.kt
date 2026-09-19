package expo.modules.facevision

import expo.modules.kotlin.exception.CodedException

internal object ErrorCodes {
  const val INVALID_URI = "INVALID_URI"
  const val FILE_NOT_FOUND = "FILE_NOT_FOUND"
  const val INVALID_IMAGE = "INVALID_IMAGE"
  const val DETECTION_FAILED = "DETECTION_FAILED"
  const val IMAGE_WRITE_FAILED = "IMAGE_WRITE_FAILED"
  const val INVALID_ARGUMENT = "INVALID_ARGUMENT"
  const val CAMERA_UNAVAILABLE = "CAMERA_UNAVAILABLE"
  const val CAMERA_PERMISSION_DENIED = "CAMERA_PERMISSION_DENIED"
}

/**
 * CodedException infers its code from the class name (`FooException` -> `ERR_FOO`).
 * Passing the code explicitly keeps JS on the same codes as iOS.
 */
internal class FaceVisionException(
  code: String,
  message: String,
  cause: Throwable? = null
) : CodedException(code, message, cause)

package expo.modules.facevision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import android.os.SystemClock
import androidx.exifinterface.media.ExifInterface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.atan2
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

internal class FaceImageProcessor(
  private val context: Context,
  cacheRoot: File
) {
  private val outputDirectory = outputDirectory(cacheRoot)

  suspend fun detectFaces(uri: String, options: DetectionOptions): Map<String, Any> {
    val start = SystemClock.elapsedRealtime()
    return withInput(uri) { file ->
      val maxSide = when (options.performanceMode) {
        "fast" -> 640
        "accurate" -> null
        else -> 1280
      }
      val (uprightWidth, uprightHeight) = uprightSize(file)
      val bitmap = decodeUpright(file, maxSide)
      try {
        val scale = uprightWidth.toFloat() / bitmap.width
        val faces = detect(bitmap, options)
        mapOf(
          "faces" to faces
            // setMinFaceSize is a hint, not a filter.
            .filter { it.boundingBox.width() * scale / uprightWidth >= options.minFaceSize }
            .map { faceToMap(it, options, scale) },
          "image" to mapOf("width" to uprightWidth, "height" to uprightHeight, "uri" to uri),
          "processingTime" to (SystemClock.elapsedRealtime() - start).toDouble()
        )
      } finally {
        bitmap.recycle()
      }
    }
  }

  fun analyzeRegion(uri: String, rect: RectRecord?): Map<String, Double> = withInput(uri) { file ->
    val bitmap = decodeUpright(file, null)
    try {
      val bounds = if (rect == null) {
        android.graphics.Rect(0, 0, bitmap.width, bitmap.height)
      } else {
        clampRect(rect.x, rect.y, rect.width, rect.height, bitmap.width, bitmap.height)
          ?: throw FaceVisionException(ErrorCodes.INVALID_ARGUMENT, "The region does not overlap the image.")
      }
      regionStats(bounds) { x, y ->
        val c = bitmap.getPixel(x, y)
        0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)
      }
    } finally {
      bitmap.recycle()
    }
  }

  fun cropFace(uri: String, rect: RectRecord, options: CropOptions): Map<String, Any> = withInput(uri) { file ->
    val bitmap = decodeUpright(file, null)
    try {
      render(bitmap, rect, 0.0, options)
    } finally {
      bitmap.recycle()
    }
  }

  fun alignFace(
    uri: String,
    rect: RectRecord,
    leftEye: PointRecord,
    rightEye: PointRecord,
    options: CropOptions
  ): Map<String, Any> {
    val dx = leftEye.x - rightEye.x
    val dy = leftEye.y - rightEye.y
    if (!dx.isFinite() || !dy.isFinite() || hypot(dx, dy) < 1.0) {
      throw FaceVisionException(ErrorCodes.INVALID_ARGUMENT, "The eye points are missing or too close together.")
    }
    // The subject's left eye is on the image's right, so a level face gives 0.
    val rotation = -Math.toDegrees(atan2(dy, dx))
    return withInput(uri) { file ->
      val bitmap = decodeUpright(file, null)
      try {
        render(bitmap, rect, rotation, options) + ("rotation" to rotation)
      } finally {
        bitmap.recycle()
      }
    }
  }

  /**
   * Crops the padded face box out of [source] rotated by [rotation] degrees (clockwise on screen)
   * around the face center. The crop is clamped against the source bounds, so rotated corners
   * that fall outside the source come out black (jpeg) or transparent (png).
   */
  private fun render(source: Bitmap, rect: RectRecord, rotation: Double, options: CropOptions): Map<String, Any> {
    if (!(rect.width > 0 && rect.height > 0 && rect.x.isFinite() && rect.y.isFinite())) {
      throw FaceVisionException(ErrorCodes.INVALID_ARGUMENT, "The face rect must have a positive size.")
    }
    val imageWidth = source.width.toDouble()
    val imageHeight = source.height.toDouble()
    val cx = rect.x + rect.width / 2
    val cy = rect.y + rect.height / 2
    if (cx < 0 || cy < 0 || cx > imageWidth || cy > imageHeight) {
      throw FaceVisionException(ErrorCodes.INVALID_ARGUMENT, "The face rect is outside the image.")
    }

    val padding = max(options.padding, 0.0)
    val width = rect.width * (1 + 2 * padding)
    val height = rect.height * (1 + 2 * padding)
    val left: Int
    val top: Int
    val cropWidth: Int
    val cropHeight: Int
    if (options.square) {
      // Largest square centered on the face that still fits, so the face stays centered.
      val side = minOf(max(width, height), 2 * cx, 2 * (imageWidth - cx), 2 * cy, 2 * (imageHeight - cy))
      cropWidth = max(floor(side).toInt(), 1)
      cropHeight = cropWidth
      left = (cx - cropWidth / 2.0).roundToInt().coerceIn(0, max(source.width - cropWidth, 0))
      top = (cy - cropHeight / 2.0).roundToInt().coerceIn(0, max(source.height - cropHeight, 0))
    } else {
      val bounds = clampRect(cx - width / 2, cy - height / 2, width, height, source.width, source.height)
        ?: throw FaceVisionException(ErrorCodes.INVALID_ARGUMENT, "The face rect is outside the image.")
      left = bounds.left
      top = bounds.top
      cropWidth = bounds.width()
      cropHeight = bounds.height()
    }

    val target = options.outputSize
    val outWidth = target?.width?.roundToInt()?.takeIf { it > 0 } ?: cropWidth
    val outHeight = target?.height?.roundToInt()?.takeIf { it > 0 } ?: cropHeight

    val matrix = Matrix().apply {
      setRotate(rotation.toFloat(), cx.toFloat(), cy.toFloat())
      postTranslate(-left.toFloat(), -top.toFloat())
      postScale(outWidth.toFloat() / cropWidth, outHeight.toFloat() / cropHeight)
    }
    val output = Bitmap.createBitmap(outWidth, outHeight, Bitmap.Config.ARGB_8888)
    try {
      Canvas(output).drawBitmap(source, matrix, Paint(Paint.FILTER_BITMAP_FLAG))
      return writeImage(outputDirectory, output, options.format == "png", options.quality)
    } finally {
      output.recycle()
    }
  }

  private suspend fun detect(bitmap: Bitmap, options: DetectionOptions): List<Face> {
    val detector = FaceDetection.getClient(options.toDetectorOptions())
    try {
      return suspendCancellableCoroutine { continuation ->
        detector.process(InputImage.fromBitmap(bitmap, 0))
          .addOnSuccessListener { continuation.resume(it) }
          .addOnFailureListener { error ->
            continuation.resumeWithException(
              FaceVisionException(ErrorCodes.DETECTION_FAILED, "ML Kit face detection failed: ${error.message}", error)
            )
          }
          .addOnCanceledListener { continuation.cancel() }
      }
    } finally {
      detector.close()
    }
  }

  private inline fun <T> withInput(uri: String, block: (File) -> T): T {
    val input = resolveInput(uri)
    try {
      return block(input.file)
    } finally {
      input.cleanUp()
    }
  }

  private class ResolvedInput(val file: File, private val temporary: Boolean) {
    fun cleanUp() {
      if (temporary) file.delete()
    }
  }

  /**
   * `content://` from a photo picker is not a filesystem path, and BitmapFactory plus
   * ExifInterface both need to read the source, so it lands in a temp file first.
   */
  private fun resolveInput(uri: String): ResolvedInput {
    if (uri.isBlank()) {
      throw FaceVisionException(ErrorCodes.INVALID_URI, "The image URI is empty.")
    }
    val parsed = Uri.parse(uri)

    return when (parsed.scheme) {
      null, "file" -> {
        val path = parsed.path
          ?: throw FaceVisionException(ErrorCodes.INVALID_URI, "'$uri' has no file path.")
        val file = File(path)
        if (!file.exists()) {
          throw FaceVisionException(ErrorCodes.FILE_NOT_FOUND, "No file exists at $path.")
        }
        ResolvedInput(file, temporary = false)
      }

      "content" -> ResolvedInput(copyToCache(parsed), temporary = true)

      else -> throw FaceVisionException(
        ErrorCodes.INVALID_URI,
        "Unsupported URI scheme '${parsed.scheme}'. Use file:// or content://."
      )
    }
  }

  private fun copyToCache(uri: Uri): File {
    ensureOutputDirectory(outputDirectory)
    val target = File(outputDirectory, "input-${UUID.randomUUID()}")
    try {
      val stream = context.contentResolver.openInputStream(uri)
        ?: throw FaceVisionException(ErrorCodes.FILE_NOT_FOUND, "Could not open $uri.")
      stream.use { input ->
        FileOutputStream(target).use { output -> input.copyTo(output) }
      }
    } catch (error: FileNotFoundException) {
      throw FaceVisionException(ErrorCodes.FILE_NOT_FOUND, "Could not open $uri.", error)
    } catch (error: SecurityException) {
      throw FaceVisionException(ErrorCodes.INVALID_URI, "No read permission for $uri.", error)
    } catch (error: IOException) {
      throw FaceVisionException(ErrorCodes.FILE_NOT_FOUND, "Could not read $uri.", error)
    }
    return target
  }

  private fun uprightSize(file: File): Pair<Int, Int> {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw FaceVisionException(ErrorCodes.INVALID_IMAGE, "${file.name} is not a decodable image.")
    }
    return if (exifOrientation(file) in SWAPPED_ORIENTATIONS) {
      bounds.outHeight to bounds.outWidth
    } else {
      bounds.outWidth to bounds.outHeight
    }
  }

  /** Decodes at (or under) [maxDimension] and bakes the EXIF orientation into the pixels. */
  private fun decodeUpright(file: File, maxDimension: Int?): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw FaceVisionException(ErrorCodes.INVALID_IMAGE, "${file.name} is not a decodable image.")
    }

    val decodeOptions = BitmapFactory.Options().apply {
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight, maxDimension)
    }
    val decoded = BitmapFactory.decodeFile(file.absolutePath, decodeOptions)
      ?: throw FaceVisionException(ErrorCodes.INVALID_IMAGE, "Could not decode ${file.name}.")

    return applyExifOrientation(scaleDown(decoded, maxDimension), exifOrientation(file))
  }

  private fun sampleSizeFor(width: Int, height: Int, maxDimension: Int?): Int {
    if (maxDimension == null || maxDimension <= 0) return 1
    var sample = 1
    while (max(width, height) / (sample * 2) >= maxDimension) {
      sample *= 2
    }
    return sample
  }

  /** inSampleSize only halves, so trim the remainder to hit maxDimension exactly. */
  private fun scaleDown(bitmap: Bitmap, maxDimension: Int?): Bitmap {
    if (maxDimension == null || maxDimension <= 0) return bitmap
    val longestEdge = max(bitmap.width, bitmap.height)
    if (longestEdge <= maxDimension) return bitmap
    val ratio = maxDimension.toFloat() / longestEdge
    val scaled = Bitmap.createScaledBitmap(
      bitmap,
      max((bitmap.width * ratio).toInt(), 1),
      max((bitmap.height * ratio).toInt(), 1),
      true
    )
    if (scaled !== bitmap) bitmap.recycle()
    return scaled
  }

  private fun exifOrientation(file: File): Int = try {
    ExifInterface(file.absolutePath)
      .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
  } catch (error: IOException) {
    ExifInterface.ORIENTATION_NORMAL
  }

  private fun applyExifOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.postRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.postRotate(270f)
        matrix.postScale(-1f, 1f)
      }
      else -> return bitmap
    }

    val oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    if (oriented !== bitmap) bitmap.recycle()
    return oriented
  }

  companion object {
    private val SWAPPED_ORIENTATIONS = setOf(
      ExifInterface.ORIENTATION_ROTATE_90,
      ExifInterface.ORIENTATION_ROTATE_270,
      ExifInterface.ORIENTATION_TRANSPOSE,
      ExifInterface.ORIENTATION_TRANSVERSE
    )

    fun outputDirectory(cacheRoot: File) = File(cacheRoot, "face-vision")

    fun ensureOutputDirectory(directory: File) {
      if (!directory.exists() && !directory.mkdirs()) {
        throw FaceVisionException(ErrorCodes.IMAGE_WRITE_FAILED, "Could not create ${directory.absolutePath}.")
      }
    }

    fun writeImage(directory: File, bitmap: Bitmap, png: Boolean, quality: Double): Map<String, Any> {
      ensureOutputDirectory(directory)
      val file = File(directory, "${UUID.randomUUID()}.${if (png) "png" else "jpg"}")
      try {
        FileOutputStream(file).use { output ->
          val format = if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
          val compressQuality = (quality.coerceIn(0.0, 1.0) * 100).roundToInt()
          if (!bitmap.compress(format, compressQuality, output)) {
            throw IOException("Bitmap.compress returned false")
          }
        }
      } catch (error: IOException) {
        throw FaceVisionException(ErrorCodes.IMAGE_WRITE_FAILED, "Could not write ${file.absolutePath}.", error)
      }
      return mapOf(
        "uri" to Uri.fromFile(file).toString(),
        "width" to bitmap.width,
        "height" to bitmap.height
      )
    }
  }
}

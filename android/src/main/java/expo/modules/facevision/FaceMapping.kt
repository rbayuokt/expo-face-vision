package expo.modules.facevision

import android.graphics.PointF
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceContour
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

class DetectionOptions : Record {
  @Field var performanceMode: String = "balanced"
  @Field var landmarks: Boolean = false
  @Field var contours: Boolean = false
  @Field var classification: Boolean = false
  @Field var tracking: Boolean = false
  @Field var minFaceSize: Double = 0.1

  val accurate get() = performanceMode == "accurate"

  fun toDetectorOptions(): FaceDetectorOptions = FaceDetectorOptions.Builder()
    .setPerformanceMode(
      if (accurate) FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE else FaceDetectorOptions.PERFORMANCE_MODE_FAST
    )
    .setLandmarkMode(if (landmarks) FaceDetectorOptions.LANDMARK_MODE_ALL else FaceDetectorOptions.LANDMARK_MODE_NONE)
    .setContourMode(if (contours) FaceDetectorOptions.CONTOUR_MODE_ALL else FaceDetectorOptions.CONTOUR_MODE_NONE)
    .setClassificationMode(
      if (classification) FaceDetectorOptions.CLASSIFICATION_MODE_ALL else FaceDetectorOptions.CLASSIFICATION_MODE_NONE
    )
    .setMinFaceSize(minFaceSize.toFloat().coerceIn(0f, 1f))
    .apply { if (tracking) enableTracking() }
    .build()

  // ML Kit documents that no Euler angles are computed for exactly this combination.
  val reportsAngles get() = landmarks || !contours || classification || accurate
}

class RectRecord : Record {
  @Field var x: Double = 0.0
  @Field var y: Double = 0.0
  @Field var width: Double = 0.0
  @Field var height: Double = 0.0
}

class PointRecord : Record {
  @Field var x: Double = 0.0
  @Field var y: Double = 0.0
}

class SizeRecord : Record {
  @Field var width: Double = 0.0
  @Field var height: Double = 0.0
}

class CropOptions : Record {
  @Field var padding: Double = 0.2
  @Field var square: Boolean = false
  @Field var outputSize: SizeRecord? = null
  @Field var format: String = "jpeg"
  @Field var quality: Double = 0.9
}

class TakePhotoOptions : Record {
  @Field var quality: Double = 0.9
}

private val LANDMARKS = listOf(
  FaceLandmark.LEFT_EYE to "leftEye",
  FaceLandmark.RIGHT_EYE to "rightEye",
  FaceLandmark.NOSE_BASE to "noseBase",
  FaceLandmark.MOUTH_LEFT to "leftMouth",
  FaceLandmark.MOUTH_RIGHT to "rightMouth",
  FaceLandmark.MOUTH_BOTTOM to "bottomMouth",
  FaceLandmark.LEFT_CHEEK to "leftCheek",
  FaceLandmark.RIGHT_CHEEK to "rightCheek",
  FaceLandmark.LEFT_EAR to "leftEar",
  FaceLandmark.RIGHT_EAR to "rightEar"
)

private val CONTOURS = listOf(
  "face", "leftEye", "rightEye", "leftEyebrow", "rightEyebrow", "noseBridge", "noseBottom",
  "outerLips", "innerLips", "upperLip", "lowerLip", "leftCheek", "rightCheek"
)

internal fun capabilities() = mapOf(
  "platform" to "android",
  "landmarks" to LANDMARKS.map { it.second },
  "contours" to CONTOURS,
  "tracking" to "native",
  "smileProbability" to true,
  "eyeOpenProbability" to true,
  "blink" to "probability",
  "headPose" to mapOf("yaw" to true, "pitch" to true, "roll" to true),
  "faceConfidence" to false,
  "contoursSingleFaceOnly" to true
)

// Sign conventions, per developers.google.com/android/reference/com/google/mlkit/vision/face/Face:
// X > 0 "is the face looking up" -> pitch as is.
// Y > 0 "when the face turns toward the right side of the image"; on an un-mirrored image that is
//   the subject's left, so yaw = -Y.
// Z > 0 "is a counter-clockwise rotation within the image plane"; CCW on an un-mirrored image moves
//   the top of the head toward the subject's right shoulder, so roll = Z.
private const val YAW_SIGN = -1f
private const val PITCH_SIGN = 1f
private const val ROLL_SIGN = 1f

/** [scale] maps detector pixels back to the upright output image. */
internal fun faceToMap(face: Face, options: DetectionOptions, scale: Float): MutableMap<String, Any> {
  fun point(p: PointF) = mapOf("x" to (p.x * scale).toDouble(), "y" to (p.y * scale).toDouble())
  fun points(list: List<PointF>) = list.map(::point)

  val box = face.boundingBox
  val result = mutableMapOf<String, Any>(
    "bounds" to mapOf(
      "x" to (box.left * scale).toDouble(),
      "y" to (box.top * scale).toDouble(),
      "width" to (box.width() * scale).toDouble(),
      "height" to (box.height() * scale).toDouble()
    )
  )
  val native = mutableMapOf<String, Any>("platform" to "android")
  result["native"] = native

  if (options.tracking) {
    face.trackingId?.let { result["trackingId"] = it }
  }

  if (options.landmarks) {
    val landmarks = LANDMARKS.mapNotNull { (type, key) ->
      face.getLandmark(type)?.let { key to point(it.position) }
    }.toMap()
    if (landmarks.isNotEmpty()) result["landmarks"] = landmarks
  }

  if (options.contours) {
    val contours = contoursOf(face).mapValues { points(it.value) }
    if (contours.isNotEmpty()) result["contours"] = contours
  }

  if (options.reportsAngles) {
    val x = face.headEulerAngleX
    val y = face.headEulerAngleY
    val z = face.headEulerAngleZ
    result["angles"] = mapOf(
      "yaw" to (YAW_SIGN * y).toDouble(),
      "pitch" to (PITCH_SIGN * x).toDouble(),
      "roll" to (ROLL_SIGN * z).toDouble()
    )
    native["rawAngles"] = mapOf("x" to x.toDouble(), "y" to y.toDouble(), "z" to z.toDouble())
  }

  if (options.classification) {
    val probabilities = listOfNotNull(
      face.smilingProbability?.let { "smiling" to it.toDouble() },
      face.leftEyeOpenProbability?.let { "leftEyeOpen" to it.toDouble() },
      face.rightEyeOpenProbability?.let { "rightEyeOpen" to it.toDouble() }
    ).toMap()
    if (probabilities.isNotEmpty()) result["probabilities"] = probabilities
  }
  return result
}

private fun contoursOf(face: Face): Map<String, List<PointF>> {
  fun c(type: Int): List<PointF> = face.getContour(type)?.points.orEmpty()

  var leftEye = c(FaceContour.LEFT_EYE)
  var rightEye = c(FaceContour.RIGHT_EYE)
  var leftBrow = loop(c(FaceContour.LEFT_EYEBROW_TOP), c(FaceContour.LEFT_EYEBROW_BOTTOM))
  var rightBrow = loop(c(FaceContour.RIGHT_EYEBROW_TOP), c(FaceContour.RIGHT_EYEBROW_BOTTOM))
  var leftCheek = c(FaceContour.LEFT_CHEEK)
  var rightCheek = c(FaceContour.RIGHT_CHEEK)

  // The API reference says "subject's left" for landmarks, but the contour diagram draws
  // LEFT_EYE on the image's left. Settle it geometrically: the subject's left eye sits on the
  // image's right once roll is undone.
  if (leftEye.isNotEmpty() && rightEye.isNotEmpty()) {
    val roll = Math.toRadians(face.headEulerAngleZ.toDouble())
    val dx = centroid(leftEye).x - centroid(rightEye).x
    val dy = centroid(leftEye).y - centroid(rightEye).y
    if (dx * cos(roll) - dy * sin(roll) < 0) {
      leftEye = rightEye.also { rightEye = leftEye }
      leftBrow = rightBrow.also { rightBrow = leftBrow }
      leftCheek = rightCheek.also { rightCheek = leftCheek }
    }
  }

  val upperTop = c(FaceContour.UPPER_LIP_TOP)
  val upperBottom = c(FaceContour.UPPER_LIP_BOTTOM)
  val lowerTop = c(FaceContour.LOWER_LIP_TOP)
  val lowerBottom = c(FaceContour.LOWER_LIP_BOTTOM)

  return linkedMapOf(
    "face" to c(FaceContour.FACE),
    "leftEye" to leftEye,
    "rightEye" to rightEye,
    "leftEyebrow" to leftBrow,
    "rightEyebrow" to rightBrow,
    "noseBridge" to c(FaceContour.NOSE_BRIDGE),
    "noseBottom" to c(FaceContour.NOSE_BOTTOM),
    "outerLips" to loop(upperTop, lowerBottom),
    "innerLips" to loop(upperBottom, lowerTop),
    "upperLip" to loop(upperTop, upperBottom),
    "lowerLip" to loop(lowerTop, lowerBottom),
    "leftCheek" to leftCheek,
    "rightCheek" to rightCheek
  ).filterValues { it.isNotEmpty() }
}

/**
 * Joins two open chains into a closed loop. The diagram has the lip chains running in mixed
 * directions (upper lip left-to-right, lower lip right-to-left), so [b] is appended in whichever
 * direction continues from the end of [a] instead of trusting a fixed reversal.
 */
private fun loop(a: List<PointF>, b: List<PointF>): List<PointF> {
  if (a.isEmpty() || b.isEmpty()) return a + b
  val end = a.last()
  val forward = hypot(b.first().x - end.x, b.first().y - end.y)
  val backward = hypot(b.last().x - end.x, b.last().y - end.y)
  return if (forward <= backward) a + b else a + b.asReversed()
}

private fun centroid(points: List<PointF>) =
  PointF(points.map { it.x }.average().toFloat(), points.map { it.y }.average().toFloat())

/** Integer pixel bounds of [rect] clamped to the image, or null if nothing is left. */
internal fun clampRect(x: Double, y: Double, width: Double, height: Double, imageWidth: Int, imageHeight: Int): android.graphics.Rect? {
  if (!(x.isFinite() && y.isFinite() && width.isFinite() && height.isFinite())) return null
  val left = floor(x).toInt().coerceIn(0, imageWidth)
  val top = floor(y).toInt().coerceIn(0, imageHeight)
  val right = ceil(x + width).toInt().coerceIn(0, imageWidth)
  val bottom = ceil(y + height).toInt().coerceIn(0, imageHeight)
  if (right <= left || bottom <= top) return null
  return android.graphics.Rect(left, top, right, bottom)
}

/**
 * Luma stats, kept in lockstep with iOS: nearest-neighbour downsample to at most 128px wide
 * (sample `left + i * w / outW`, integer division), then mean / stddev / variance of the
 * 4-neighbour Laplacian over interior pixels. [luma] returns 0..255 in upright pixel coordinates.
 */
internal fun regionStats(rect: android.graphics.Rect, luma: (Int, Int) -> Double): Map<String, Double> {
  val width = rect.width()
  val height = rect.height()
  val outW = min(width, 128)
  val outH = max(1, (height.toLong() * outW / width).toInt())
  val samples = DoubleArray(outW * outH)
  for (j in 0 until outH) {
    val sy = rect.top + (j.toLong() * height / outH).toInt()
    for (i in 0 until outW) {
      samples[j * outW + i] = luma(rect.left + (i.toLong() * width / outW).toInt(), sy)
    }
  }

  val mean = samples.average()
  val variance = samples.sumOf { (it - mean) * (it - mean) } / samples.size

  var sum = 0.0
  var sumSquares = 0.0
  var count = 0
  for (j in 1 until outH - 1) {
    for (i in 1 until outW - 1) {
      val c = j * outW + i
      val lap = 4 * samples[c] - samples[c - outW] - samples[c + outW] - samples[c - 1] - samples[c + 1]
      sum += lap
      sumSquares += lap * lap
      count++
    }
  }
  val lapMean = if (count > 0) sum / count else 0.0
  val lapVariance = if (count > 0) sumSquares / count - lapMean * lapMean else 0.0

  return mapOf(
    "brightness" to mean / 255.0,
    "contrast" to sqrt(variance) / 255.0,
    "laplacianVariance" to max(lapVariance, 0.0)
  )
}

package expo.modules.facevision

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Matrix
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.os.SystemClock
import android.util.Range
import android.util.Size
import android.view.Surface
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.AspectRatio
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExtendableBuilder
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

class ExpoFaceVisionCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // React Native never lays out native children on its own, and PreviewView needs a real layout.
  override val shouldUseAndroidLayout = true

  private val previewView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
  }
  private val onFrame by EventDispatcher()
  private val onCameraReady by EventDispatcher()
  private val onCameraError by EventDispatcher()

  private val executor = Executors.newSingleThreadExecutor()
  // ML Kit can still complete a frame after destroy() shut the executor down.
  private val callbackExecutor = Executor { command ->
    try {
      executor.execute(command)
    } catch (_: RejectedExecutionException) {
    }
  }
  private val outputDirectory = FaceImageProcessor.outputDirectory(appContext.cacheDirectory)

  var facing = "front"
  var active = true
  var resizeMode = "cover"
  var detection = DetectionOptions()
  @Volatile var inferenceFps = 10.0
  @Volatile var frameStats = false

  private class Pipeline(val detector: FaceDetector, val options: DetectionOptions, val key: String)

  @Volatile private var pipeline: Pipeline? = null
  @Volatile private var mirrored = false
  @Volatile private var readyPending = false
  @Volatile private var lastStart = 0L
  private val busy = AtomicBoolean(false)

  private var attached = false
  private var destroyed = false
  private var boundKey: String? = null
  private var bindGeneration = 0
  private var cameraProvider: ProcessCameraProvider? = null
  private var useCases: Array<UseCase> = emptyArray()
  private var imageAnalysis: ImageAnalysis? = null
  private var imageCapture: ImageCapture? = null

  init {
    addView(previewView)
  }

  fun commit() {
    if (destroyed) return
    previewView.scaleType =
      if (resizeMode == "contain") PreviewView.ScaleType.FIT_CENTER else PreviewView.ScaleType.FILL_CENTER

    val key = detection.run { "$performanceMode|$landmarks|$contours|$classification|$tracking|$minFaceSize" }
    if (pipeline?.key != key) {
      val previous = pipeline
      pipeline = Pipeline(FaceDetection.getClient(detection.toDetectorOptions()), detection, key)
      // An in-flight process() on the old detector just fails and that frame is dropped.
      previous?.detector?.close()
    }
    updateBinding()
  }

  fun destroy() {
    destroyed = true
    unbind()
    pipeline?.detector?.close()
    pipeline = null
    executor.shutdown()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    updateBinding()
  }

  override fun onDetachedFromWindow() {
    attached = false
    updateBinding()
    super.onDetachedFromWindow()
  }

  // Coming back from the permission dialog: bind now if the camera was just granted.
  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    if (hasWindowFocus) updateBinding()
  }

  override fun onConfigurationChanged(newConfig: Configuration?) {
    super.onConfigurationChanged(newConfig)
    val rotation = displayRotation()
    imageAnalysis?.targetRotation = rotation
    imageCapture?.targetRotation = rotation
  }

  private fun updateBinding() {
    if (destroyed) return
    // The frame-rate floor is set at bind time, so a new floor needs a rebind.
    val key = if (active && attached) "$facing|${detection.performanceMode}|${fpsFloor()}" else null
    if (key == boundKey) return
    unbind()
    if (key != null) bind(key)
  }

  private fun bind(key: String) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      emitError(ErrorCodes.CAMERA_PERMISSION_DENIED, "Camera permission has not been granted.")
      return
    }
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      emitError(ErrorCodes.CAMERA_UNAVAILABLE, "No activity to bind the camera to.")
      return
    }

    boundKey = key
    val generation = ++bindGeneration
    val front = facing == "front"
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (generation != bindGeneration || destroyed) return@addListener
      try {
        val provider = future.get()
        val selector = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
        if (!provider.hasCamera(selector)) {
          boundKey = null
          emitError(ErrorCodes.CAMERA_UNAVAILABLE, "This device has no ${if (front) "front" else "back"} camera.")
          return@addListener
        }

        val (analysisSize, ratio) = when (detection.performanceMode) {
          "fast" -> Size(640, 480) to AspectRatio.RATIO_4_3
          "accurate" -> Size(1920, 1080) to AspectRatio.RATIO_16_9
          else -> Size(1280, 720) to AspectRatio.RATIO_16_9
        }
        // Same aspect ratio everywhere so analysis frames and the preview share a field of view.
        val ratioStrategy = AspectRatioStrategy(ratio, AspectRatioStrategy.FALLBACK_RULE_AUTO)
        val sameRatio = ResolutionSelector.Builder().setAspectRatioStrategy(ratioStrategy).build()
        val rotation = displayRotation()

        val fpsRange = fpsRange(provider, selector)
        val preview = Preview.Builder().setResolutionSelector(sameRatio).withFps(fpsRange).build()
        preview.setSurfaceProvider(previewView.surfaceProvider)
        val analysis = ImageAnalysis.Builder()
          .setResolutionSelector(
            ResolutionSelector.Builder()
              .setAspectRatioStrategy(ratioStrategy)
              .setResolutionStrategy(
                ResolutionStrategy(analysisSize, ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)
              )
              .build()
          )
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
          .setTargetRotation(rotation)
          .withFps(fpsRange)
          .build()
        analysis.setAnalyzer(executor, ::analyze)
        val capture = ImageCapture.Builder()
          .setResolutionSelector(sameRatio)
          .setTargetRotation(rotation)
          .build()

        val bound = arrayOf<UseCase>(preview, analysis, capture)
        provider.bindToLifecycle(owner, selector, *bound)
        cameraProvider = provider
        useCases = bound
        imageAnalysis = analysis
        imageCapture = capture
        mirrored = front
        lastStart = 0L
        readyPending = true
      } catch (error: Exception) {
        boundKey = null
        emitError(ErrorCodes.CAMERA_UNAVAILABLE, "Could not start the camera: ${error.message}")
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun fpsFloor(): Int = if (inferenceFps <= 0) 0 else kotlin.math.ceil(inferenceFps.coerceAtMost(30.0)).toInt()

  /**
   * Auto exposure is free to drop to a few fps indoors (many phones use [5, 30]), which caps
   * analysis whatever inferenceFps asks for. Pick the lowest supported floor that still covers
   * it, preferring the widest top. A higher floor means shorter exposures: a darker, noisier
   * preview in dim light.
   */
  @OptIn(ExperimentalCamera2Interop::class)
  private fun fpsRange(provider: ProcessCameraProvider, selector: CameraSelector): Range<Int>? {
    val floor = fpsFloor()
    if (floor == 0) return null
    val ranges = try {
      Camera2CameraInfo.from(provider.getCameraInfo(selector))
        .getCameraCharacteristic(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
    } catch (_: Exception) {
      null
    } ?: return null
    return ranges.filter { it.lower >= floor }.minWithOrNull(compareBy({ it.lower }, { -it.upper }))
      ?: ranges.maxWithOrNull(compareBy({ it.lower }, { it.upper }))
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun <T> ExtendableBuilder<T>.withFps(range: Range<Int>?): ExtendableBuilder<T> {
    if (range != null) Camera2Interop.Extender(this).setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
    return this
  }

  private fun unbind() {
    bindGeneration++
    boundKey = null
    imageAnalysis?.clearAnalyzer()
    if (useCases.isNotEmpty()) cameraProvider?.unbind(*useCases)
    useCases = emptyArray()
    imageAnalysis = null
    imageCapture = null
  }

  @SuppressLint("UnsafeOptInUsageError")
  private fun analyze(proxy: ImageProxy) {
    val rotation = proxy.imageInfo.rotationDegrees
    val swap = rotation % 180 != 0
    val frameWidth = if (swap) proxy.height else proxy.width
    val frameHeight = if (swap) proxy.width else proxy.height
    val frame = mapOf("width" to frameWidth, "height" to frameHeight)
    if (readyPending) {
      readyPending = false
      onCameraReady(mapOf("frame" to frame))
    }

    val start = SystemClock.elapsedRealtime()
    val fps = inferenceFps
    val current = pipeline
    val media = proxy.image
    if (current == null || media == null || fps <= 0 || start - lastStart < 1000.0 / fps ||
      !busy.compareAndSet(false, true)
    ) {
      proxy.close()
      return
    }
    lastStart = start
    val options = current.options
    val withStats = frameStats
    val frontFacing = mirrored

    current.detector.process(InputImage.fromMediaImage(media, rotation))
      .addOnCompleteListener(callbackExecutor) { task ->
        try {
          if (!task.isSuccessful) return@addOnCompleteListener
          val faces = task.result
            .filter { it.boundingBox.width().toDouble() / frameWidth >= options.minFaceSize }
            .map { face ->
              faceToMap(face, options, 1f).also { map ->
                if (withStats) {
                  val box = face.boundingBox
                  clampRect(
                    box.left.toDouble(), box.top.toDouble(), box.width().toDouble(), box.height().toDouble(),
                    frameWidth, frameHeight
                  )?.let { map["stats"] = regionStats(it, lumaOf(proxy, rotation)) }
                }
              }
            }
          onFrame(
            mapOf(
              "faces" to faces,
              "frame" to frame,
              "mirrored" to frontFacing,
              "timestamp" to start.toDouble(),
              "processingTime" to (SystemClock.elapsedRealtime() - start).toDouble()
            )
          )
        } finally {
          proxy.close()
          busy.set(false)
        }
      }
  }

  /** Reads the Y plane at upright (rotated) frame coordinates. */
  private fun lumaOf(proxy: ImageProxy, rotation: Int): (Int, Int) -> Double {
    val plane = proxy.planes[0]
    val buffer = plane.buffer
    val rowStride = plane.rowStride
    val pixelStride = plane.pixelStride
    val w = proxy.width
    val h = proxy.height
    return { u, v ->
      // Inverse of rotating the buffer clockwise by `rotation` degrees.
      val index = when (rotation) {
        90 -> (h - 1 - u) * rowStride + v * pixelStride
        180 -> (h - 1 - v) * rowStride + (w - 1 - u) * pixelStride
        270 -> u * rowStride + (w - 1 - v) * pixelStride
        else -> v * rowStride + u * pixelStride
      }
      (buffer.get(index).toInt() and 0xFF).toDouble()
    }
  }

  fun takePhoto(quality: Double, promise: Promise) {
    val capture = imageCapture
    if (capture == null) {
      promise.reject(FaceVisionException(ErrorCodes.CAMERA_UNAVAILABLE, "The camera is not running."))
      return
    }
    // The in-memory capture is the raw sensor image: never mirrored, rotated by metadata only.
    capture.takePicture(executor, object : ImageCapture.OnImageCapturedCallback() {
      override fun onCaptureSuccess(image: ImageProxy) {
        try {
          val bitmap = image.toBitmap()
          val degrees = image.imageInfo.rotationDegrees
          val upright = if (degrees == 0) {
            bitmap
          } else {
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees.toFloat()) }, true)
              .also { if (it !== bitmap) bitmap.recycle() }
          }
          try {
            promise.resolve(FaceImageProcessor.writeImage(outputDirectory, upright, false, quality))
          } finally {
            upright.recycle()
          }
        } catch (error: CodedException) {
          promise.reject(error)
        } catch (error: Exception) {
          promise.reject(FaceVisionException(ErrorCodes.IMAGE_WRITE_FAILED, "Could not process the photo: ${error.message}", error))
        } finally {
          image.close()
        }
      }

      override fun onError(exception: ImageCaptureException) {
        promise.reject(FaceVisionException(ErrorCodes.CAMERA_UNAVAILABLE, "Capture failed: ${exception.message}", exception))
      }
    })
  }

  private fun displayRotation() = previewView.display?.rotation ?: display?.rotation ?: Surface.ROTATION_0

  private fun emitError(code: String, message: String) {
    onCameraError(mapOf("code" to code, "message" to message))
  }
}

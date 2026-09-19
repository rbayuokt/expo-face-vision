package expo.modules.facevision

import android.Manifest
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ExpoFaceVisionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoFaceVision")

    Function("getCapabilities") { capabilities() }

    AsyncFunction("getCameraPermissionsAsync") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }

    AsyncFunction("requestCameraPermissionsAsync") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }

    // Coroutine bodies run on Expo's shared modules queue, so the heavy work moves to
    // Dispatchers.Default rather than holding that queue for every other module.
    AsyncFunction("detectFaces") Coroutine { uri: String, options: DetectionOptions ->
      return@Coroutine withContext(Dispatchers.Default) { processor().detectFaces(uri, options) }
    }

    AsyncFunction("analyzeRegion") Coroutine { uri: String, rect: RectRecord? ->
      return@Coroutine withContext(Dispatchers.Default) { processor().analyzeRegion(uri, rect) }
    }

    AsyncFunction("cropFace") Coroutine { uri: String, rect: RectRecord, options: CropOptions ->
      return@Coroutine withContext(Dispatchers.Default) { processor().cropFace(uri, rect, options) }
    }

    AsyncFunction("alignFace") Coroutine { uri: String, rect: RectRecord, leftEye: PointRecord, rightEye: PointRecord, options: CropOptions ->
      return@Coroutine withContext(Dispatchers.Default) {
        processor().alignFace(uri, rect, leftEye, rightEye, options)
      }
    }

    View(ExpoFaceVisionCameraView::class) {
      Events("onFrame", "onCameraReady", "onCameraError")

      Prop("facing") { view: ExpoFaceVisionCameraView, facing: String -> view.facing = facing }
      Prop("active") { view: ExpoFaceVisionCameraView, active: Boolean -> view.active = active }
      Prop("inferenceFps") { view: ExpoFaceVisionCameraView, fps: Double -> view.inferenceFps = fps }
      Prop("detection") { view: ExpoFaceVisionCameraView, options: DetectionOptions -> view.detection = options }
      Prop("frameStats") { view: ExpoFaceVisionCameraView, enabled: Boolean -> view.frameStats = enabled }
      Prop("resizeMode") { view: ExpoFaceVisionCameraView, mode: String -> view.resizeMode = mode }

      // Props arrive one by one; apply them together so a facing + mode change binds once.
      OnViewDidUpdateProps { view: ExpoFaceVisionCameraView -> view.commit() }

      OnViewDestroys { view: ExpoFaceVisionCameraView -> view.destroy() }

      AsyncFunction("takePhoto") { view: ExpoFaceVisionCameraView, options: TakePhotoOptions, promise: Promise ->
        view.takePhoto(options.quality, promise)
      }
    }
  }

  private fun processor(): FaceImageProcessor {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    return FaceImageProcessor(context, appContext.cacheDirectory)
  }
}

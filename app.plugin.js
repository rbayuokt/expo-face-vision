const { AndroidConfig, withInfoPlist, withAndroidManifest } = require('expo/config-plugins');

const DEFAULT_CAMERA_PERMISSION = 'Allow $(PRODUCT_NAME) to access your camera';

/** Sets the camera usage string on iOS and makes sure CAMERA is declared on Android. */
module.exports = function withFaceVision(config, { cameraPermission } = {}) {
  config = withInfoPlist(config, (c) => {
    c.modResults.NSCameraUsageDescription =
      cameraPermission || c.modResults.NSCameraUsageDescription || DEFAULT_CAMERA_PERMISSION;
    return c;
  });
  return withAndroidManifest(config, (c) => {
    AndroidConfig.Permissions.ensurePermissions(c.modResults, ['android.permission.CAMERA']);
    return c;
  });
};

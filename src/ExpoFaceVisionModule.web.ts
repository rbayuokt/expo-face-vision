import { NativeModule, registerWebModule } from 'expo';

function unsupported(): never {
  const error = new Error('expo-face-vision is not available on web.');
  (error as Error & { code: string }).code = 'UNSUPPORTED_PLATFORM';
  throw error;
}

class ExpoFaceVisionModule extends NativeModule<{}> {
  getCapabilities = unsupported;
  getCameraPermissionsAsync = async () => unsupported();
  requestCameraPermissionsAsync = async () => unsupported();
  detectFaces = async () => unsupported();
  analyzeRegion = async () => unsupported();
  cropFace = async () => unsupported();
  alignFace = async () => unsupported();
}

export default registerWebModule(ExpoFaceVisionModule, 'ExpoFaceVisionModule');

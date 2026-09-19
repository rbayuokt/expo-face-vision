export * from './types';

// Static images and platform info
export {
  alignFace,
  cropFace,
  detectFaces,
  FaceVisionError,
  getCameraPermissionsAsync,
  getCapabilities,
  measureFaceRegion,
  requestCameraPermissionsAsync,
  resolveImageUri,
  useCameraPermissions,
  type DetectFacesOptions,
} from './image';

// Camera
export { FaceCamera, type FaceCameraProps } from './FaceCamera';
export {
  FaceCameraController,
  type FaceCameraControllerOptions,
  type FrameListener,
  type GuideShape,
} from './camera/controller';
export { FaceCameraContext, useFaceCameraController } from './camera/context';
export type { TakePhotoOptions } from './ExpoFaceVisionCameraView';
export * from './hooks';
export { createSpeaker, isSpeechAvailable, type Speaker, type VoiceOptions } from './speech';
export { isHapticsAvailable, playHaptic, type HapticKind } from './haptics';

// Pure engine, usable without a camera or React
export * from './core/geometry';
export * from './core/coordinates';
export * from './core/face';
export * from './core/filters';
export * from './core/region';
export * from './core/stability';
export * from './core/tracker';
export * from './core/headTracker';
export * from './core/gestures';
export * from './core/headCoverage';
export * from './core/liveness';
export * from './core/blink';
export * from './core/quality';
export * from './core/validation';
export * from './core/guidance';
export * from './core/autoCapture';

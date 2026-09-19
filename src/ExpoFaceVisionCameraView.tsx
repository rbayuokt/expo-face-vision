import { requireNativeView } from 'expo';
import type { Ref } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import type {
  CameraFacing,
  FaceDetectionOptions,
  NativeFrame,
  ProcessedImage,
  ResizeMode,
  Size,
} from './types';

export interface TakePhotoOptions {
  /** 0..1 jpeg quality. Default 0.9. */
  quality?: number;
}

export interface NativeCameraRef {
  takePhoto(options: TakePhotoOptions): Promise<ProcessedImage>;
}

export interface NativeCameraProps {
  ref?: Ref<NativeCameraRef>;
  facing: CameraFacing;
  /** false stops analysis and the session; true resumes. */
  active: boolean;
  /** Max analyzed frames per second. Extra frames are dropped natively. */
  inferenceFps: number;
  detection: FaceDetectionOptions;
  /** Compute per-face luma stats (brightness, contrast, sharpness) on each analyzed frame. */
  frameStats: boolean;
  resizeMode: ResizeMode;
  onFrame?: (event: { nativeEvent: NativeFrame }) => void;
  onCameraReady?: (event: { nativeEvent: { frame: Size } }) => void;
  onCameraError?: (event: { nativeEvent: { code: string; message: string } }) => void;
  style?: StyleProp<ViewStyle>;
}

export const NativeCameraView = requireNativeView<NativeCameraProps>('ExpoFaceVision');

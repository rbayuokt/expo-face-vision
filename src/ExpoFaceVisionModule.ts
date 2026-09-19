import { NativeModule, requireNativeModule } from 'expo';
import type { PermissionResponse } from 'expo-modules-core';

import type {
  AlignedImage,
  CropOptions,
  FaceDetectionOptions,
  FaceVisionCapabilities,
  NativeDetectionResult,
  Point,
  ProcessedImage,
  Rect,
  RegionStats,
} from './types';

declare class ExpoFaceVisionModule extends NativeModule<{}> {
  getCapabilities(): FaceVisionCapabilities;
  getCameraPermissionsAsync(): Promise<PermissionResponse>;
  requestCameraPermissionsAsync(): Promise<PermissionResponse>;
  detectFaces(uri: string, options: FaceDetectionOptions): Promise<NativeDetectionResult>;
  /** `rect` in image pixels. Without it, the whole image. */
  analyzeRegion(uri: string, rect: Rect | null): Promise<RegionStats>;
  /** `rect` in image pixels. Padding/square are applied natively. */
  cropFace(uri: string, rect: Rect, options: CropOptions): Promise<ProcessedImage>;
  alignFace(
    uri: string,
    rect: Rect,
    leftEye: Point,
    rightEye: Point,
    options: CropOptions
  ): Promise<AlignedImage>;
}

export default requireNativeModule<ExpoFaceVisionModule>('ExpoFaceVision');

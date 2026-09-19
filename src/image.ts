import { Asset } from 'expo-asset';
import { createPermissionHook } from 'expo-modules-core';

import ExpoFaceVisionModule from './ExpoFaceVisionModule';
import { toDetectedFace, type DirectionThresholds } from './core/face';
import type {
  AlignOptions,
  AlignedImage,
  CropOptions,
  DetectedFace,
  FaceDetectionOptions,
  FaceDetectionResult,
  FaceVisionCapabilities,
  ImageSource,
  ProcessedImage,
  Rect,
  RegionStats,
} from './types';

export class FaceVisionError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'FaceVisionError';
  }
}

/** Resolves an image source to a local uri the native side can read. */
export async function resolveImageUri(source: ImageSource): Promise<string> {
  if (typeof source === 'number') {
    // Bundled in release, served over http in dev; downloadAsync covers both.
    const asset = Asset.fromModule(source);
    await asset.downloadAsync();
    if (!asset.localUri)
      throw new FaceVisionError('INVALID_URI', 'Could not resolve the asset to a local file.');
    return asset.localUri;
  }
  const uri = typeof source === 'string' ? source : source.uri;
  if (/^https?:\/\//i.test(uri)) {
    throw new FaceVisionError(
      'INVALID_URI',
      'Remote images are not supported; download the file first.'
    );
  }
  return uri;
}

let capabilities: FaceVisionCapabilities | undefined;

/** What this platform's detector can actually provide. */
export function getCapabilities(): FaceVisionCapabilities {
  return (capabilities ??= ExpoFaceVisionModule.getCapabilities());
}

export interface DetectFacesOptions extends FaceDetectionOptions {
  directionThresholds?: DirectionThresholds;
}

/** Face detection on a still image. No camera involved. */
export async function detectFaces(
  source: ImageSource,
  options: DetectFacesOptions = {}
): Promise<FaceDetectionResult> {
  const { directionThresholds, ...native } = options;
  const uri = await resolveImageUri(source);
  const result = await ExpoFaceVisionModule.detectFaces(uri, native);
  return {
    image: result.image,
    processingTime: result.processingTime,
    faces: result.faces.map((f) => toDetectedFace(f, result.image, directionThresholds)),
  };
}

/**
 * Brightness, contrast and sharpness (Laplacian variance) of the face region, or the whole image
 * without a face. Feed the result to `analyzeFaceQuality` as `stats`.
 */
export async function measureFaceRegion(
  source: ImageSource,
  face?: Pick<DetectedFace, 'bounds'> | Rect
): Promise<RegionStats> {
  const rect = face ? ('bounds' in face ? face.bounds : face) : null;
  return ExpoFaceVisionModule.analyzeRegion(await resolveImageUri(source), rect);
}

export async function cropFace(
  source: ImageSource,
  face: Pick<DetectedFace, 'bounds'> | Rect,
  options: CropOptions = {}
): Promise<ProcessedImage> {
  const rect = 'bounds' in face ? face.bounds : face;
  return ExpoFaceVisionModule.cropFace(await resolveImageUri(source), rect, options);
}

/**
 * Rotates so the eyes are level, then crops like `cropFace`. Needs eye landmarks (detect with
 * `landmarks: true`); throws LANDMARKS_REQUIRED instead of silently returning an unaligned crop.
 */
export async function alignFace(
  source: ImageSource,
  face: Pick<DetectedFace, 'bounds' | 'landmarks'>,
  options: AlignOptions = {}
): Promise<AlignedImage> {
  const left = face.landmarks?.leftEye;
  const right = face.landmarks?.rightEye;
  if (!left || !right) {
    throw new FaceVisionError(
      'LANDMARKS_REQUIRED',
      'alignFace needs leftEye and rightEye landmarks.'
    );
  }
  // Level the eyes with the smallest rotation. In a mirrored selfie the subject's left eye sits
  // on the image's left, and taking the names literally would turn the crop upside down.
  const [imageRight, imageLeft] = left.x >= right.x ? [left, right] : [right, left];
  return ExpoFaceVisionModule.alignFace(
    await resolveImageUri(source),
    face.bounds,
    imageRight,
    imageLeft,
    options
  );
}

export const getCameraPermissionsAsync = () => ExpoFaceVisionModule.getCameraPermissionsAsync();
export const requestCameraPermissionsAsync = () =>
  ExpoFaceVisionModule.requestCameraPermissionsAsync();

/** `const [permission, request] = useCameraPermissions()` */
export const useCameraPermissions = createPermissionHook({
  getMethod: getCameraPermissionsAsync,
  requestMethod: requestCameraPermissionsAsync,
});

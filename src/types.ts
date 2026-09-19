export type FaceVisionPlatform = 'android' | 'ios';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * - `fast`: native fast mode on a downscaled input (camera: ~480p analysis, images: 640px long side).
 * - `balanced`: native fast mode at ~720p / 1280px.
 * - `accurate`: native accurate mode at ~1080p / full resolution.
 */
export type PerformanceMode = 'fast' | 'balanced' | 'accurate';

export interface FaceDetectionOptions {
  /** Default `balanced`. */
  performanceMode?: PerformanceMode;
  landmarks?: boolean;
  /**
   * Android: ML Kit only computes contours for the most prominent face.
   * iOS: contours come from the same landmark request as `landmarks`.
   */
  contours?: boolean;
  /** Smiling / eye-open probabilities. Android only, see `getCapabilities()`. */
  classification?: boolean;
  /** Stable ids across frames. Native on Android, IoU association in JS on iOS. */
  tracking?: boolean;
  /** Smallest face to report, as face width / image width. Default 0.1. */
  minFaceSize?: number;
}

export type LandmarkType =
  | 'leftEye'
  | 'rightEye'
  | 'noseBase'
  | 'leftMouth'
  | 'rightMouth'
  | 'bottomMouth'
  | 'leftCheek'
  | 'rightCheek'
  | 'leftEar'
  | 'rightEar';

/** Subject's left/right, in image pixels. */
export type FaceLandmarks = Partial<Record<LandmarkType, Point>>;

/**
 * Closed loops unless noted. `face` is the full oval on Android but only the jawline on iOS.
 * `outerLips`/`innerLips` exist on both platforms, `upperLip`/`lowerLip` are Android only.
 */
export type ContourType =
  | 'face'
  | 'leftEye'
  | 'rightEye'
  | 'leftEyebrow'
  | 'rightEyebrow'
  | 'noseBridge'
  | 'noseBottom'
  | 'outerLips'
  | 'innerLips'
  | 'upperLip'
  | 'lowerLip'
  | 'leftCheek'
  | 'rightCheek';

export type FaceContours = Partial<Record<ContourType, Point[]>>;

/**
 * Degrees, subject-centric so it reads the same for front and back cameras:
 * - yaw > 0: subject turns their head to their own right
 * - pitch > 0: subject looks up
 * - roll > 0: subject tilts their head toward their own right shoulder
 */
export interface EulerAngles {
  yaw: number;
  pitch: number;
  roll: number;
}

export type HeadDirection = 'center' | 'left' | 'right' | 'up' | 'down';

export interface HeadPose extends EulerAngles {
  /** Face center in image pixels. */
  position: Point;
  /** Face center in 0..1 of the image. */
  normalizedPosition: Point;
  /** Face width / image width. */
  scale: number;
  direction?: HeadDirection;
}

export interface FaceProbabilities {
  smiling?: number;
  leftEyeOpen?: number;
  rightEyeOpen?: number;
}

/** Luma statistics of the face region, computed natively. */
export interface RegionStats {
  /** Mean luma, 0..1. */
  brightness: number;
  /** Luma standard deviation, 0..1. */
  contrast: number;
  /** Variance of the Laplacian on 0..255 luma. Higher is sharper. */
  laplacianVariance: number;
}

/** What the native side sends. Pixels in the upright, un-mirrored image. */
export interface NativeFace {
  trackingId?: number;
  bounds: Rect;
  landmarks?: FaceLandmarks;
  contours?: FaceContours;
  angles?: EulerAngles;
  probabilities?: FaceProbabilities;
  /** Only when the platform reports one (iOS). Never synthesized. */
  confidence?: number;
  stats?: RegionStats;
  native: {
    platform: FaceVisionPlatform;
    /** Angles exactly as the platform reported them, before normalization. */
    rawAngles?: { x?: number; y?: number; z?: number };
  };
}

export interface DetectedFace extends Omit<NativeFace, 'angles'> {
  normalizedBounds: Rect;
  /** Set by the camera pipeline once the preview layout is known. */
  previewBounds?: Rect;
  headPose?: HeadPose;
}

export interface ImageMetadata {
  width: number;
  height: number;
  uri?: string;
}

export interface NativeDetectionResult {
  faces: NativeFace[];
  image: ImageMetadata;
  processingTime: number;
}

export interface FaceDetectionResult {
  faces: DetectedFace[];
  image: ImageMetadata;
  /** Native processing time in ms. */
  processingTime: number;
}

export interface FaceVisionCapabilities {
  platform: FaceVisionPlatform;
  landmarks: LandmarkType[];
  contours: ContourType[];
  /** `native`: platform tracking ids. `library`: IoU association done in JS. */
  tracking: 'native' | 'library';
  smileProbability: boolean;
  eyeOpenProbability: boolean;
  /** Blink needs eye openness: probabilities on Android, eye-contour aspect ratio on iOS. */
  blink: 'probability' | 'eye-aspect-ratio';
  headPose: { yaw: boolean; pitch: boolean; roll: boolean };
  faceConfidence: boolean;
  /** Contours are only returned for the most prominent face. */
  contoursSingleFaceOnly: boolean;
}

/** file:// or content:// uri, an Expo asset module (`require('./a.jpg')`) or `{ uri }`. */
export type ImageSource = string | number | { uri: string };

export interface CropOptions {
  /** Extra margin around the face as a fraction of its size. Default 0.2. */
  padding?: number;
  square?: boolean;
  outputSize?: Size;
  /** Default `jpeg`. */
  format?: 'jpeg' | 'png';
  /** 0..1, jpeg only. Default 0.9. */
  quality?: number;
}

export interface AlignOptions extends CropOptions {}

export interface ProcessedImage {
  uri: string;
  width: number;
  height: number;
}

export interface AlignedImage extends ProcessedImage {
  /** Degrees the source was rotated to level the eyes. */
  rotation: number;
}

export type CameraFacing = 'front' | 'back';
export type ResizeMode = 'cover' | 'contain';

/** One analyzed camera frame. Face geometry is in `frame` pixels. */
export interface NativeFrame {
  faces: NativeFace[];
  /** Upright analysis size (already rotated to the current UI orientation). */
  frame: Size;
  /** true when the preview is shown mirrored (front camera). Face data itself is never mirrored. */
  mirrored: boolean;
  /** Monotonic, ms. */
  timestamp: number;
  processingTime: number;
}

export interface FaceFrame {
  /** Tracked and smoothed when tracking is on, with `previewBounds` once the preview is laid out. */
  faces: DetectedFace[];
  frame: Size;
  mirrored: boolean;
  /** Native monotonic ms. */
  timestamp: number;
  processingTime: number;
  /** Preview view size in dp, when laid out. */
  preview?: Size;
  resizeMode: ResizeMode;
  /** Part of the frame visible in the preview (frame pixels); `cover` crops. */
  visibleRect?: Rect;
}

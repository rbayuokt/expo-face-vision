import type { DetectedFace, Rect, RegionStats, Size } from '../types';
import { areEyesOpen, isLookingForward, type EyesOpenOptions } from './face';
import { clamp } from './geometry';
import { analyzeFacePosition } from './region';

export type QualityComponent =
  | 'sharpness'
  | 'exposure'
  | 'contrast'
  | 'size'
  | 'centering'
  | 'pose'
  | 'eyes'
  | 'visibility'
  | 'stability';

export interface QualityContext {
  /** Image or frame size the face geometry is in. */
  image: Size;
  /** Luma stats of the face region (camera `frameStats`, or `measureFaceRegion` for images). */
  stats?: RegionStats;
  /** From a `StabilityDetector`, when you have one. */
  stable?: boolean;
  /** Visible part of the frame, see `visibleSourceRect`. */
  visibleRect?: Rect;
}

export interface QualityOptions {
  /** Laplacian variance treated as fully sharp. Device and lighting dependent. Default 120. */
  sharpReference?: number;
  /** Ideal mean face luma. Default 0.5. */
  targetBrightness?: number;
  /** Luma std treated as full contrast. Default 0.22. */
  contrastReference?: number;
  /** Face width / frame width range scored as ideal. Default [0.25, 0.7]. */
  faceSizeRange?: [number, number];
  /** Pose angles that score 0.5. Defaults 15 / 12 / 15. */
  maxYaw?: number;
  maxPitch?: number;
  maxRoll?: number;
  /** Max center offset (fraction of frame) for `centered`. Default 0.1. */
  centerTolerance?: number;
  eyes?: EyesOpenOptions;
  /** Relative weights. Missing components are skipped and the rest renormalized. */
  weights?: Partial<Record<QualityComponent, number>>;
  thresholds?: {
    /** Default 0.25. */
    tooDark?: number;
    /** Default 0.85. */
    tooBright?: number;
    /** `blur` above this is too blurry. Default 0.6. */
    tooBlurry?: number;
  };
}

export interface FaceQuality {
  /** Weighted mean of `components`, 0..1. */
  score: number;
  components: Partial<Record<QualityComponent, number>>;
  /** 1 - sharpness score; undefined without stats. */
  blur?: number;
  brightness?: number;
  contrast?: number;
  faceSize: number;
  centered: boolean;
  lookingForward: boolean;
  /** undefined when the platform gives no eye signal. */
  eyesOpen?: boolean;
  fullyInsideFrame: boolean;
  partiallyOutsideFrame: boolean;
  stable?: boolean;
  tooDark: boolean;
  tooBright: boolean;
  tooBlurry: boolean;
}

export const DEFAULT_QUALITY_WEIGHTS: Record<QualityComponent, number> = {
  sharpness: 2,
  exposure: 1.5,
  contrast: 0.5,
  size: 1,
  centering: 1,
  pose: 1.5,
  eyes: 1,
  visibility: 1.5,
  stability: 1,
};

/**
 * Scores one face. Every component is 0..1:
 * - sharpness = min(1, laplacianVariance / sharpReference)
 * - exposure = 1 - |brightness - targetBrightness| / max(target, 1 - target)
 * - contrast = min(1, contrast / contrastReference)
 * - size = 1 inside faceSizeRange, else size/min below or max/size above
 * - centering = 1 - min(1, 2 * max(|dx|, |dy|)), offsets as fractions of the frame
 * - pose = max(0, 1 - max(|yaw|/maxYaw, |pitch|/maxPitch, |roll|/maxRoll) / 2)
 * - eyes = min(leftEyeOpen, rightEyeOpen) probability, or 1/0 from the contour heuristic
 * - visibility = fraction of the face box inside the visible frame
 * - stability = 1 or 0
 *
 * score = Σ(weight × component) / Σ(weight) over the components that could be computed.
 */
export function analyzeFaceQuality(
  face: DetectedFace,
  context: QualityContext,
  options: QualityOptions = {}
): FaceQuality {
  const c: Partial<Record<QualityComponent, number>> = {};
  const position = analyzeFacePosition(face.bounds, context.image, {
    centerTolerance: options.centerTolerance,
    visibleRect: context.visibleRect,
  });

  const stats = context.stats;
  if (stats) {
    c.sharpness = clamp(stats.laplacianVariance / (options.sharpReference ?? 120));
    const target = options.targetBrightness ?? 0.5;
    c.exposure = clamp(1 - Math.abs(stats.brightness - target) / Math.max(target, 1 - target));
    c.contrast = clamp(stats.contrast / (options.contrastReference ?? 0.22));
  }

  const [minSize, maxSize] = options.faceSizeRange ?? [0.25, 0.7];
  const size = position.faceSize;
  c.size = size < minSize ? size / minSize : size > maxSize ? maxSize / size : 1;
  c.centering = clamp(1 - 2 * Math.max(Math.abs(position.offset.x), Math.abs(position.offset.y)));
  c.visibility = position.visibility;

  const maxYaw = options.maxYaw ?? 15;
  const maxPitch = options.maxPitch ?? 12;
  const maxRoll = options.maxRoll ?? 15;
  const pose = face.headPose;
  if (pose) {
    const worst = Math.max(
      Math.abs(pose.yaw) / maxYaw,
      Math.abs(pose.pitch) / maxPitch,
      Math.abs(pose.roll) / maxRoll
    );
    c.pose = clamp(1 - worst / 2);
  }

  const eyesOpen = areEyesOpen(face, options.eyes);
  const p = face.probabilities;
  if (p?.leftEyeOpen !== undefined && p.rightEyeOpen !== undefined)
    c.eyes = Math.min(p.leftEyeOpen, p.rightEyeOpen);
  else if (eyesOpen !== undefined) c.eyes = eyesOpen ? 1 : 0;

  if (context.stable !== undefined) c.stability = context.stable ? 1 : 0;

  const weights = { ...DEFAULT_QUALITY_WEIGHTS, ...options.weights };
  let sum = 0;
  let total = 0;
  for (const [k, v] of Object.entries(c) as [QualityComponent, number][]) {
    sum += v * weights[k];
    total += weights[k];
  }

  const blur = c.sharpness === undefined ? undefined : 1 - c.sharpness;
  const t = options.thresholds ?? {};
  return {
    score: total > 0 ? sum / total : 0,
    components: c,
    blur,
    brightness: stats?.brightness,
    contrast: stats?.contrast,
    faceSize: size,
    centered: position.centered,
    lookingForward: isLookingForward(face, { maxYaw, maxPitch, maxRoll }),
    eyesOpen,
    fullyInsideFrame: position.fullyInsideFrame,
    partiallyOutsideFrame: position.partiallyOutsideFrame,
    stable: context.stable,
    tooDark: stats !== undefined && stats.brightness < (t.tooDark ?? 0.25),
    tooBright: stats !== undefined && stats.brightness > (t.tooBright ?? 0.85),
    tooBlurry: blur !== undefined && blur > (t.tooBlurry ?? 0.6),
  };
}

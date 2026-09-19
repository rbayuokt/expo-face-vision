import type { DetectedFace, Rect, RegionStats, Size } from '../types';
import { areEyesOpen, getLargestFace, type EyesOpenOptions } from './face';
import {
  analyzeFacePosition,
  isFaceInsideRegion,
  type FaceRegion,
  type PositionAnalysis,
  type RegionMetrics,
} from './region';

export type ValidationCode =
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'FACE_TOO_SMALL'
  | 'FACE_TOO_LARGE'
  | 'FACE_NOT_CENTERED'
  | 'FACE_OUTSIDE_FRAME'
  | 'FACE_OUTSIDE_REGION'
  | 'YAW_TOO_LARGE'
  | 'PITCH_TOO_LARGE'
  | 'ROLL_TOO_LARGE'
  | 'EYES_CLOSED'
  | 'TOO_DARK'
  | 'TOO_BRIGHT'
  | 'TOO_BLURRY'
  | 'NOT_STABLE'
  /** A rule was requested but the platform/context has no data for it (e.g. eyes on iOS without contours). */
  | 'SIGNAL_UNAVAILABLE';

export interface ValidationIssue {
  code: ValidationCode | (string & {});
  value?: number;
  expected?: number | [number, number];
  /** Which rule, for SIGNAL_UNAVAILABLE and custom validators. */
  rule?: string;
}

export interface ValidationContext {
  /** Size the face geometry is in. */
  image: Size;
  /** Flip left/right so position reads as the user sees a mirrored preview. */
  mirrored?: boolean;
  visibleRect?: Rect;
  stats?: RegionStats;
  stable?: boolean;
  stableFor?: number;
}

export type CustomValidator = (
  face: DetectedFace,
  context: ValidationContext & { faces: DetectedFace[] }
) => ValidationIssue | ValidationIssue[] | null | undefined;

export interface ValidationRules {
  /** Default true. */
  requireSingleFace?: boolean;
  requireCentered?: boolean;
  /** Max offset from center as a fraction of the frame. Default 0.1. */
  centerTolerance?: number;
  requireEyesOpen?: boolean;
  eyes?: EyesOpenOptions;
  requireLookingForward?: boolean;
  /** Face width / frame width. */
  minFaceSize?: number;
  maxFaceSize?: number;
  /** Degrees. Default 15 / 12 / 15 when `requireLookingForward`, otherwise unchecked. */
  maxYaw?: number;
  maxPitch?: number;
  maxRoll?: number;
  requireFullyInFrame?: boolean;
  /** In the same space as the face bounds. */
  region?: FaceRegion;
  /** Fraction of the face box inside `region`. Default 1. */
  minRegionCoverage?: number;
  /** Mean face luma, 0..1. Needs `stats`. */
  minBrightness?: number;
  maxBrightness?: number;
  /** Laplacian variance. Needs `stats`. */
  minSharpness?: number;
  /** ms the face must have been stable. Needs `stable`/`stableFor`. */
  stableFor?: number;
  custom?: CustomValidator[];
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  /** The face the rules were checked against (largest). */
  face?: DetectedFace;
  position?: PositionAnalysis;
  /** `offset.x` is flipped for mirrored previews, like `position`. */
  region?: RegionMetrics;
}

/** Checks the largest face against `rules`. Pass all faces so single-face rules can see them. */
export function validateFace(
  faces: DetectedFace | DetectedFace[],
  context: ValidationContext,
  rules: ValidationRules = {}
): ValidationResult {
  const list = Array.isArray(faces) ? faces : [faces];
  const face = getLargestFace(list);
  if (!face) return { valid: false, issues: [{ code: 'NO_FACE' }] };

  const issues: ValidationIssue[] = [];
  const add = (issue: ValidationIssue) => issues.push(issue);

  if ((rules.requireSingleFace ?? true) && list.length > 1) {
    add({ code: 'MULTIPLE_FACES', value: list.length, expected: 1 });
  }

  const position = analyzeFacePosition(face.bounds, context.image, {
    centerTolerance: rules.centerTolerance,
    mirrored: context.mirrored,
    visibleRect: context.visibleRect,
  });

  if (rules.minFaceSize !== undefined && position.faceSize < rules.minFaceSize) {
    add({ code: 'FACE_TOO_SMALL', value: position.faceSize, expected: rules.minFaceSize });
  }
  if (rules.maxFaceSize !== undefined && position.faceSize > rules.maxFaceSize) {
    add({ code: 'FACE_TOO_LARGE', value: position.faceSize, expected: rules.maxFaceSize });
  }
  if (rules.requireFullyInFrame && position.partiallyOutsideFrame) {
    add({ code: 'FACE_OUTSIDE_FRAME', value: position.visibility, expected: 1 });
  }
  if (rules.requireCentered && !position.centered) {
    add({
      code: 'FACE_NOT_CENTERED',
      value: Math.max(Math.abs(position.offset.x), Math.abs(position.offset.y)),
      expected: rules.centerTolerance ?? 0.1,
    });
  }

  let region: RegionMetrics | undefined;
  if (rules.region) {
    region = isFaceInsideRegion(face.bounds, rules.region, {
      minCoverage: rules.minRegionCoverage,
    });
    // Screen-space like `position`, so guidance can read both the same way.
    if (context.mirrored) region.offset.x = -region.offset.x;
    if (!region.inside) {
      add({
        code: 'FACE_OUTSIDE_REGION',
        value: region.coverage,
        expected: rules.minRegionCoverage ?? 1,
      });
    }
  }

  const forward = rules.requireLookingForward;
  const angleRules = [
    ['yaw', 'YAW_TOO_LARGE', rules.maxYaw ?? (forward ? 15 : undefined)],
    ['pitch', 'PITCH_TOO_LARGE', rules.maxPitch ?? (forward ? 12 : undefined)],
    ['roll', 'ROLL_TOO_LARGE', rules.maxRoll ?? (forward ? 15 : undefined)],
  ] as const;
  for (const [axis, code, max] of angleRules) {
    if (max === undefined) continue;
    const pose = face.headPose;
    if (!pose) {
      add({ code: 'SIGNAL_UNAVAILABLE', rule: axis });
      continue;
    }
    // Signed value so guidance can tell which way to correct.
    if (Math.abs(pose[axis]) > max) add({ code, value: pose[axis], expected: max });
  }

  if (rules.requireEyesOpen) {
    const open = areEyesOpen(face, rules.eyes);
    if (open === undefined) add({ code: 'SIGNAL_UNAVAILABLE', rule: 'eyesOpen' });
    else if (!open) add({ code: 'EYES_CLOSED' });
  }

  const needsStats =
    rules.minBrightness !== undefined ||
    rules.maxBrightness !== undefined ||
    rules.minSharpness !== undefined;
  const stats = context.stats;
  if (needsStats && !stats) add({ code: 'SIGNAL_UNAVAILABLE', rule: 'stats' });
  if (stats) {
    if (rules.minBrightness !== undefined && stats.brightness < rules.minBrightness) {
      add({ code: 'TOO_DARK', value: stats.brightness, expected: rules.minBrightness });
    }
    if (rules.maxBrightness !== undefined && stats.brightness > rules.maxBrightness) {
      add({ code: 'TOO_BRIGHT', value: stats.brightness, expected: rules.maxBrightness });
    }
    if (rules.minSharpness !== undefined && stats.laplacianVariance < rules.minSharpness) {
      add({ code: 'TOO_BLURRY', value: stats.laplacianVariance, expected: rules.minSharpness });
    }
  }

  if (rules.stableFor !== undefined) {
    const stableFor = context.stableFor ?? (context.stable ? Infinity : undefined);
    if (stableFor === undefined) add({ code: 'SIGNAL_UNAVAILABLE', rule: 'stableFor' });
    else if (stableFor < rules.stableFor)
      add({ code: 'NOT_STABLE', value: stableFor, expected: rules.stableFor });
  }

  for (const validator of rules.custom ?? []) {
    const out = validator(face, { ...context, faces: list });
    if (Array.isArray(out)) issues.push(...out);
    else if (out) issues.push(out);
  }

  return { valid: issues.length === 0, issues, face, position, region };
}

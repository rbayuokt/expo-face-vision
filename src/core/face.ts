import type {
  DetectedFace,
  EulerAngles,
  HeadDirection,
  HeadPose,
  NativeFace,
  Point,
  Size,
} from '../types';
import { distance, normalizeRect, rectArea, rectCenter } from './geometry';

export interface DirectionThresholds {
  /** Degrees of yaw before a face counts as turned. Default 15. */
  yaw?: number;
  /** Degrees of pitch before a face counts as looking up/down. Default 12. */
  pitch?: number;
}

/** Dominant direction, subject-centric: `left` means the subject turned to their own left. */
export function getHeadDirection(
  angles: Pick<EulerAngles, 'yaw' | 'pitch'>,
  thresholds: DirectionThresholds = {}
): HeadDirection {
  const yawT = thresholds.yaw ?? 15;
  const pitchT = thresholds.pitch ?? 12;
  const yawExcess = Math.abs(angles.yaw) / yawT;
  const pitchExcess = Math.abs(angles.pitch) / pitchT;
  if (yawExcess < 1 && pitchExcess < 1) return 'center';
  if (yawExcess >= pitchExcess) return angles.yaw > 0 ? 'right' : 'left';
  return angles.pitch > 0 ? 'up' : 'down';
}

export function toHeadPose(
  angles: EulerAngles,
  bounds: DetectedFace['bounds'],
  image: Size,
  thresholds?: DirectionThresholds
): HeadPose {
  const position = rectCenter(bounds);
  return {
    yaw: angles.yaw,
    pitch: angles.pitch,
    roll: angles.roll,
    position,
    normalizedPosition: { x: position.x / image.width, y: position.y / image.height },
    scale: bounds.width / image.width,
    direction: getHeadDirection(angles, thresholds),
  };
}

/** Adds the derived fields (normalized bounds, head pose) to a native face. */
export function toDetectedFace(
  face: NativeFace,
  image: Size,
  thresholds?: DirectionThresholds
): DetectedFace {
  const { angles, ...rest } = face;
  const detected: DetectedFace = { ...rest, normalizedBounds: normalizeRect(face.bounds, image) };
  if (angles) detected.headPose = toHeadPose(angles, face.bounds, image, thresholds);
  return detected;
}

// Pose helpers. They return false when the face has no pose rather than guessing.

type WithPose = Pick<DetectedFace, 'headPose'>;

export interface ForwardThresholds {
  maxYaw?: number;
  maxPitch?: number;
  /** Not checked unless set. */
  maxRoll?: number;
}

export function isLookingForward(face: WithPose, t: ForwardThresholds = {}): boolean {
  const p = face.headPose;
  if (!p) return false;
  return (
    Math.abs(p.yaw) <= (t.maxYaw ?? 15) &&
    Math.abs(p.pitch) <= (t.maxPitch ?? 12) &&
    (t.maxRoll === undefined || Math.abs(p.roll) <= t.maxRoll)
  );
}

export function isLookingLeft(face: WithPose, threshold = 20): boolean {
  return face.headPose !== undefined && face.headPose.yaw <= -threshold;
}

export function isLookingRight(face: WithPose, threshold = 20): boolean {
  return face.headPose !== undefined && face.headPose.yaw >= threshold;
}

export function isLookingUp(face: WithPose, threshold = 15): boolean {
  return face.headPose !== undefined && face.headPose.pitch >= threshold;
}

export function isLookingDown(face: WithPose, threshold = 15): boolean {
  return face.headPose !== undefined && face.headPose.pitch <= -threshold;
}

// Classification helpers. `undefined` means the platform gave no signal, which callers must not
// read as "no".

type WithProbabilities = Pick<DetectedFace, 'probabilities'>;

export function isSmiling(face: WithProbabilities, threshold = 0.7): boolean | undefined {
  const p = face.probabilities?.smiling;
  return p === undefined ? undefined : p >= threshold;
}

export function isLeftEyeOpen(face: WithProbabilities, threshold = 0.5): boolean | undefined {
  const p = face.probabilities?.leftEyeOpen;
  return p === undefined ? undefined : p >= threshold;
}

export function isRightEyeOpen(face: WithProbabilities, threshold = 0.5): boolean | undefined {
  const p = face.probabilities?.rightEyeOpen;
  return p === undefined ? undefined : p >= threshold;
}

export interface EyesOpenOptions {
  /** Probability threshold. Default 0.5. */
  threshold?: number;
  /**
   * Fall back to the eye-contour aspect ratio when there are no probabilities (iOS).
   * Heuristic; tune `minAspectRatio` on real devices. Default true.
   */
  useContours?: boolean;
  /** Default 0.18. */
  minAspectRatio?: number;
}

export function areEyesOpen(
  face: Pick<DetectedFace, 'probabilities' | 'contours'>,
  options: EyesOpenOptions = {}
): boolean | undefined {
  const left = isLeftEyeOpen(face, options.threshold);
  const right = isRightEyeOpen(face, options.threshold);
  if (left !== undefined && right !== undefined) return left && right;
  if (options.useContours === false) return undefined;
  const ear = eyeAspectRatios(face);
  if (ear.left === undefined || ear.right === undefined) return undefined;
  const min = options.minAspectRatio ?? 0.18;
  return ear.left >= min && ear.right >= min;
}

/**
 * Height / width of an eye contour, measured against the axis between its two farthest points
 * so head roll doesn't change it. Open eyes sit around 0.25-0.4, closed ones well under 0.15,
 * but the exact values depend on the platform's contour model.
 */
export function eyeAspectRatio(contour: Point[] | undefined): number | undefined {
  if (!contour || contour.length < 4) return undefined;
  let a = contour[0]!;
  let b = contour[1]!;
  let best = 0;
  for (let i = 0; i < contour.length; i++) {
    for (let j = i + 1; j < contour.length; j++) {
      const d = distance(contour[i]!, contour[j]!);
      if (d > best) {
        best = d;
        a = contour[i]!;
        b = contour[j]!;
      }
    }
  }
  if (best === 0) return undefined;
  const ux = (b.x - a.x) / best;
  const uy = (b.y - a.y) / best;
  let min = 0;
  let max = 0;
  for (const p of contour) {
    const side = (p.x - a.x) * -uy + (p.y - a.y) * ux;
    if (side < min) min = side;
    if (side > max) max = side;
  }
  return (max - min) / best;
}

export function eyeAspectRatios(face: Pick<DetectedFace, 'contours'>): {
  left?: number;
  right?: number;
} {
  return {
    left: eyeAspectRatio(face.contours?.leftEye),
    right: eyeAspectRatio(face.contours?.rightEye),
  };
}

// Selection helpers.

type WithBounds = Pick<DetectedFace, 'bounds'>;

export function getFaceCenter(face: WithBounds): Point {
  return rectCenter(face.bounds);
}

export function sortFacesBySize<T extends WithBounds>(faces: readonly T[]): T[] {
  return [...faces].sort((a, b) => rectArea(b.bounds) - rectArea(a.bounds));
}

export function getLargestFace<T extends WithBounds>(faces: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const f of faces) if (!best || rectArea(f.bounds) > rectArea(best.bounds)) best = f;
  return best;
}

/** Face whose center is nearest the image center (or `point`). */
export function getCenterFace<T extends WithBounds>(
  faces: readonly T[],
  image: Size,
  point: Point = { x: image.width / 2, y: image.height / 2 }
): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const f of faces) {
    const d = distance(rectCenter(f.bounds), point);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

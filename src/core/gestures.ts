import { clamp } from './geometry';
import type { PoseSample } from './headTracker';

export type HeadGesture =
  | 'nod'
  | 'shake'
  | 'turn-left'
  | 'turn-right'
  | 'look-up'
  | 'look-down'
  | 'tilt-left'
  | 'tilt-right'
  | 'hold';

export const ALL_HEAD_GESTURES: HeadGesture[] = [
  'nod',
  'shake',
  'turn-left',
  'turn-right',
  'look-up',
  'look-down',
  'tilt-left',
  'tilt-right',
  'hold',
];

export interface HeadGestureEvent {
  type: HeadGesture;
  /** 0..1 heuristic, see `HeadGestureRecognizer`. Not a calibrated probability. */
  confidence: number;
  /** ms from the start of the motion to recognition. */
  duration: number;
  timestamp: number;
  trackingId?: number;
}

export interface HeadGestureOptions {
  /** Default all. */
  gestures?: HeadGesture[];
  /** Degrees from the neutral pose. Defaults 25 / 15 / 20. */
  turnAngle?: number;
  lookAngle?: number;
  tiltAngle?: number;
  /** ms a turn/look/tilt must be held past its angle. Default 150. */
  sustainMs?: number;
  /** A fired turn/look/tilt re-arms once back within `angle * releaseRatio`. Default 0.5. */
  releaseRatio?: number;
  /** Min swing, degrees. Defaults nod 8, shake 10. */
  nodAmplitude?: number;
  shakeAmplitude?: number;
  /** Swings needed: down+up = 2. Defaults nod 2, shake 3. */
  nodSwings?: number;
  shakeSwings?: number;
  /** All swings must fit in this window, ms. Default 1200. */
  oscillationWindowMs?: number;
  /** Max off-axis range as a fraction of the on-axis range. Default 0.6. */
  crossAxisRatio?: number;
  /** ms the pose must stay within `holdTolerance` degrees. Defaults 1000 / 3. */
  holdMs?: number;
  holdTolerance?: number;
  /** Quiet period after any gesture, ms. Default 500. */
  cooldownMs?: number;
}

interface Oscillation {
  swings: number;
  meanAmplitude: number;
  range: number;
  startedAt: number;
}

/** Zig-zag with hysteresis: a swing only counts once the signal has reversed by `amplitude`. */
export function countSwings(
  samples: PoseSample[],
  axis: 'yaw' | 'pitch',
  amplitude: number
): Oscillation {
  const empty = { swings: 0, meanAmplitude: 0, range: 0, startedAt: samples[0]?.timestamp ?? 0 };
  if (samples.length < 2) return empty;
  let pivot = samples[0]![axis];
  let extreme = pivot;
  let dir = 0;
  let startedAt = samples[0]!.timestamp;
  let min = pivot;
  let max = pivot;
  const amps: number[] = [];
  for (const s of samples) {
    const v = s[axis];
    if (v < min) min = v;
    if (v > max) max = v;
    if (dir === 0) {
      if (Math.abs(v - pivot) >= amplitude) {
        dir = Math.sign(v - pivot);
        extreme = v;
      } else if (Math.abs(v - pivot) < amplitude / 4) {
        startedAt = s.timestamp;
      }
    } else if ((v - extreme) * dir > 0) {
      extreme = v;
    } else if ((extreme - v) * dir >= amplitude) {
      amps.push(Math.abs(extreme - pivot));
      pivot = extreme;
      extreme = v;
      dir = -dir;
    }
  }
  // The in-progress swing counts once it has covered the amplitude.
  if (dir !== 0 && Math.abs(extreme - pivot) >= amplitude) amps.push(Math.abs(extreme - pivot));
  if (amps.length === 0) return { ...empty, range: max - min };
  return {
    swings: amps.length,
    meanAmplitude: amps.reduce((a, b) => a + b, 0) / amps.length,
    range: max - min,
    startedAt,
  };
}

function range(samples: PoseSample[], axis: 'yaw' | 'pitch' | 'roll'): number {
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    if (s[axis] < min) min = s[axis];
    if (s[axis] > max) max = s[axis];
  }
  return samples.length ? max - min : 0;
}

type Directional = Exclude<HeadGesture, 'nod' | 'shake' | 'hold'>;

const DIRECTIONAL: Record<Directional, { axis: 'yaw' | 'pitch' | 'roll'; sign: 1 | -1 }> = {
  'turn-left': { axis: 'yaw', sign: -1 },
  'turn-right': { axis: 'yaw', sign: 1 },
  'look-up': { axis: 'pitch', sign: 1 },
  'look-down': { axis: 'pitch', sign: -1 },
  'tilt-left': { axis: 'roll', sign: -1 },
  'tilt-right': { axis: 'roll', sign: 1 },
};

/**
 * Temporal head gestures over the filtered pose history from `HeadTracker`.
 *
 * False-positive guards:
 * - angles are measured from an adaptive neutral pose, so someone who naturally holds their
 *   head slightly turned doesn't trigger turns;
 * - turn/look/tilt must be held for `sustainMs` and re-arm only after returning toward neutral;
 * - nod/shake need several reversals of at least the amplitude inside one window, with little
 *   motion on the other axis (a diagonal head roll isn't a nod);
 * - a cooldown after every gesture.
 *
 * Confidence: directional = how far past the angle (1 at 1.5x); nod/shake = mean swing
 * amplitude relative to 2x the minimum, scaled down by off-axis motion; hold = 1 minus how
 * much of the tolerance was used.
 */
export class HeadGestureRecognizer {
  private readonly enabled: Set<HeadGesture>;
  private neutral: { yaw: number; pitch: number; roll: number } | undefined;
  private candidates = new Map<Directional, number>();
  private fired = new Set<HeadGesture>();
  private cooldownUntil = 0;
  private consumedUntil = 0;
  private oscillationFired = false;
  private holdFired = false;

  constructor(private readonly options: HeadGestureOptions = {}) {
    this.enabled = new Set(options.gestures ?? ALL_HEAD_GESTURES);
  }

  /** `history` is the filtered pose history, oldest first, ending with the current sample. */
  update(history: readonly PoseSample[], trackingId?: number): HeadGestureEvent | null {
    const current = history[history.length - 1];
    if (!current) return null;
    const t = current.timestamp;
    const o = this.options;

    this.neutral ??= { yaw: current.yaw, pitch: current.pitch, roll: current.roll };
    const neutral = this.neutral;
    const release = o.releaseRatio ?? 0.5;
    const angleOf = (axis: 'yaw' | 'pitch' | 'roll') =>
      axis === 'yaw'
        ? (o.turnAngle ?? 25)
        : axis === 'pitch'
          ? (o.lookAngle ?? 15)
          : (o.tiltAngle ?? 20);
    const dev = {
      yaw: current.yaw - neutral.yaw,
      pitch: current.pitch - neutral.pitch,
      roll: current.roll - neutral.roll,
    };
    const nearNeutral = (['yaw', 'pitch', 'roll'] as const).every(
      (a) => Math.abs(dev[a]) < angleOf(a) * release
    );
    if (nearNeutral) {
      // Slow drift toward the resting pose; frozen while the head is away from it.
      neutral.yaw += dev.yaw * 0.02;
      neutral.pitch += dev.pitch * 0.02;
      neutral.roll += dev.roll * 0.02;
    }

    const event =
      this.oscillations(history, t, trackingId) ??
      this.directional(dev, t, angleOf, release, trackingId) ??
      this.hold(history, t, trackingId);
    if (event) this.cooldownUntil = t + (o.cooldownMs ?? 500);
    return event;
  }

  reset(): void {
    this.neutral = undefined;
    this.candidates.clear();
    this.fired.clear();
    this.cooldownUntil = 0;
    this.consumedUntil = 0;
    this.oscillationFired = false;
    this.holdFired = false;
  }

  private oscillations(
    history: readonly PoseSample[],
    t: number,
    trackingId?: number
  ): HeadGestureEvent | null {
    const o = this.options;
    if (this.oscillationFired) {
      // One nod/shake per bout: re-arm only once the head has settled.
      const recent = history.filter((s) => s.timestamp >= t - 300);
      const quiet = Math.min(o.nodAmplitude ?? 8, o.shakeAmplitude ?? 10) / 2;
      if (range(recent, 'yaw') > quiet || range(recent, 'pitch') > quiet) return null;
      this.oscillationFired = false;
      this.consumedUntil = t;
    }
    if (t < this.cooldownUntil) return null;
    const windowStart = Math.max(t - (o.oscillationWindowMs ?? 1200), this.consumedUntil);
    const window = history.filter((s) => s.timestamp > windowStart);
    const cross = o.crossAxisRatio ?? 0.6;

    const check = (type: 'nod' | 'shake'): HeadGestureEvent | null => {
      if (!this.enabled.has(type)) return null;
      const axis = type === 'nod' ? 'pitch' : 'yaw';
      const other = type === 'nod' ? 'yaw' : 'pitch';
      const amplitude = type === 'nod' ? (o.nodAmplitude ?? 8) : (o.shakeAmplitude ?? 10);
      const needed = type === 'nod' ? (o.nodSwings ?? 2) : (o.shakeSwings ?? 3);
      const osc = countSwings(window, axis, amplitude);
      if (osc.swings < needed) return null;
      const offAxis = range(window, other) / Math.max(osc.range, 1e-6);
      if (offAxis > cross) return null;
      return {
        type,
        confidence: clamp(osc.meanAmplitude / (amplitude * 2)) * (1 - offAxis * 0.5),
        duration: t - osc.startedAt,
        timestamp: t,
        trackingId,
      };
    };

    const event = check('shake') ?? check('nod');
    if (event) {
      this.consumedUntil = t;
      this.oscillationFired = true;
      // The swings just crossed turn/look angles; don't report those separately.
      this.candidates.clear();
      for (const g of Object.keys(DIRECTIONAL) as Directional[]) this.fired.add(g);
    }
    return event;
  }

  private directional(
    dev: { yaw: number; pitch: number; roll: number },
    t: number,
    angleOf: (axis: 'yaw' | 'pitch' | 'roll') => number,
    release: number,
    trackingId?: number
  ): HeadGestureEvent | null {
    let result: HeadGestureEvent | null = null;
    for (const [type, { axis, sign }] of Object.entries(DIRECTIONAL) as [
      Directional,
      (typeof DIRECTIONAL)[Directional],
    ][]) {
      const angle = angleOf(axis);
      const d = dev[axis] * sign;
      if (this.fired.has(type)) {
        if (d < angle * release) this.fired.delete(type);
        continue;
      }
      if (!this.enabled.has(type) || d < angle) {
        this.candidates.delete(type);
        continue;
      }
      const since = this.candidates.get(type) ?? t;
      this.candidates.set(type, since);
      if (!result && t >= this.cooldownUntil && t - since >= (this.options.sustainMs ?? 150)) {
        this.fired.add(type);
        this.candidates.delete(type);
        result = {
          type,
          confidence: clamp(d / (angle * 1.5)),
          duration: t - since,
          timestamp: t,
          trackingId,
        };
      }
    }
    return result;
  }

  private hold(
    history: readonly PoseSample[],
    t: number,
    trackingId?: number
  ): HeadGestureEvent | null {
    if (!this.enabled.has('hold')) return null;
    const holdMs = this.options.holdMs ?? 1000;
    const tolerance = this.options.holdTolerance ?? 3;
    const window = history.filter((s) => s.timestamp >= t - holdMs);
    const spread = Math.max(range(window, 'yaw'), range(window, 'pitch'), range(window, 'roll'));
    if (this.holdFired) {
      if (spread > tolerance * 2) this.holdFired = false;
      return null;
    }
    const covered = window.length > 1 && t - window[0]!.timestamp >= holdMs * 0.9;
    if (!covered || spread > tolerance || t < this.cooldownUntil) return null;
    this.holdFired = true;
    return {
      type: 'hold',
      confidence: clamp(1 - spread / tolerance),
      duration: t - window[0]!.timestamp,
      timestamp: t,
      trackingId,
    };
  }
}

import type { DetectedFace } from '../types';
import { eyeAspectRatios } from './face';
import { clamp } from './geometry';

export type BlinkType = 'blink' | 'left-wink' | 'right-wink';

export interface BlinkEvent {
  type: BlinkType;
  /** ms the eye(s) stayed closed. */
  duration: number;
  timestamp: number;
  /** Blinks (not winks) so far. */
  count: number;
  source: EyeSignalSource;
}

/**
 * `probability`: ML Kit eye-open probabilities (Android).
 * `eye-aspect-ratio`: eye contour height/width relative to the person's own open-eye baseline.
 */
export type EyeSignalSource = 'probability' | 'eye-aspect-ratio';

export interface BlinkOptions {
  /** Openness (0..1) below which an eye counts as closed. Default 0.35 (probability), 0.7 (EAR). */
  closedThreshold?: number;
  /** Openness above which a closed eye counts as open again. Default 0.55 (probability), 0.85 (EAR). */
  openThreshold?: number;
  /** Closures shorter than this are noise, ms. Default 0 (one frame is enough at low fps). */
  minDuration?: number;
  /** Closures longer than this are eyes shut, not a blink, ms. Default 500. */
  maxDuration?: number;
  /** Min ms between reported blinks. Default 150. */
  debounce?: number;
  /**
   * Report single-eye winks. Only with probabilities: contour-based per-eye openness is too noisy
   * to tell a wink from a squint. Default false.
   */
  winks?: boolean;
}

interface Reopen {
  at: number;
  duration: number;
}

const PAIR_MS = 120;

export interface EyeOpenness {
  left: number;
  right: number;
  source: EyeSignalSource;
}

/**
 * Temporal blink detection: an eye-open probability is a per-frame state, a blink is a
 * closed-then-open transition inside a duration window. Hysteresis between the closed and
 * open thresholds stops a value hovering at the edge from producing several blinks.
 *
 * Needs roughly 15+ analyzed fps; a 150 ms blink spans only two frames at 15 fps.
 */
export class BlinkDetector {
  private closedSince: { left?: number; right?: number } = {};
  private reopened: { left?: Reopen; right?: Reopen } = {};
  private lastEvent = -Infinity;
  private count = 0;
  private baseline = { left: 0, right: 0 };
  private samples = 0;

  constructor(private readonly options: BlinkOptions = {}) {}

  /** 0..1 openness per eye, or null when the face carries no usable signal. */
  openness(face: Pick<DetectedFace, 'probabilities' | 'contours'>): EyeOpenness | null {
    const p = face.probabilities;
    if (p?.leftEyeOpen !== undefined && p.rightEyeOpen !== undefined) {
      return { left: p.leftEyeOpen, right: p.rightEyeOpen, source: 'probability' };
    }
    const ear = eyeAspectRatios(face);
    if (ear.left === undefined || ear.right === undefined) return null;
    // Rises fast, decays slowly: tracks the open-eye ratio without following blinks down.
    const track = (base: number, v: number) =>
      v > base ? base + (v - base) * 0.3 : base + (v - base) * 0.01;
    this.baseline.left = this.samples === 0 ? ear.left : track(this.baseline.left, ear.left);
    this.baseline.right = this.samples === 0 ? ear.right : track(this.baseline.right, ear.right);
    this.samples++;
    // Not enough history to know what "open" looks like for this face yet.
    if (this.samples < 10) return null;
    return {
      left: clamp(ear.left / this.baseline.left),
      right: clamp(ear.right / this.baseline.right),
      source: 'eye-aspect-ratio',
    };
  }

  update(
    face: Pick<DetectedFace, 'probabilities' | 'contours'>,
    timestamp: number
  ): BlinkEvent | null {
    const eyes = this.openness(face);
    if (!eyes) return null;
    // EAR normalized to baseline sits near 1 when open, so it needs tighter thresholds.
    const closedT = this.options.closedThreshold ?? (eyes.source === 'probability' ? 0.35 : 0.7);
    const openT = this.options.openThreshold ?? (eyes.source === 'probability' ? 0.55 : 0.85);

    for (const side of ['left', 'right'] as const) {
      const v = eyes[side];
      const since = this.closedSince[side];
      if (since === undefined && v < closedT) this.closedSince[side] = timestamp;
      else if (since !== undefined && v > openT) {
        this.reopened[side] = { at: timestamp, duration: timestamp - since };
        this.closedSince[side] = undefined;
      }
    }

    const min = this.options.minDuration ?? 0;
    const max = this.options.maxDuration ?? 500;
    const ok = (r: Reopen | undefined) => r !== undefined && r.duration >= min && r.duration <= max;
    const { left, right } = this.reopened;

    let type: BlinkType | undefined;
    let duration = 0;
    // The eyes can reopen a frame apart, so pair reopenings within PAIR_MS.
    if (left && right && Math.abs(left.at - right.at) <= PAIR_MS) {
      if (ok(left) && ok(right)) {
        type = 'blink';
        duration = Math.max(left.duration, right.duration);
      }
      this.reopened = {};
    } else if (this.options.winks && eyes.source === 'probability') {
      // A wink: one eye reopened and the other stayed open the whole time.
      for (const [side, other, wink] of [
        ['left', 'right', 'left-wink'],
        ['right', 'left', 'right-wink'],
      ] as const) {
        const r = this.reopened[side];
        if (!r || timestamp - r.at < PAIR_MS) continue;
        if (ok(r) && this.closedSince[other] === undefined && !this.reopened[other]) {
          type = wink;
          duration = r.duration;
        }
        this.reopened[side] = undefined;
      }
    }
    // Stale unpaired reopenings would otherwise pair with a much later one.
    for (const side of ['left', 'right'] as const) {
      const r = this.reopened[side];
      if (r && timestamp - r.at > PAIR_MS * 2) this.reopened[side] = undefined;
    }

    if (!type || timestamp - this.lastEvent < (this.options.debounce ?? 150)) return null;
    this.lastEvent = timestamp;
    if (type === 'blink') this.count++;
    return { type, duration, timestamp, count: this.count, source: eyes.source };
  }

  reset(): void {
    this.closedSince = {};
    this.reopened = {};
    this.lastEvent = -Infinity;
    this.count = 0;
    this.baseline = { left: 0, right: 0 };
    this.samples = 0;
  }
}

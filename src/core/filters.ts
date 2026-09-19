/**
 * Smoothing for noisy per-frame signals.
 *
 * A plain EMA trades jitter for lag with one knob: heavy smoothing makes a still face rock solid
 * but a moving face trails behind. The One Euro filter (Casiez et al. 2012) raises its cutoff with
 * the signal's speed, so it smooths hard at rest and follows quickly on motion. It's the default;
 * EMA stays available for predictable, speed-independent behaviour.
 */

export type FilterKind = 'one-euro' | 'ema';

export interface SmoothingOptions {
  /** 0 = raw, 1 = frozen. Default 0.5. */
  smoothing?: number;
  /** Default `one-euro`. */
  filter?: FilterKind;
  /**
   * One Euro speed coefficient, in 1/(signal unit). Higher follows fast motion more tightly.
   * Callers pick a sensible default per unit (pixels vs degrees).
   */
  beta?: number;
}

export interface ScalarFilter {
  filter(value: number, timestampMs: number): number;
  reset(): void;
}

const TWO_PI = Math.PI * 2;

function alpha(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (TWO_PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

export class OneEuroFilter implements ScalarFilter {
  private x: number | undefined;
  private dx = 0;
  private t = 0;

  constructor(
    private readonly minCutoff = 1,
    private readonly beta = 0,
    private readonly dCutoff = 1
  ) {}

  filter(value: number, timestampMs: number): number {
    if (this.x === undefined) {
      this.x = value;
      this.t = timestampMs;
      return value;
    }
    // Duplicate or out-of-order timestamps would divide by zero.
    const dt = Math.max((timestampMs - this.t) / 1000, 1e-3);
    this.t = timestampMs;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.x = undefined;
    this.dx = 0;
  }
}

/** Frame-rate independent EMA: `smoothing` is the weight kept per 1/30 s. */
export class EmaFilter implements ScalarFilter {
  private x: number | undefined;
  private t = 0;

  constructor(private readonly smoothing: number) {}

  filter(value: number, timestampMs: number): number {
    if (this.x === undefined || this.smoothing <= 0) {
      this.x = value;
      this.t = timestampMs;
      return value;
    }
    const frames = Math.max(timestampMs - this.t, 1) / (1000 / 30);
    this.t = timestampMs;
    const keep = Math.pow(this.smoothing, frames);
    this.x = this.x * keep + value * (1 - keep);
    return this.x;
  }

  reset(): void {
    this.x = undefined;
  }
}

class PassThrough implements ScalarFilter {
  filter(value: number): number {
    return value;
  }
  reset(): void {}
}

/**
 * Maps the 0..1 `smoothing` knob onto a filter. For One Euro it moves the min cutoff from 8 Hz
 * (barely filtered) down to 0.3 Hz (very steady at rest).
 */
export function createFilter(options: SmoothingOptions = {}, defaultBeta = 0): ScalarFilter {
  const smoothing = Math.min(Math.max(options.smoothing ?? 0.5, 0), 0.99);
  if (smoothing === 0) return new PassThrough();
  if (options.filter === 'ema') return new EmaFilter(smoothing);
  const minCutoff = 8 * Math.pow(0.3 / 8, smoothing);
  return new OneEuroFilter(minCutoff, options.beta ?? defaultBeta);
}

/** Named scalar filters created on first use, e.g. one per coordinate of a contour. */
export class FilterBank {
  private readonly filters = new Map<string, ScalarFilter>();

  constructor(
    private readonly options: SmoothingOptions,
    private readonly defaultBeta = 0
  ) {}

  filter(key: string, value: number, timestampMs: number): number {
    let f = this.filters.get(key);
    if (!f) {
      f = createFilter(this.options, this.defaultBeta);
      this.filters.set(key, f);
    }
    return f.filter(value, timestampMs);
  }

  reset(): void {
    this.filters.clear();
  }
}

export interface StabilitySample {
  timestamp: number;
  /** Normalized face center, 0..1. */
  x: number;
  y: number;
  /** Face width / frame width. */
  scale: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
}

export interface StabilityOptions {
  /** Window the deviations are measured over, ms. Default 400. */
  windowMs?: number;
  /** Max standard deviation of the normalized center. Default 0.012. */
  maxPositionDeviation?: number;
  /** Max standard deviation of the scale. Default 0.012. */
  maxScaleDeviation?: number;
  /** Max standard deviation of each angle, degrees. Default 2.5. */
  maxAngleDeviation?: number;
}

export interface StabilityState {
  stable: boolean;
  /** ms the face has been continuously stable, 0 when not stable. */
  stableFor: number;
  deviation: { position: number; scale: number; yaw: number; pitch: number; roll: number };
}

const EMPTY: StabilityState = {
  stable: false,
  stableFor: 0,
  deviation: { position: 0, scale: 0, yaw: 0, pitch: 0, roll: 0 },
};

function std(values: number[]): number {
  if (values.length < 2) return 0;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= values.length;
  let sq = 0;
  for (const v of values) sq += (v - mean) * (v - mean);
  return Math.sqrt(sq / values.length);
}

/**
 * Standard deviation of position, size and pose over a sliding time window. Independent of
 * auto capture; feed it one sample per analyzed frame and `reset()` when the face is lost.
 */
export class StabilityDetector {
  private samples: StabilitySample[] = [];
  private stableSince: number | undefined;
  private readonly windowMs: number;

  constructor(private readonly options: StabilityOptions = {}) {
    this.windowMs = options.windowMs ?? 400;
  }

  update(sample: StabilitySample): StabilityState {
    this.samples.push(sample);
    const cutoff = sample.timestamp - this.windowMs;
    while (this.samples.length > 0 && this.samples[0]!.timestamp < cutoff) this.samples.shift();

    const pick = (k: keyof StabilitySample) =>
      this.samples.map((s) => s[k]).filter((v): v is number => v !== undefined);
    const position = Math.max(std(pick('x')), std(pick('y')));
    const deviation = {
      position,
      scale: std(pick('scale')),
      yaw: std(pick('yaw')),
      pitch: std(pick('pitch')),
      roll: std(pick('roll')),
    };
    const maxAngle = this.options.maxAngleDeviation ?? 2.5;
    // Need most of a window of history before calling anything stable.
    const covered = sample.timestamp - this.samples[0]!.timestamp >= this.windowMs * 0.6;
    const stable =
      covered &&
      this.samples.length >= 3 &&
      position <= (this.options.maxPositionDeviation ?? 0.012) &&
      deviation.scale <= (this.options.maxScaleDeviation ?? 0.012) &&
      deviation.yaw <= maxAngle &&
      deviation.pitch <= maxAngle &&
      deviation.roll <= maxAngle;

    // The whole window was already still when it first qualifies, so count from its start.
    if (!stable) this.stableSince = undefined;
    else if (this.stableSince === undefined) this.stableSince = this.samples[0]!.timestamp;

    return {
      stable,
      stableFor: this.stableSince === undefined ? 0 : sample.timestamp - this.stableSince,
      deviation,
    };
  }

  reset(): StabilityState {
    this.samples = [];
    this.stableSince = undefined;
    return EMPTY;
  }
}

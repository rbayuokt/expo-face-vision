import type { HeadDirection, HeadPose } from '../types';
import { getHeadDirection, type DirectionThresholds } from './face';
import { createFilter, type ScalarFilter, type SmoothingOptions } from './filters';
import { StabilityDetector, type StabilityOptions } from './stability';

export interface PoseSample {
  timestamp: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** Normalized face center. */
  x: number;
  y: number;
  scale: number;
}

export interface HeadMovement {
  /** Direction the head is currently turning, subject-centric. */
  horizontal: 'left' | 'right' | 'stable';
  vertical: 'up' | 'down' | 'stable';
  /** As the subject feels it: `clockwise` = top of the head moving toward their right shoulder. */
  roll: 'clockwise' | 'counterClockwise' | 'stable';
  /** Degrees per second of the filtered pose. */
  velocity: { yaw: number; pitch: number; roll: number };
  /** Where the head points, not where it's moving. */
  direction: HeadDirection;
  stable: boolean;
  stableFor: number;
  /** Filtered pose. */
  pose: PoseSample;
}

export interface HeadTrackingOptions extends SmoothingOptions {
  /** Degrees/s before a turn counts as movement. Default 25. */
  velocityThreshold?: number;
  /** Pose history length, ms. Default 1500. */
  historyMs?: number;
  directionThresholds?: DirectionThresholds;
  stability?: StabilityOptions;
}

type Axis = 'yaw' | 'pitch' | 'roll' | 'x' | 'y' | 'scale';
const AXES: Axis[] = ['yaw', 'pitch', 'roll', 'x', 'y', 'scale'];

/**
 * Multi-frame head tracking: filters the raw pose, derives angular velocity and keeps a
 * short history for gesture recognition. Velocity comes from the filtered signal, so a
 * single noisy frame can't register as a turn.
 */
export class HeadTracker {
  private filters: Record<Axis, ScalarFilter>;
  private velocity = { yaw: 0, pitch: 0, roll: 0 };
  private last: PoseSample | undefined;
  private readonly stability: StabilityDetector;
  readonly history: PoseSample[] = [];

  constructor(private readonly options: HeadTrackingOptions = {}) {
    this.filters = this.makeFilters();
    this.stability = new StabilityDetector(options.stability);
  }

  update(
    pose: Pick<HeadPose, 'yaw' | 'pitch' | 'roll' | 'normalizedPosition' | 'scale'>,
    timestamp: number
  ): HeadMovement {
    const raw = {
      yaw: pose.yaw,
      pitch: pose.pitch,
      roll: pose.roll,
      x: pose.normalizedPosition.x,
      y: pose.normalizedPosition.y,
      scale: pose.scale,
    };
    const filtered = { timestamp } as PoseSample;
    for (const axis of AXES) filtered[axis] = this.filters[axis].filter(raw[axis], timestamp);

    if (this.last) {
      const dt = Math.max((timestamp - this.last.timestamp) / 1000, 1e-3);
      for (const axis of ['yaw', 'pitch', 'roll'] as const) {
        const v = (filtered[axis] - this.last[axis]) / dt;
        // Light extra smoothing: differentiation amplifies whatever noise the filter let through.
        this.velocity[axis] = this.velocity[axis] * 0.5 + v * 0.5;
      }
    }
    this.last = filtered;

    this.history.push(filtered);
    const cutoff = timestamp - (this.options.historyMs ?? 1500);
    while (this.history.length > 0 && this.history[0]!.timestamp < cutoff) this.history.shift();

    const stability = this.stability.update({ ...filtered });
    const vt = this.options.velocityThreshold ?? 25;
    const v = this.velocity;
    return {
      horizontal: v.yaw > vt ? 'right' : v.yaw < -vt ? 'left' : 'stable',
      vertical: v.pitch > vt ? 'up' : v.pitch < -vt ? 'down' : 'stable',
      roll: v.roll > vt ? 'clockwise' : v.roll < -vt ? 'counterClockwise' : 'stable',
      velocity: { ...v },
      direction: getHeadDirection(filtered, this.options.directionThresholds),
      stable: stability.stable,
      stableFor: stability.stableFor,
      pose: filtered,
    };
  }

  reset(): void {
    this.filters = this.makeFilters();
    this.velocity = { yaw: 0, pitch: 0, roll: 0 };
    this.last = undefined;
    this.history.length = 0;
    this.stability.reset();
  }

  private makeFilters(): Record<Axis, ScalarFilter> {
    const out = {} as Record<Axis, ScalarFilter>;
    // Degrees need a larger beta than normalized 0..1 values to react to motion.
    for (const axis of AXES)
      out[axis] = createFilter(
        this.options,
        axis === 'yaw' || axis === 'pitch' || axis === 'roll' ? 0.05 : 1
      );
    return out;
  }
}

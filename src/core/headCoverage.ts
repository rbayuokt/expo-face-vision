import type { EulerAngles } from '../types';

export interface HeadCoverageOptions {
  /** Ticks around the circle. Default 60. */
  segments?: number;
  /** Yaw (degrees) that alone reaches a segment. Default 15. */
  minYaw?: number;
  /** Pitch (degrees) that alone reaches a segment; heads pitch less than they turn. Default 10. */
  minPitch?: number;
  /** Also mark this many neighbours on each side, so a smooth sweep leaves no gaps. Default 2. */
  spread?: number;
  /**
   * Lay the circle out as the user sees a mirrored (front camera) preview, so turning to your
   * right fills the right side. Default true.
   */
  mirrored?: boolean;
}

export interface HeadCoverage {
  /** One flag per segment, clockwise from 12 o'clock. */
  covered: boolean[];
  count: number;
  /** count / segments. */
  progress: number;
  complete: boolean;
  /** Segment the head points at right now, or -1 while it's near center. */
  current: number;
}

export function emptyCoverage(segments = 60): HeadCoverage {
  return {
    covered: new Array(segments).fill(false),
    count: 0,
    progress: 0,
    complete: false,
    current: -1,
  };
}

/**
 * The Face ID enrollment circle: the head's yaw/pitch direction picks a segment on a ring, and
 * tilting far enough that way marks it. Yaw and pitch are scaled by their own thresholds, so
 * the reachable area is an ellipse and diagonals are as easy as straight turns.
 */
export class HeadCoverageTracker {
  private covered: boolean[];
  private readonly segments: number;

  constructor(private readonly options: HeadCoverageOptions = {}) {
    this.segments = options.segments ?? 60;
    this.covered = new Array(this.segments).fill(false);
  }

  /** Segment for a pose, or -1 when the head isn't tilted far enough in any direction. */
  segmentFor(pose: Pick<EulerAngles, 'yaw' | 'pitch'>): number {
    const x = (pose.yaw / (this.options.minYaw ?? 15)) * (this.options.mirrored === false ? -1 : 1);
    const y = pose.pitch / (this.options.minPitch ?? 10);
    if (Math.hypot(x, y) < 1) return -1;
    // Clockwise from 12 o'clock: up (pitch > 0) is 0°, screen right is 90°.
    const degrees = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
    return Math.round((degrees / 360) * this.segments) % this.segments;
  }

  update(pose: Pick<EulerAngles, 'yaw' | 'pitch'>): HeadCoverage {
    const current = this.segmentFor(pose);
    if (current >= 0) {
      const spread = this.options.spread ?? 2;
      for (let d = -spread; d <= spread; d++) {
        this.covered[(current + d + this.segments) % this.segments] = true;
      }
    }
    return this.snapshot(current);
  }

  reset(): HeadCoverage {
    this.covered = new Array(this.segments).fill(false);
    return this.snapshot(-1);
  }

  private snapshot(current: number): HeadCoverage {
    const count = this.covered.filter(Boolean).length;
    return {
      covered: [...this.covered],
      count,
      progress: count / this.segments,
      complete: count === this.segments,
      current,
    };
  }
}

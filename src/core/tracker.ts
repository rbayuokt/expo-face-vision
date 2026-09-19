import type { DetectedFace, FaceContours, FaceLandmarks, Point, Size } from '../types';
import { toHeadPose, type DirectionThresholds } from './face';
import { FilterBank, type SmoothingOptions } from './filters';
import { iou, normalizeRect } from './geometry';

export interface TrackingOptions extends SmoothingOptions {
  /** Default true. */
  enabled?: boolean;
  /** ms a face may go unseen before it's reported lost. Default 500. */
  timeout?: number;
  /** Min IoU to associate a detection with a track when the platform gives no ids. Default 0.3. */
  minIou?: number;
  /** Smooth landmark and contour points too. Default true. */
  smoothPoints?: boolean;
  directionThresholds?: DirectionThresholds;
}

export interface TrackedFace extends DetectedFace {
  trackingId: number;
  /** ms timestamps. */
  firstSeen: number;
  lastSeen: number;
  /** Frames this track has been matched in. */
  frames: number;
  /** The unsmoothed detection from the latest frame. */
  raw: DetectedFace;
}

export interface TrackerUpdate {
  faces: TrackedFace[];
  entered: TrackedFace[];
  updated: TrackedFace[];
  lost: TrackedFace[];
}

interface Track {
  id: number;
  face: TrackedFace;
  filters: FilterBank;
  angleFilters: FilterBank;
  pointFilters: FilterBank;
}

// Beta per unit: bounds move in pixels, angles in degrees.
const PIXEL_BETA = 0.02;
const ANGLE_BETA = 0.05;

/**
 * Keeps ids stable across frames and smooths geometry. Uses the platform's tracking ids when
 * present (ML Kit) and greedy IoU association otherwise (Vision). A track survives short
 * dropouts up to `timeout`, so a single missed detection doesn't fire lost/entered.
 */
export class FaceTracker {
  private tracks = new Map<number, Track>();
  private nextId = 1;
  private readonly timeout: number;
  private readonly minIou: number;

  constructor(private readonly options: TrackingOptions = {}) {
    this.timeout = options.timeout ?? 500;
    this.minIou = options.minIou ?? 0.3;
  }

  update(faces: DetectedFace[], image: Size, timestamp: number): TrackerUpdate {
    const entered: TrackedFace[] = [];
    const updated: TrackedFace[] = [];
    const matched = new Set<number>();
    const assignments = this.associate(faces);

    faces.forEach((face, i) => {
      let id = assignments[i];
      let track = id === undefined ? undefined : this.tracks.get(id);
      if (!track) {
        id = face.trackingId ?? this.allocateId();
        track = {
          id,
          face: undefined as unknown as TrackedFace,
          filters: new FilterBank(this.options, PIXEL_BETA),
          angleFilters: new FilterBank(this.options, ANGLE_BETA),
          pointFilters: new FilterBank(this.options, PIXEL_BETA),
        };
        this.tracks.set(id, track);
        track.face = this.smooth(track, face, image, timestamp, timestamp, 0);
        entered.push(track.face);
      } else {
        track.face = this.smooth(
          track,
          face,
          image,
          timestamp,
          track.face.firstSeen,
          track.face.frames
        );
        updated.push(track.face);
      }
      matched.add(track.id);
    });

    const lost: TrackedFace[] = [];
    for (const [id, track] of this.tracks) {
      if (!matched.has(id) && timestamp - track.face.lastSeen > this.timeout) {
        lost.push(track.face);
        this.tracks.delete(id);
      }
    }

    return {
      faces: [...entered, ...updated].sort((a, b) => a.trackingId - b.trackingId),
      entered,
      updated,
      lost,
    };
  }

  /** Every live track, including ones briefly unseen but not timed out yet. */
  get tracked(): TrackedFace[] {
    return [...this.tracks.values()].map((t) => t.face);
  }

  reset(): TrackedFace[] {
    const lost = this.tracked;
    this.tracks.clear();
    return lost;
  }

  private allocateId(): number {
    while (this.tracks.has(this.nextId)) this.nextId++;
    return this.nextId++;
  }

  private associate(faces: DetectedFace[]): (number | undefined)[] {
    const result: (number | undefined)[] = faces.map((f) =>
      f.trackingId !== undefined && this.tracks.has(f.trackingId) ? f.trackingId : undefined
    );
    // Greedy by IoU for the rest; a handful of faces makes Hungarian overkill.
    const taken = new Set(result.filter((id): id is number => id !== undefined));
    const pairs: { i: number; id: number; score: number }[] = [];
    faces.forEach((f, i) => {
      if (result[i] !== undefined || f.trackingId !== undefined) return;
      for (const [id, track] of this.tracks) {
        if (taken.has(id)) continue;
        const score = iou(f.bounds, track.face.raw.bounds);
        if (score >= this.minIou) pairs.push({ i, id, score });
      }
    });
    pairs.sort((a, b) => b.score - a.score);
    for (const { i, id } of pairs) {
      if (result[i] !== undefined || taken.has(id)) continue;
      result[i] = id;
      taken.add(id);
    }
    return result;
  }

  private smooth(
    track: Track,
    face: DetectedFace,
    image: Size,
    t: number,
    firstSeen: number,
    frames: number
  ): TrackedFace {
    const f = (k: string, v: number) => track.filters.filter(k, v, t);
    const bounds = {
      x: f('x', face.bounds.x),
      y: f('y', face.bounds.y),
      width: f('w', face.bounds.width),
      height: f('h', face.bounds.height),
    };
    const out: TrackedFace = {
      ...face,
      trackingId: track.id,
      bounds,
      normalizedBounds: normalizeRect(bounds, image),
      firstSeen,
      lastSeen: t,
      frames: frames + 1,
      raw: face,
    };
    if (face.headPose) {
      const a = (k: string, v: number) => track.angleFilters.filter(k, v, t);
      out.headPose = toHeadPose(
        {
          yaw: a('yaw', face.headPose.yaw),
          pitch: a('pitch', face.headPose.pitch),
          roll: a('roll', face.headPose.roll),
        },
        bounds,
        image,
        this.options.directionThresholds
      );
    }
    if (this.options.smoothPoints !== false) {
      if (face.landmarks) out.landmarks = this.smoothLandmarks(track, face.landmarks, t);
      if (face.contours) out.contours = this.smoothContours(track, face.contours, t);
    }
    return out;
  }

  private smoothPoint(track: Track, key: string, p: Point, t: number): Point {
    return {
      x: track.pointFilters.filter(`${key}.x`, p.x, t),
      y: track.pointFilters.filter(`${key}.y`, p.y, t),
    };
  }

  private smoothLandmarks(track: Track, landmarks: FaceLandmarks, t: number): FaceLandmarks {
    const out: FaceLandmarks = {};
    for (const [k, p] of Object.entries(landmarks) as [keyof FaceLandmarks, Point][]) {
      out[k] = this.smoothPoint(track, `l.${k}`, p, t);
    }
    return out;
  }

  private smoothContours(track: Track, contours: FaceContours, t: number): FaceContours {
    const out: FaceContours = {};
    for (const [k, points] of Object.entries(contours) as [keyof FaceContours, Point[]][]) {
      // Point counts are fixed per contour type, so index keys stay meaningful.
      out[k] = points.map((p, i) => this.smoothPoint(track, `c.${k}.${i}`, p, t));
    }
    return out;
  }
}

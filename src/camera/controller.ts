import type { NativeCameraRef, TakePhotoOptions } from '../ExpoFaceVisionCameraView';
import { createTransform, visibleSourceRect, type Transform } from '../core/coordinates';
import { toDetectedFace, type DirectionThresholds } from '../core/face';
import type { FaceRegion } from '../core/region';
import { FaceTracker, type TrackerUpdate, type TrackingOptions } from '../core/tracker';
import type { FaceFrame, NativeFrame, ProcessedImage, ResizeMode, Size } from '../types';

export type FrameListener = (frame: FaceFrame, tracking: TrackerUpdate | null) => void;

/** Oval guide as fractions of the preview view. */
export interface GuideShape {
  /** Default 0.72. */
  width?: number;
  /** Default 0.48. */
  height?: number;
  /** Center, fraction of the preview height. Default 0.45. */
  centerY?: number;
}

export interface FaceCameraControllerOptions {
  /** `true`, `false` or options. Default true. */
  tracking?: boolean | TrackingOptions;
  directionThresholds?: DirectionThresholds;
}

/**
 * The JS end of a camera: turns native frames into `FaceFrame`s (derived fields, tracking,
 * preview coordinates) and fans them out to listeners. Frames never touch React state here;
 * hooks and overlays subscribe and decide what's worth a render.
 */
export class FaceCameraController {
  latest: FaceFrame | null = null;
  private listeners = new Set<FrameListener>();
  private tracker: FaceTracker | null = null;
  private trackingKey = '';
  private view: NativeCameraRef | null = null;
  private preview: Size | undefined;
  private resizeMode: ResizeMode = 'cover';
  private directionThresholds: DirectionThresholds | undefined;

  constructor(options: FaceCameraControllerOptions = {}) {
    this.configure(options);
  }

  configure(options: FaceCameraControllerOptions): void {
    this.directionThresholds = options.directionThresholds;
    const tracking = options.tracking ?? true;
    const opts = typeof tracking === 'object' ? tracking : { enabled: tracking };
    const key = JSON.stringify(opts);
    if (key === this.trackingKey) return;
    this.trackingKey = key;
    this.tracker = opts.enabled === false ? null : new FaceTracker(opts);
  }

  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Frame -> preview transform for the latest frame, once both sizes are known. */
  get transform(): Transform | null {
    const f = this.latest;
    if (!f || !this.preview) return null;
    return createTransform({
      source: f.frame,
      mirrored: f.mirrored,
      target: this.preview,
      resizeMode: this.resizeMode,
    });
  }

  /** A preview-space guide oval as a region in frame pixels, for validation. */
  toFrameRegion(guide: GuideShape = {}): FaceRegion | null {
    const t = this.transform;
    const p = this.preview;
    if (!t || !p) return null;
    const center = t.invertPoint({ x: p.width / 2, y: p.height * (guide.centerY ?? 0.45) });
    return {
      type: 'oval',
      cx: center.x,
      cy: center.y,
      rx: (p.width * (guide.width ?? 0.72)) / 2 / t.scale,
      ry: (p.height * (guide.height ?? 0.48)) / 2 / t.scale,
    };
  }

  takePhoto(options: TakePhotoOptions = {}): Promise<ProcessedImage> {
    if (!this.view) return Promise.reject(new Error('The camera is not mounted.'));
    return this.view.takePhoto(options);
  }

  /** Drops all tracks and tells listeners they were lost. */
  reset(): void {
    const lost = this.tracker?.reset() ?? [];
    if (!this.latest) return;
    const frame = { ...this.latest, faces: [] };
    this.latest = frame;
    this.emit(frame, lost.length ? { faces: [], entered: [], updated: [], lost } : null);
  }

  /** @internal */
  handleFrame(native: NativeFrame): void {
    let faces = native.faces.map((f) => toDetectedFace(f, native.frame, this.directionThresholds));
    let tracking: TrackerUpdate | null = null;
    if (this.tracker) {
      tracking = this.tracker.update(faces, native.frame, native.timestamp);
      faces = tracking.faces;
    }

    let visibleRect;
    if (this.preview) {
      const config = {
        source: native.frame,
        mirrored: native.mirrored,
        target: this.preview,
        resizeMode: this.resizeMode,
      };
      const t = createTransform(config);
      for (const f of faces) f.previewBounds = t.rect(f.bounds);
      visibleRect = visibleSourceRect(config);
    }

    const frame: FaceFrame = {
      faces,
      frame: native.frame,
      mirrored: native.mirrored,
      timestamp: native.timestamp,
      processingTime: native.processingTime,
      preview: this.preview,
      resizeMode: this.resizeMode,
      visibleRect,
    };
    this.latest = frame;
    this.emit(frame, tracking);
  }

  /** @internal */
  attach(view: NativeCameraRef | null): void {
    this.view = view;
  }

  /** @internal */
  setLayout(preview: Size, resizeMode: ResizeMode): void {
    this.preview = preview;
    this.resizeMode = resizeMode;
  }

  private emit(frame: FaceFrame, tracking: TrackerUpdate | null): void {
    for (const l of this.listeners) {
      try {
        l(frame, tracking);
      } catch (e) {
        // One bad listener shouldn't starve the others of frames.
        setTimeout(() => {
          throw e;
        });
      }
    }
  }
}

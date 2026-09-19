import type { Point, Rect, ResizeMode, Size } from '../types';

/** Clockwise degrees that turn the source upright. */
export type Rotation = 0 | 90 | 180 | 270;

export interface TransformConfig {
  /** Size of the space the input points live in (before `rotation`). */
  source: Size;
  /** Clockwise rotation that makes the source upright. Default 0. */
  rotation?: Rotation;
  /** Flip horizontally after rotating, as a front-camera preview does. Default false. */
  mirrored?: boolean;
  /** Size of the view the source is displayed in. */
  target: Size;
  /** How the upright source is fitted into `target`. Default `cover`. */
  resizeMode?: ResizeMode;
}

/**
 * source -> rotate -> mirror -> scale (cover/contain) -> center in target.
 * Precomputed so a frame with many points only pays for multiply-adds.
 */
export interface Transform {
  readonly scale: number;
  readonly offset: Point;
  /** Source size after rotation. */
  readonly upright: Size;
  point(p: Point): Point;
  rect(r: Rect): Rect;
  /** Target -> source, e.g. mapping a tap back into image pixels. */
  invertPoint(p: Point): Point;
}

export function uprightSize(size: Size, rotation: Rotation = 0): Size {
  return rotation === 90 || rotation === 270 ? { width: size.height, height: size.width } : size;
}

export function rotatePoint(p: Point, size: Size, rotation: Rotation): Point {
  switch (rotation) {
    case 90:
      return { x: size.height - p.y, y: p.x };
    case 180:
      return { x: size.width - p.x, y: size.height - p.y };
    case 270:
      return { x: p.y, y: size.width - p.x };
    default:
      return { x: p.x, y: p.y };
  }
}

function unrotatePoint(p: Point, size: Size, rotation: Rotation): Point {
  switch (rotation) {
    case 90:
      return { x: p.y, y: size.height - p.x };
    case 180:
      return { x: size.width - p.x, y: size.height - p.y };
    case 270:
      return { x: size.width - p.y, y: p.x };
    default:
      return { x: p.x, y: p.y };
  }
}

export function fitScale(source: Size, target: Size, resizeMode: ResizeMode = 'cover'): number {
  const sx = target.width / source.width;
  const sy = target.height / source.height;
  return resizeMode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
}

export function createTransform(config: TransformConfig): Transform {
  const rotation = config.rotation ?? 0;
  const mirrored = config.mirrored ?? false;
  const upright = uprightSize(config.source, rotation);
  const scale = fitScale(upright, config.target, config.resizeMode);
  const offset = {
    x: (config.target.width - upright.width * scale) / 2,
    y: (config.target.height - upright.height * scale) / 2,
  };

  const point = (p: Point): Point => {
    const r = rotatePoint(p, config.source, rotation);
    const x = mirrored ? upright.width - r.x : r.x;
    return { x: x * scale + offset.x, y: r.y * scale + offset.y };
  };

  return {
    scale,
    offset,
    upright,
    point,
    rect(r) {
      // Rotations are multiples of 90 and mirroring is axis aligned, so opposite corners stay opposite.
      const a = point({ x: r.x, y: r.y });
      const b = point({ x: r.x + r.width, y: r.y + r.height });
      return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
      };
    },
    invertPoint(p) {
      const ux = (p.x - offset.x) / scale;
      const uy = (p.y - offset.y) / scale;
      return unrotatePoint(
        { x: mirrored ? upright.width - ux : ux, y: uy },
        config.source,
        rotation
      );
    },
  };
}

export function transformPoint(point: Point, config: TransformConfig): Point {
  return createTransform(config).point(point);
}

export function transformBounds(rect: Rect, config: TransformConfig): Rect {
  return createTransform(config).rect(rect);
}

/**
 * The part of the upright source that is actually on screen. With `cover` the preview crops the
 * frame, so "inside the frame" checks should use this rather than the full frame.
 */
export function visibleSourceRect(config: TransformConfig): Rect {
  const t = createTransform(config);
  return {
    x: Math.max(0, -t.offset.x / t.scale),
    y: Math.max(0, -t.offset.y / t.scale),
    width: Math.min(t.upright.width, config.target.width / t.scale),
    height: Math.min(t.upright.height, config.target.height / t.scale),
  };
}

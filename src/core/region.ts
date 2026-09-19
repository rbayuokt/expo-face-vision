import type { Point, Rect, Size } from '../types';
import {
  boundingRect,
  clamp,
  intersectRects,
  pointInPolygon,
  rectArea,
  rectCenter,
} from './geometry';

/** Regions live in the same space as the face rect you test against them. */
export type FaceRegion =
  | ({ type: 'rect' } & Rect)
  | { type: 'oval'; cx: number; cy: number; rx: number; ry: number }
  | { type: 'polygon'; points: Point[] };

export interface RegionMetrics {
  /** `coverage >= minCoverage`. */
  inside: boolean;
  /** Fraction of the face rect that lies inside the region, 0..1. */
  coverage: number;
  centerInside: boolean;
  /**
   * Face center relative to the region center, in region half-sizes: 0 is dead center,
   * ±1 is the region edge. +x is right, +y is down.
   */
  offset: Point;
  /** Face width / region width. */
  sizeRatio: number;
  /** Center within `alignmentTolerance` and size within the configured range. */
  aligned: boolean;
}

export interface RegionOptions {
  /** Default 1 (face fully inside). */
  minCoverage?: number;
  /** Max |offset| on each axis to count as aligned. Default 0.2. */
  alignmentTolerance?: number;
  /** Accepted face width / region width for `aligned`. Default [0.5, 1.05]. */
  sizeRange?: [number, number];
}

export function regionBounds(region: FaceRegion): Rect {
  switch (region.type) {
    case 'rect':
      return { x: region.x, y: region.y, width: region.width, height: region.height };
    case 'oval':
      return {
        x: region.cx - region.rx,
        y: region.cy - region.ry,
        width: region.rx * 2,
        height: region.ry * 2,
      };
    case 'polygon':
      return boundingRect(region.points) ?? { x: 0, y: 0, width: 0, height: 0 };
  }
}

export function pointInRegion(p: Point, region: FaceRegion): boolean {
  switch (region.type) {
    case 'rect':
      return (
        p.x >= region.x &&
        p.x <= region.x + region.width &&
        p.y >= region.y &&
        p.y <= region.y + region.height
      );
    case 'oval': {
      const dx = (p.x - region.cx) / region.rx;
      const dy = (p.y - region.cy) / region.ry;
      return dx * dx + dy * dy <= 1;
    }
    case 'polygon':
      return pointInPolygon(p, region.points);
  }
}

const SAMPLES = 16;

function coverage(face: Rect, region: FaceRegion): number {
  if (rectArea(face) === 0) return 0;
  if (region.type === 'rect') {
    const overlap = intersectRects(face, region);
    return overlap ? rectArea(overlap) / rectArea(face) : 0;
  }
  // ponytail: 16x16 grid sample, ~0.4% resolution. Exact ellipse/polygon clipping if that ever matters.
  let hits = 0;
  for (let i = 0; i < SAMPLES; i++) {
    for (let j = 0; j < SAMPLES; j++) {
      const p = {
        x: face.x + ((i + 0.5) / SAMPLES) * face.width,
        y: face.y + ((j + 0.5) / SAMPLES) * face.height,
      };
      if (pointInRegion(p, region)) hits++;
    }
  }
  return hits / (SAMPLES * SAMPLES);
}

export function isFaceInsideRegion(
  face: Rect | { bounds: Rect },
  region: FaceRegion,
  options: RegionOptions = {}
): RegionMetrics {
  const rect = 'bounds' in face ? face.bounds : face;
  const bounds = regionBounds(region);
  const center = rectCenter(rect);
  const regionCenter = region.type === 'oval' ? { x: region.cx, y: region.cy } : rectCenter(bounds);
  const offset = {
    x: bounds.width ? (center.x - regionCenter.x) / (bounds.width / 2) : 0,
    y: bounds.height ? (center.y - regionCenter.y) / (bounds.height / 2) : 0,
  };
  const cov = coverage(rect, region);
  const sizeRatio = bounds.width ? rect.width / bounds.width : 0;
  const tolerance = options.alignmentTolerance ?? 0.2;
  const [minSize, maxSize] = options.sizeRange ?? [0.5, 1.05];
  return {
    inside: cov >= (options.minCoverage ?? 1) - 1e-9,
    coverage: cov,
    centerInside: pointInRegion(center, region),
    offset,
    sizeRatio,
    aligned:
      Math.abs(offset.x) <= tolerance &&
      Math.abs(offset.y) <= tolerance &&
      sizeRatio >= minSize &&
      sizeRatio <= maxSize,
  };
}

/** Oval centered in `size`, the usual selfie guide. `width`/`height` are fractions of `size`. */
export function centeredOval(size: Size, width = 0.7, height = 0.5, centerY = 0.45): FaceRegion {
  return {
    type: 'oval',
    cx: size.width / 2,
    cy: size.height * centerY,
    rx: (size.width * width) / 2,
    ry: (size.height * height) / 2,
  };
}

// Position analysis

export type HorizontalPosition = 'left' | 'center' | 'right';
export type VerticalPosition = 'high' | 'center' | 'low';
export type DistancePosition = 'too-close' | 'ok' | 'too-far';

export interface PositionOptions {
  /** Max |offset| from the area center, as a fraction of the area size. Default 0.1. */
  centerTolerance?: number;
  /** Face width / area width. Default 0.2. */
  minFaceSize?: number;
  /** Default 0.8. */
  maxFaceSize?: number;
  /**
   * Flip x so left/right describe what the user sees in a mirrored (front camera) preview.
   * Default false.
   */
  mirrored?: boolean;
  /** Visible part of the frame (see `visibleSourceRect`). Defaults to the whole frame. */
  visibleRect?: Rect;
}

export interface PositionAnalysis {
  centered: boolean;
  /** Where the face sits on screen. */
  horizontal: HorizontalPosition;
  vertical: VerticalPosition;
  distance: DistancePosition;
  /** Face center offset from the area center, as a fraction of the area size (±0.5 at edges). */
  offset: Point;
  /** Face width / area width. */
  faceSize: number;
  /** Fraction of the face rect inside the visible area. */
  visibility: number;
  fullyInsideFrame: boolean;
  partiallyOutsideFrame: boolean;
}

export function analyzeFacePosition(
  bounds: Rect,
  frame: Size,
  options: PositionOptions = {}
): PositionAnalysis {
  const area = options.visibleRect ?? { x: 0, y: 0, width: frame.width, height: frame.height };
  const tolerance = options.centerTolerance ?? 0.1;
  const center = rectCenter(bounds);
  let dx = (center.x - (area.x + area.width / 2)) / area.width;
  const dy = (center.y - (area.y + area.height / 2)) / area.height;
  if (options.mirrored) dx = -dx;
  const faceSize = bounds.width / area.width;
  const overlap = intersectRects(bounds, area);
  const visibility = rectArea(bounds) ? (overlap ? rectArea(overlap) : 0) / rectArea(bounds) : 0;

  return {
    centered: Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance,
    horizontal: dx < -tolerance ? 'left' : dx > tolerance ? 'right' : 'center',
    vertical: dy < -tolerance ? 'high' : dy > tolerance ? 'low' : 'center',
    distance:
      faceSize < (options.minFaceSize ?? 0.2)
        ? 'too-far'
        : faceSize > (options.maxFaceSize ?? 0.8)
          ? 'too-close'
          : 'ok',
    offset: { x: dx, y: dy },
    faceSize,
    visibility: clamp(visibility),
    fullyInsideFrame: visibility >= 1 - 1e-9,
    partiallyOutsideFrame: visibility < 1 - 1e-9,
  };
}

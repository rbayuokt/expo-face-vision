import type { Point, Rect, Size } from '../types';

export function clamp(value: number, min = 0, max = 1): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function rectArea(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Intersection over union, 0..1. */
export function iou(a: Rect, b: Rect): number {
  const overlap = intersectRects(a, b);
  if (!overlap) return 0;
  const inter = rectArea(overlap);
  return inter / (rectArea(a) + rectArea(b) - inter);
}

export function normalizePoint(point: Point, size: Size): Point {
  return { x: point.x / size.width, y: point.y / size.height };
}

export function denormalizePoint(point: Point, size: Size): Point {
  return { x: point.x * size.width, y: point.y * size.height };
}

export function normalizeRect(rect: Rect, size: Size): Rect {
  return {
    x: rect.x / size.width,
    y: rect.y / size.height,
    width: rect.width / size.width,
    height: rect.height / size.height,
  };
}

export function denormalizeRect(rect: Rect, size: Size): Rect {
  return {
    x: rect.x * size.width,
    y: rect.y * size.height,
    width: rect.width * size.width,
    height: rect.height * size.height,
  };
}

export function boundingRect(points: Point[]): Rect | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Even-odd ray cast. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

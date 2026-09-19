import {
  eyeAspectRatio,
  getCenterFace,
  getHeadDirection,
  getLargestFace,
  sortFacesBySize,
  toDetectedFace,
  areEyesOpen,
  isSmiling,
} from '../face';
import { iou, pointInPolygon } from '../geometry';
import { analyzeFacePosition, centeredOval, isFaceInsideRegion } from '../region';

describe('iou', () => {
  it('identical = 1, disjoint = 0, half overlap = 1/3', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(iou(a, a)).toBe(1);
    expect(iou(a, { x: 20, y: 0, width: 10, height: 10 })).toBe(0);
    expect(iou(a, { x: 5, y: 0, width: 10, height: 10 })).toBeCloseTo(1 / 3);
  });
});

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it('inside/outside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });
});

describe('face helpers', () => {
  const face = (x: number, w: number) => ({ bounds: { x, y: 0, width: w, height: w } });

  it('largest / center / sort', () => {
    const faces = [face(0, 10), face(50, 30), face(90, 20)];
    expect(getLargestFace(faces)).toBe(faces[1]);
    expect(sortFacesBySize(faces).map((f) => f.bounds.width)).toEqual([30, 20, 10]);
    expect(getCenterFace(faces, { width: 200, height: 40 })).toBe(faces[2]);
    expect(getLargestFace([])).toBeUndefined();
  });

  it('head direction is subject-centric with dominant axis', () => {
    expect(getHeadDirection({ yaw: 0, pitch: 0 })).toBe('center');
    expect(getHeadDirection({ yaw: 30, pitch: 0 })).toBe('right');
    expect(getHeadDirection({ yaw: -30, pitch: 5 })).toBe('left');
    expect(getHeadDirection({ yaw: 16, pitch: 20 })).toBe('up');
    expect(getHeadDirection({ yaw: 0, pitch: -20 })).toBe('down');
  });

  it('toDetectedFace derives normalized bounds and pose', () => {
    const d = toDetectedFace(
      {
        bounds: { x: 100, y: 100, width: 200, height: 200 },
        angles: { yaw: 0, pitch: 0, roll: 0 },
        native: { platform: 'android' },
      },
      { width: 400, height: 800 }
    );
    expect(d.normalizedBounds).toEqual({ x: 0.25, y: 0.125, width: 0.5, height: 0.25 });
    expect(d.headPose?.normalizedPosition).toEqual({ x: 0.5, y: 0.25 });
    expect(d.headPose?.scale).toBe(0.5);
    expect('angles' in d).toBe(false);
  });

  it('classification returns undefined without data', () => {
    expect(isSmiling({})).toBeUndefined();
    expect(isSmiling({ probabilities: { smiling: 0.9 } })).toBe(true);
    expect(areEyesOpen({ probabilities: { leftEyeOpen: 0.9, rightEyeOpen: 0.2 } })).toBe(false);
    expect(areEyesOpen({})).toBeUndefined();
  });

  it('eye aspect ratio is rotation invariant', () => {
    const eye = (angle: number, h: number) =>
      [
        [-10, 0],
        [-5, -h],
        [5, -h],
        [10, 0],
        [5, h],
        [-5, h],
      ].map(([x, y]) => ({
        x: x! * Math.cos(angle) - y! * Math.sin(angle),
        y: x! * Math.sin(angle) + y! * Math.cos(angle),
      }));
    expect(eyeAspectRatio(eye(0, 3))).toBeCloseTo(0.3);
    expect(eyeAspectRatio(eye(0.5, 3))).toBeCloseTo(0.3);
    expect(eyeAspectRatio(eye(0, 0.5))).toBeCloseTo(0.05);
    expect(eyeAspectRatio([])).toBeUndefined();
  });
});

describe('regions', () => {
  it('rect coverage is exact', () => {
    const m = isFaceInsideRegion(
      { x: 50, y: 0, width: 100, height: 100 },
      { type: 'rect', x: 0, y: 0, width: 100, height: 100 }
    );
    expect(m.coverage).toBeCloseTo(0.5);
    expect(m.inside).toBe(false);
    expect(
      isFaceInsideRegion(
        { x: 50, y: 0, width: 100, height: 100 },
        { type: 'rect', x: 0, y: 0, width: 100, height: 100 },
        { minCoverage: 0.5 }
      ).inside
    ).toBe(true);
  });

  it('oval: centered small face is inside and aligned', () => {
    const oval = centeredOval({ width: 400, height: 800 });
    const r = { x: 150, y: 290, width: 140, height: 140 };
    const m = isFaceInsideRegion(r, oval);
    expect(m.inside).toBe(true);
    expect(m.centerInside).toBe(true);
    expect(Math.abs(m.offset.x)).toBeLessThan(0.2);
    expect(m.sizeRatio).toBeCloseTo(0.5);
    expect(m.aligned).toBe(true);
  });

  it('oval: face at the corner has low coverage and offset toward it', () => {
    const m = isFaceInsideRegion(
      { x: 0, y: 0, width: 100, height: 100 },
      { type: 'oval', cx: 200, cy: 200, rx: 100, ry: 100 }
    );
    expect(m.coverage).toBe(0);
    expect(m.offset.x).toBeLessThan(-1);
    expect(m.offset.y).toBeLessThan(-1);
  });

  it('polygon regions', () => {
    const tri = {
      type: 'polygon' as const,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
    };
    const m = isFaceInsideRegion({ x: 0, y: 0, width: 100, height: 100 }, tri, {
      minCoverage: 0.4,
    });
    expect(m.coverage).toBeGreaterThan(0.4);
    expect(m.coverage).toBeLessThan(0.6);
  });
});

describe('analyzeFacePosition', () => {
  const frame = { width: 1000, height: 1000 };
  it('centered face', () => {
    const p = analyzeFacePosition({ x: 400, y: 400, width: 200, height: 200 }, frame);
    expect(p.centered).toBe(true);
    expect(p.distance).toBe('ok');
    expect(p.fullyInsideFrame).toBe(true);
  });

  it('left/right flips when mirrored', () => {
    const r = { x: 50, y: 400, width: 200, height: 200 };
    expect(analyzeFacePosition(r, frame).horizontal).toBe('left');
    expect(analyzeFacePosition(r, frame, { mirrored: true }).horizontal).toBe('right');
  });

  it('size and frame edges', () => {
    expect(analyzeFacePosition({ x: 450, y: 450, width: 100, height: 100 }, frame).distance).toBe(
      'too-far'
    );
    expect(analyzeFacePosition({ x: 50, y: 50, width: 900, height: 900 }, frame).distance).toBe(
      'too-close'
    );
    const out = analyzeFacePosition({ x: -100, y: 400, width: 200, height: 200 }, frame);
    expect(out.partiallyOutsideFrame).toBe(true);
    expect(out.visibility).toBeCloseTo(0.5);
  });

  it('uses the visible rect for cover-cropped previews', () => {
    const p = analyzeFacePosition({ x: 20, y: 400, width: 100, height: 100 }, frame, {
      visibleRect: { x: 100, y: 0, width: 800, height: 1000 },
    });
    expect(p.partiallyOutsideFrame).toBe(true);
  });
});

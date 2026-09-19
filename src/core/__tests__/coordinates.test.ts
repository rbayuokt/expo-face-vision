import {
  createTransform,
  rotatePoint,
  transformBounds,
  transformPoint,
  uprightSize,
  visibleSourceRect,
  type TransformConfig,
} from '../coordinates';
import { denormalizePoint, normalizePoint, normalizeRect } from '../geometry';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('rotatePoint', () => {
  const size = { width: 640, height: 480 };
  it.each([
    [0, { x: 10, y: 20 }, { x: 10, y: 20 }],
    [90, { x: 0, y: 0 }, { x: 480, y: 0 }],
    [90, { x: 640, y: 480 }, { x: 0, y: 640 }],
    [180, { x: 0, y: 0 }, { x: 640, y: 480 }],
    [270, { x: 0, y: 0 }, { x: 0, y: 640 }],
    [270, { x: 640, y: 0 }, { x: 0, y: 0 }],
  ] as const)('%i° maps %j to %j', (rotation, p, expected) => {
    close(rotatePoint(p, size, rotation), expected);
  });

  it('four 90° turns are the identity', () => {
    let p = { x: 123, y: 45 };
    let s = size;
    for (let i = 0; i < 4; i++) {
      p = rotatePoint(p, s, 90);
      s = uprightSize(s, 90);
    }
    close(p, { x: 123, y: 45 });
  });
});

describe('createTransform', () => {
  it('identity when source equals target', () => {
    const t = createTransform({
      source: { width: 100, height: 200 },
      target: { width: 100, height: 200 },
    });
    expect(t.scale).toBe(1);
    close(t.point({ x: 30, y: 40 }), { x: 30, y: 40 });
  });

  it('cover crops the longer axis and centers it', () => {
    // 480x640 portrait frame into a 390x844 phone view.
    const cfg: TransformConfig = {
      source: { width: 480, height: 640 },
      target: { width: 390, height: 844 },
    };
    const t = createTransform(cfg);
    expect(t.scale).toBeCloseTo(844 / 640);
    expect(t.offset.y).toBeCloseTo(0);
    expect(t.offset.x).toBeCloseTo((390 - 480 * (844 / 640)) / 2);
    // Frame center lands on view center.
    close(t.point({ x: 240, y: 320 }), { x: 195, y: 422 });
  });

  it('contain letterboxes', () => {
    const t = createTransform({
      source: { width: 480, height: 640 },
      target: { width: 390, height: 844 },
      resizeMode: 'contain',
    });
    expect(t.scale).toBeCloseTo(390 / 480);
    expect(t.offset.x).toBeCloseTo(0);
    expect(t.offset.y).toBeGreaterThan(0);
    close(t.point({ x: 0, y: 0 }), { x: 0, y: t.offset.y });
  });

  it('mirrors horizontally for the front camera', () => {
    const cfg = {
      source: { width: 100, height: 100 },
      target: { width: 100, height: 100 },
      mirrored: true,
    };
    close(transformPoint({ x: 10, y: 20 }, cfg), { x: 90, y: 20 });
  });

  it('rotates a landscape sensor frame into a portrait view', () => {
    // Back camera sensor 640x480 needing 90° to be upright.
    const cfg: TransformConfig = {
      source: { width: 640, height: 480 },
      rotation: 90,
      target: { width: 480, height: 640 },
    };
    close(transformPoint({ x: 0, y: 0 }, cfg), { x: 480, y: 0 });
    close(transformPoint({ x: 0, y: 480 }, cfg), { x: 0, y: 0 });
  });

  it('rotation + mirroring + cover together', () => {
    // Front camera: sensor 640x480, rotate 270, mirrored, into a 300x600 view.
    const cfg: TransformConfig = {
      source: { width: 640, height: 480 },
      rotation: 270,
      mirrored: true,
      target: { width: 300, height: 600 },
    };
    const t = createTransform(cfg);
    expect(t.upright).toEqual({ width: 480, height: 640 });
    // Sensor (0,0) -> upright (0,640) -> mirrored (480,640) -> scaled.
    close(t.point({ x: 0, y: 0 }), {
      x: 480 * t.scale + t.offset.x,
      y: 640 * t.scale + t.offset.y,
    });
  });

  it('invertPoint round-trips every combination', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const mirrored of [false, true]) {
        for (const resizeMode of ['cover', 'contain'] as const) {
          const t = createTransform({
            source: { width: 640, height: 480 },
            rotation,
            mirrored,
            resizeMode,
            target: { width: 390, height: 844 },
          });
          const p = { x: 111, y: 222 };
          close(t.invertPoint(t.point(p)), p);
        }
      }
    }
  });
});

describe('transformBounds', () => {
  it('keeps width/height positive after mirroring', () => {
    const r = transformBounds(
      { x: 10, y: 10, width: 20, height: 30 },
      { source: { width: 100, height: 100 }, target: { width: 100, height: 100 }, mirrored: true }
    );
    expect(r).toEqual({ x: 70, y: 10, width: 20, height: 30 });
  });

  it('swaps width and height on 90°', () => {
    const r = transformBounds(
      { x: 0, y: 0, width: 40, height: 10 },
      { source: { width: 100, height: 50 }, rotation: 90, target: { width: 50, height: 100 } }
    );
    expect(r.width).toBeCloseTo(10);
    expect(r.height).toBeCloseTo(40);
    expect(r.x).toBeCloseTo(40);
    expect(r.y).toBeCloseTo(0);
  });

  it('scales rects with cover', () => {
    const r = transformBounds(
      { x: 0, y: 0, width: 480, height: 640 },
      { source: { width: 480, height: 640 }, target: { width: 240, height: 320 } }
    );
    expect(r).toEqual({ x: 0, y: 0, width: 240, height: 320 });
  });
});

describe('visibleSourceRect', () => {
  it('is the full frame with contain', () => {
    expect(
      visibleSourceRect({
        source: { width: 480, height: 640 },
        target: { width: 390, height: 844 },
        resizeMode: 'contain',
      })
    ).toEqual({ x: 0, y: 0, width: 480, height: 640 });
  });

  it('crops the sides with cover on a tall screen', () => {
    const r = visibleSourceRect({
      source: { width: 480, height: 640 },
      target: { width: 390, height: 844 },
    });
    const visibleWidth = 390 / (844 / 640);
    expect(r.width).toBeCloseTo(visibleWidth);
    expect(r.x).toBeCloseTo((480 - visibleWidth) / 2);
    expect(r.y).toBe(0);
    expect(r.height).toBeCloseTo(640);
  });
});

describe('normalize helpers', () => {
  it('round trip', () => {
    const size = { width: 200, height: 100 };
    const p = { x: 50, y: 25 };
    expect(normalizePoint(p, size)).toEqual({ x: 0.25, y: 0.25 });
    expect(denormalizePoint(normalizePoint(p, size), size)).toEqual(p);
    expect(normalizeRect({ x: 20, y: 10, width: 100, height: 50 }, size)).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.5,
    });
  });
});

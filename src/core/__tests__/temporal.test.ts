import type { DetectedFace, NativeFace } from '../../types';
import { BlinkDetector } from '../blink';
import { toDetectedFace } from '../face';
import { EmaFilter, OneEuroFilter, createFilter } from '../filters';
import {
  HeadGestureRecognizer,
  countSwings,
  type HeadGestureEvent,
  type HeadGesture,
} from '../gestures';
import { HeadTracker, type PoseSample } from '../headTracker';
import { StabilityDetector } from '../stability';
import { FaceTracker } from '../tracker';

const IMAGE = { width: 1000, height: 1000 };

function face(x: number, y: number, extra: Partial<NativeFace> = {}): DetectedFace {
  return toDetectedFace(
    {
      bounds: { x, y, width: 200, height: 200 },
      angles: { yaw: 0, pitch: 0, roll: 0 },
      native: { platform: 'ios' },
      ...extra,
    },
    IMAGE
  );
}

// Deterministic noise.
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647 - 0.5) * 2;
  };
}

describe('filters', () => {
  it('one euro removes jitter at rest', () => {
    const f = new OneEuroFilter(0.5, 0.01);
    const n = noise(1);
    let maxDev = 0;
    for (let i = 0; i < 100; i++) {
      const v = f.filter(100 + n() * 5, i * 33);
      if (i > 20) maxDev = Math.max(maxDev, Math.abs(v - 100));
    }
    expect(maxDev).toBeLessThan(2);
  });

  it('one euro follows a step faster than an equally smooth ema', () => {
    const euro = new OneEuroFilter(0.5, 0.05);
    const ema = new EmaFilter(0.9);
    for (let i = 0; i < 30; i++) {
      euro.filter(0, i * 33);
      ema.filter(0, i * 33);
    }
    let e = 0;
    let m = 0;
    for (let i = 30; i < 36; i++) {
      e = euro.filter(100, i * 33);
      m = ema.filter(100, i * 33);
    }
    expect(e).toBeGreaterThan(m);
  });

  it('ema is frame rate independent', () => {
    const a = new EmaFilter(0.8);
    const b = new EmaFilter(0.8);
    a.filter(0, 0);
    b.filter(0, 0);
    let va = 0;
    let vb = 0;
    for (let i = 1; i <= 30; i++) va = a.filter(100, (i * 1000) / 30);
    for (let i = 1; i <= 15; i++) vb = b.filter(100, (i * 1000) / 15);
    expect(va).toBeCloseTo(vb, 3);
  });

  it('smoothing 0 is pass-through', () => {
    const f = createFilter({ smoothing: 0 });
    f.filter(0, 0);
    expect(f.filter(50, 10)).toBe(50);
  });
});

describe('FaceTracker', () => {
  it('assigns stable ids by IoU and reports enter/lost', () => {
    const tracker = new FaceTracker({ smoothing: 0, timeout: 100 });
    const u1 = tracker.update([face(100, 100), face(600, 600)], IMAGE, 0);
    expect(u1.entered.map((f) => f.trackingId)).toEqual([1, 2]);

    const u2 = tracker.update([face(610, 600), face(105, 100)], IMAGE, 33);
    expect(u2.entered).toHaveLength(0);
    const byX = Object.fromEntries(u2.faces.map((f) => [Math.round(f.bounds.x), f.trackingId]));
    expect(byX[105]).toBe(1);
    expect(byX[610]).toBe(2);

    // Face 2 drops for less than the timeout: not lost yet.
    expect(tracker.update([face(110, 100)], IMAGE, 66).lost).toHaveLength(0);
    const u4 = tracker.update([face(110, 100)], IMAGE, 200);
    expect(u4.lost.map((f) => f.trackingId)).toEqual([2]);
  });

  it('prefers native tracking ids', () => {
    const tracker = new FaceTracker({ smoothing: 0 });
    tracker.update([face(100, 100, { trackingId: 42 })], IMAGE, 0);
    // Far away but same native id: still the same track.
    const u = tracker.update([face(700, 700, { trackingId: 42 })], IMAGE, 33);
    expect(u.updated[0]?.trackingId).toBe(42);
    expect(u.entered).toHaveLength(0);
  });

  it('smooths bounds and keeps raw', () => {
    const tracker = new FaceTracker({ smoothing: 0.8 });
    tracker.update([face(100, 100)], IMAGE, 0);
    const u = tracker.update([face(120, 100)], IMAGE, 33);
    expect(u.faces[0]!.bounds.x).toBeGreaterThan(100);
    expect(u.faces[0]!.bounds.x).toBeLessThan(120);
    expect(u.faces[0]!.raw.bounds.x).toBe(120);
  });
});

describe('StabilityDetector', () => {
  it('stable after a still window, counting from the window start', () => {
    const s = new StabilityDetector({ windowMs: 300 });
    let state = s.update({ timestamp: 0, x: 0.5, y: 0.5, scale: 0.3 });
    for (let t = 33; t <= 330; t += 33)
      state = s.update({ timestamp: t, x: 0.5, y: 0.5, scale: 0.3 });
    expect(state.stable).toBe(true);
    expect(state.stableFor).toBeGreaterThanOrEqual(180);
  });

  it('movement breaks stability', () => {
    const s = new StabilityDetector({ windowMs: 300 });
    let state = s.update({ timestamp: 0, x: 0.5, y: 0.5, scale: 0.3 });
    for (let t = 33; t <= 660; t += 33)
      state = s.update({ timestamp: t, x: 0.5 + (t % 66 ? 0.05 : 0), y: 0.5, scale: 0.3 });
    expect(state.stable).toBe(false);
    expect(state.stableFor).toBe(0);
  });
});

/** Runs a pose function through HeadTracker + recognizer at `fps`, collecting events. */
function runGesture(
  pose: (t: number) => { yaw?: number; pitch?: number; roll?: number },
  durationMs: number,
  gestures?: HeadGesture[],
  fps = 30,
  jitter = 0.5
): HeadGestureEvent[] {
  const head = new HeadTracker({ smoothing: 0.3 });
  const rec = new HeadGestureRecognizer({ gestures });
  const n = noise(7);
  const events: HeadGestureEvent[] = [];
  for (let t = 0; t <= durationMs; t += 1000 / fps) {
    const p = pose(t);
    head.update(
      {
        yaw: (p.yaw ?? 0) + n() * jitter,
        pitch: (p.pitch ?? 0) + n() * jitter,
        roll: (p.roll ?? 0) + n() * jitter,
        normalizedPosition: { x: 0.5, y: 0.5 },
        scale: 0.3,
      },
      t
    );
    const e = rec.update(head.history);
    if (e) events.push(e);
  }
  return events;
}

// Neutral for 500 ms, then the motion.
const after = (start: number, f: (t: number) => number) => (t: number) =>
  t < start ? 0 : f(t - start);

describe('head gestures', () => {
  it('countSwings counts down-and-back as 2', () => {
    const samples: PoseSample[] = [0, -5, -12, -15, -8, 0, 2].map((pitch, i) => ({
      timestamp: i * 33,
      pitch,
      yaw: 0,
      roll: 0,
      x: 0,
      y: 0,
      scale: 0,
    }));
    expect(countSwings(samples, 'pitch', 8).swings).toBe(2);
  });

  it('detects a nod and nothing else', () => {
    const nod = after(500, (t) => (t < 800 ? -15 * Math.sin((Math.PI * 2 * t) / 400) : 0));
    const events = runGesture((t) => ({ pitch: nod(t) }), 2000);
    expect(events.map((e) => e.type)).toEqual(['nod']);
    expect(events[0]!.confidence).toBeGreaterThan(0.3);
  });

  it('detects a shake', () => {
    const shake = after(500, (t) => (t < 1000 ? 20 * Math.sin((Math.PI * 2 * t) / 500) : 0));
    const events = runGesture((t) => ({ yaw: shake(t) }), 2000);
    expect(events[0]?.type).toBe('shake');
    expect(events.filter((e) => e.type === 'nod')).toHaveLength(0);
  });

  it('detects a held turn once, re-arming only after returning', () => {
    const turn = (t: number) => (t > 500 && t < 1500 ? -35 : t > 2000 && t < 3000 ? -35 : 0);
    const events = runGesture((t) => ({ yaw: turn(t) }), 3500, ['turn-left', 'turn-right']);
    expect(events.map((e) => e.type)).toEqual(['turn-left', 'turn-left']);
  });

  it('ignores jitter and a brief glance', () => {
    const glance = (t: number) => (t > 500 && t < 560 ? 30 : 0);
    const events = runGesture(
      (t) => ({ yaw: glance(t) }),
      2000,
      ['turn-left', 'turn-right', 'nod', 'shake'],
      30,
      2
    );
    expect(events).toHaveLength(0);
  });

  it('detects look up, tilt and hold', () => {
    expect(
      runGesture((t) => ({ pitch: t > 500 ? 25 : 0 }), 1500, ['look-up']).map((e) => e.type)
    ).toEqual(['look-up']);
    expect(
      runGesture((t) => ({ roll: t > 500 ? 30 : 0 }), 1500, ['tilt-right']).map((e) => e.type)
    ).toEqual(['tilt-right']);
    const hold = runGesture(() => ({}), 1500, ['hold']);
    expect(hold.map((e) => e.type)).toEqual(['hold']);
  });

  it('does not call a diagonal wobble a nod', () => {
    const wobble = after(500, (t) => (t < 800 ? 15 * Math.sin((Math.PI * 2 * t) / 400) : 0));
    const events = runGesture((t) => ({ pitch: wobble(t), yaw: wobble(t) }), 2000, ['nod']);
    expect(events).toHaveLength(0);
  });
});

describe('HeadTracker', () => {
  it('reports turning direction and velocity sign', () => {
    const head = new HeadTracker({ smoothing: 0.2 });
    let m;
    for (let t = 0; t <= 300; t += 33) {
      m = head.update(
        { yaw: t / 5, pitch: 0, roll: 0, normalizedPosition: { x: 0.5, y: 0.5 }, scale: 0.3 },
        t
      );
    }
    expect(m!.horizontal).toBe('right');
    expect(m!.velocity.yaw).toBeGreaterThan(100);
    expect(m!.vertical).toBe('stable');
  });
});

describe('BlinkDetector', () => {
  const eyes = (l: number, r: number) => ({ probabilities: { leftEyeOpen: l, rightEyeOpen: r } });

  it('counts a blink from probabilities', () => {
    const b = new BlinkDetector();
    const seq = [1, 1, 0.1, 0.05, 0.9, 1];
    const events = seq.map((v, i) => b.update(eyes(v, v), i * 50)).filter(Boolean);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'blink', count: 1, source: 'probability' });
    expect(events[0]!.duration).toBe(100);
  });

  it('pairs eyes reopening a frame apart', () => {
    const b = new BlinkDetector();
    const frames: [number, number][] = [
      [1, 1],
      [0.1, 0.1],
      [0.9, 0.1],
      [0.9, 0.9],
      [1, 1],
    ];
    const events = frames.map(([l, r], i) => b.update(eyes(l, r), i * 50)).filter(Boolean);
    expect(events.map((e) => e!.type)).toEqual(['blink']);
  });

  it('long closures are not blinks', () => {
    const b = new BlinkDetector({ maxDuration: 300 });
    const events: unknown[] = [];
    events.push(b.update(eyes(1, 1), 0));
    for (let t = 50; t < 1000; t += 50) events.push(b.update(eyes(0.05, 0.05), t));
    events.push(b.update(eyes(1, 1), 1000));
    expect(events.filter(Boolean)).toHaveLength(0);
  });

  it('winks only when enabled', () => {
    const run = (winks: boolean) => {
      const b = new BlinkDetector({ winks });
      const frames: [number, number][] = [
        [1, 1],
        [0.1, 1],
        [0.9, 1],
        [1, 1],
        [1, 1],
        [1, 1],
      ];
      return frames.map(([l, r], i) => b.update(eyes(l, r), i * 50)).filter(Boolean);
    };
    expect(run(false)).toHaveLength(0);
    expect(run(true).map((e) => e!.type)).toEqual(['left-wink']);
  });

  it('falls back to the eye aspect ratio with a warm-up', () => {
    const b = new BlinkDetector();
    const eye = (h: number) => [
      { x: 0, y: 0 },
      { x: 5, y: -h },
      { x: 15, y: -h },
      { x: 20, y: 0 },
      { x: 15, y: h },
      { x: 5, y: h },
    ];
    const f = (h: number) => ({ contours: { leftEye: eye(h), rightEye: eye(h) } });
    const events = [];
    let t = 0;
    for (let i = 0; i < 12; i++) events.push(b.update(f(3), (t += 50)));
    events.push(b.update(f(0.5), (t += 50)));
    events.push(b.update(f(3), (t += 50)));
    expect(events.filter(Boolean).map((e) => e!.source)).toEqual(['eye-aspect-ratio']);
  });
});

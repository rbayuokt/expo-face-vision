import type { NativeFace } from '../../types';
import {
  autoCaptureReducer,
  AutoCaptureMachine,
  initialAutoCaptureState,
  type AutoCaptureFrame,
} from '../autoCapture';
import { toDetectedFace } from '../face';
import { getGuidance, GuidanceFilter } from '../guidance';
import { analyzeFaceQuality, DEFAULT_QUALITY_WEIGHTS } from '../quality';
import { validateFace } from '../validation';

const IMAGE = { width: 1000, height: 1000 };
const face = (x: number, y: number, w: number, extra: Partial<NativeFace> = {}) =>
  toDetectedFace(
    {
      bounds: { x, y, width: w, height: w },
      angles: { yaw: 0, pitch: 0, roll: 0 },
      native: { platform: 'android' },
      ...extra,
    },
    IMAGE
  );
const centered = (w = 400, extra: Partial<NativeFace> = {}) =>
  face(500 - w / 2, 500 - w / 2, w, extra);

describe('validateFace', () => {
  it('NO_FACE and MULTIPLE_FACES', () => {
    expect(validateFace([], { image: IMAGE }).issues[0]!.code).toBe('NO_FACE');
    expect(
      validateFace([centered(), face(0, 0, 100)], { image: IMAGE }).issues.map((i) => i.code)
    ).toContain('MULTIPLE_FACES');
  });

  it('reports value and expected like the spec example', () => {
    const r = validateFace(centered(180), { image: IMAGE }, { minFaceSize: 0.25 });
    expect(r.valid).toBe(false);
    expect(r.issues).toEqual([{ code: 'FACE_TOO_SMALL', value: 0.18, expected: 0.25 }]);
  });

  it('a good face passes all rules', () => {
    const f = centered(400, { probabilities: { leftEyeOpen: 0.95, rightEyeOpen: 0.9 } });
    const r = validateFace(
      f,
      {
        image: IMAGE,
        stableFor: 800,
        stats: { brightness: 0.5, contrast: 0.2, laplacianVariance: 200 },
      },
      {
        requireCentered: true,
        requireEyesOpen: true,
        requireLookingForward: true,
        minFaceSize: 0.25,
        maxFaceSize: 0.75,
        minBrightness: 0.3,
        minSharpness: 50,
        stableFor: 500,
      }
    );
    expect(r).toMatchObject({ valid: true, issues: [] });
  });

  it('SIGNAL_UNAVAILABLE instead of guessing', () => {
    const r = validateFace(
      centered(),
      { image: IMAGE },
      { requireEyesOpen: true, minBrightness: 0.2 }
    );
    expect(r.issues).toEqual([
      { code: 'SIGNAL_UNAVAILABLE', rule: 'eyesOpen' },
      { code: 'SIGNAL_UNAVAILABLE', rule: 'stats' },
    ]);
  });

  it('pose limits keep the sign', () => {
    const r = validateFace(
      centered(400, { angles: { yaw: 30, pitch: -20, roll: 0 } }),
      { image: IMAGE },
      { requireLookingForward: true }
    );
    expect(r.issues).toEqual([
      { code: 'YAW_TOO_LARGE', value: 30, expected: 15 },
      { code: 'PITCH_TOO_LARGE', value: -20, expected: 12 },
    ]);
  });

  it('custom validators', () => {
    const r = validateFace(
      centered(),
      { image: IMAGE },
      {
        custom: [(f) => (f.bounds.width > 300 ? { code: 'MY_RULE', value: f.bounds.width } : null)],
      }
    );
    expect(r.issues).toEqual([{ code: 'MY_RULE', value: 400 }]);
  });
});

describe('getGuidance', () => {
  const guide = (f: ReturnType<typeof face>, rules = {}, mirrored = false) =>
    getGuidance(
      validateFace(
        f,
        { image: IMAGE, mirrored },
        { requireCentered: true, minFaceSize: 0.2, maxFaceSize: 0.7, ...rules }
      )
    );

  it('READY when valid', () => {
    expect(guide(centered()).status).toBe('READY');
  });

  it('screen-space moves, flipped for mirrored previews', () => {
    // Face on the left of the image.
    expect(guide(face(0, 400, 300)).status).toBe('MOVE_RIGHT');
    expect(guide(face(0, 400, 300), {}, true).status).toBe('MOVE_LEFT');
    expect(guide(face(350, 0, 300)).status).toBe('MOVE_DOWN');
  });

  it('distance before centering, size mode option', () => {
    const small = face(0, 0, 100);
    expect(guide(small).status).toBe('MOVE_CLOSER');
    expect(guide(small).statuses).toContain('MOVE_RIGHT');
    expect(
      getGuidance(validateFace(small, { image: IMAGE }, { minFaceSize: 0.2 }), {
        sizeGuidance: 'size',
      }).status
    ).toBe('FACE_TOO_SMALL');
    expect(guide(centered(900)).status).toBe('MOVE_FARTHER');
  });

  it('look left when turned to their right', () => {
    expect(
      guide(centered(400, { angles: { yaw: 30, pitch: 0, roll: 0 } }), { maxYaw: 15 }).status
    ).toBe('LOOK_LEFT');
    expect(
      guide(centered(400, { angles: { yaw: -30, pitch: 0, roll: 0 } }), { maxYaw: 15 }).status
    ).toBe('LOOK_RIGHT');
    expect(
      guide(centered(400, { angles: { yaw: 0, pitch: 25, roll: 0 } }), { maxPitch: 10 }).status
    ).toBe('LOOK_FORWARD');
  });

  it('eyes, stability, unknown codes', () => {
    expect(
      guide(centered(400, { probabilities: { leftEyeOpen: 0.1, rightEyeOpen: 0.1 } }), {
        requireEyesOpen: true,
      }).status
    ).toBe('OPEN_EYES');
    expect(
      getGuidance(validateFace(centered(), { image: IMAGE, stableFor: 100 }, { stableFor: 500 }))
        .status
    ).toBe('HOLD_STILL');
    expect(
      getGuidance(validateFace(centered(), { image: IMAGE }, { custom: [() => ({ code: 'X' })] }))
        .status
    ).toBe('REQUIREMENT_NOT_MET');
  });

  it('GuidanceFilter holds a new status for minDuration', () => {
    const g = new GuidanceFilter(300);
    expect(g.update('MOVE_LEFT', 0)).toBe('MOVE_LEFT');
    expect(g.update('READY', 100)).toBe('MOVE_LEFT');
    expect(g.update('MOVE_LEFT', 150)).toBe('MOVE_LEFT');
    expect(g.update('READY', 200)).toBe('MOVE_LEFT');
    expect(g.update('READY', 500)).toBe('READY');
  });
});

describe('analyzeFaceQuality', () => {
  it('scores a good face high and exposes the formula components', () => {
    const q = analyzeFaceQuality(
      centered(400, { probabilities: { leftEyeOpen: 1, rightEyeOpen: 1 } }),
      {
        image: IMAGE,
        stats: { brightness: 0.5, contrast: 0.25, laplacianVariance: 300 },
        stable: true,
      }
    );
    expect(q.score).toBeCloseTo(1);
    expect(q).toMatchObject({
      centered: true,
      lookingForward: true,
      eyesOpen: true,
      tooDark: false,
      tooBlurry: false,
      blur: 0,
    });
    expect(Object.keys(q.components).sort()).toEqual(Object.keys(DEFAULT_QUALITY_WEIGHTS).sort());
  });

  it('skips missing components and renormalizes', () => {
    const q = analyzeFaceQuality(centered(), { image: IMAGE });
    expect(q.components.sharpness).toBeUndefined();
    expect(q.blur).toBeUndefined();
    expect(q.eyesOpen).toBeUndefined();
    expect(q.score).toBeCloseTo(1);
  });

  it('flags dark and blurry', () => {
    const q = analyzeFaceQuality(centered(), {
      image: IMAGE,
      stats: { brightness: 0.1, contrast: 0.05, laplacianVariance: 10 },
    });
    expect(q.tooDark).toBe(true);
    expect(q.tooBlurry).toBe(true);
    expect(q.score).toBeLessThan(0.8);
  });

  it('custom weights change the score', () => {
    const f = centered(400, { angles: { yaw: 30, pitch: 0, roll: 0 } });
    const a = analyzeFaceQuality(f, { image: IMAGE });
    const b = analyzeFaceQuality(f, { image: IMAGE }, { weights: { pose: 10 } });
    expect(b.score).toBeLessThan(a.score);
  });
});

describe('auto capture state machine', () => {
  const frame = (timestamp: number, over: Partial<AutoCaptureFrame> = {}) => ({
    type: 'FRAME' as const,
    timestamp,
    faceCount: 1,
    valid: true,
    stableFor: 0,
    ...over,
  });

  it('walks the happy path with a countdown and captures once', () => {
    const m = new AutoCaptureMachine({ stableFor: 500, countdown: 1000 });
    const seen: string[] = [];
    const push = () => seen[seen.length - 1] !== m.state.status && seen.push(m.state.status);
    push();
    m.send({ type: 'START', timestamp: 0 });
    push();
    m.send(frame(10, { faceCount: 0 }));
    push();
    m.send(frame(20, { valid: false }));
    push();
    m.send(frame(30));
    push();
    m.send(frame(40, { stableFor: 200 }));
    push();
    m.send(frame(50, { stableFor: 600 }));
    push();
    m.send(frame(60, { stableFor: 610 }));
    push();
    m.send({ type: 'TICK', timestamp: 500 });
    expect(m.state.status).toBe('COUNTDOWN');
    m.send({ type: 'TICK', timestamp: 1100 });
    push();
    // Frames and triggers during CAPTURING are ignored: no duplicate capture.
    const capturing = m.state;
    m.send(frame(1110, { stableFor: 2000 }));
    m.send({ type: 'TRIGGER', timestamp: 1120 });
    expect(m.state).toBe(capturing);
    m.send({ type: 'CAPTURED', timestamp: 1200 });
    push();
    expect(seen).toEqual([
      'IDLE',
      'SEARCHING',
      'ALIGNING',
      'STABILIZING',
      'READY',
      'COUNTDOWN',
      'CAPTURING',
      'IDLE',
    ]);
    expect(m.state.captures).toBe(1);
  });

  it('countdown cancels when the face goes invalid', () => {
    let s = { ...initialAutoCaptureState(), status: 'COUNTDOWN' as const, countdownEndsAt: 1000 };
    s = autoCaptureReducer(s, frame(100, { valid: false })) as typeof s;
    expect(s.status).toBe('ALIGNING');
  });

  it('continuous mode cools down then searches again', () => {
    const cfg = { continuous: true, cooldown: 1000 };
    let s = autoCaptureReducer(
      { ...initialAutoCaptureState(), status: 'CAPTURING' },
      { type: 'CAPTURED', timestamp: 0 },
      cfg
    );
    expect(s.status).toBe('COOLDOWN');
    s = autoCaptureReducer(s, frame(500), cfg);
    expect(s.status).toBe('COOLDOWN');
    s = autoCaptureReducer(s, frame(1000), cfg);
    expect(s.status).toBe('SEARCHING');
  });

  it('failure goes back to searching with the error; manual trigger and stop', () => {
    let s = autoCaptureReducer(
      { ...initialAutoCaptureState(), status: 'CAPTURING' },
      { type: 'CAPTURE_FAILED', timestamp: 0, error: 'boom' }
    );
    expect(s).toMatchObject({ status: 'SEARCHING', error: 'boom' });
    s = autoCaptureReducer(s, { type: 'TRIGGER', timestamp: 1 });
    expect(s.status).toBe('CAPTURING');
    expect(autoCaptureReducer(s, { type: 'STOP', timestamp: 2 }).status).toBe('IDLE');
  });

  it('returns the same object when nothing changes', () => {
    const s = autoCaptureReducer(initialAutoCaptureState(), { type: 'START', timestamp: 0 });
    expect(autoCaptureReducer(s, frame(1, { faceCount: 0 }))).toBe(s);
  });
});

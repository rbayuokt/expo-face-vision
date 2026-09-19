import type { DetectedFace } from '../../types';
import { toDetectedFace } from '../face';
import { LivenessSession, type LivenessOptions } from '../liveness';

const IMAGE = { width: 1000, height: 1000 };

function face(yaw = 0, pitch = 0, roll = 0, extra: Partial<DetectedFace> = {}): DetectedFace {
  return {
    ...toDetectedFace(
      {
        bounds: { x: 300, y: 300, width: 400, height: 400 },
        angles: { yaw, pitch, roll },
        native: { platform: 'android' },
      },
      IMAGE
    ),
    trackingId: 1,
    ...extra,
  };
}

/** Drives a session at 30 fps; `pose(t)` returns the faces for each frame. */
function run(
  session: LivenessSession,
  from: number,
  to: number,
  faces: (t: number) => DetectedFace[]
) {
  let s = session.current;
  for (let t = from; t <= to; t += 33) s = session.update(faces(t), t);
  return s;
}

const fixed: LivenessOptions = { randomize: false };

describe('LivenessSession', () => {
  it('positions, then walks through the steps with returns to center', () => {
    const session = new LivenessSession({ ...fixed, steps: ['turn-left', 'look-up'] });
    session.start();
    let s = run(session, 0, 300, () => [face()]);
    expect(s.prompt).toBe('HOLD_STILL');
    s = run(session, 330, 800, () => [face()]);
    expect(s).toMatchObject({ phase: 'challenge', prompt: 'TURN_LEFT' });

    s = run(session, 830, 1300, () => [face(-35)]);
    expect(s).toMatchObject({ phase: 'returning', prompt: 'RETURN_TO_CENTER', stepIndex: 1 });

    s = run(session, 1330, 1700, () => [face()]);
    expect(s).toMatchObject({ phase: 'challenge', prompt: 'LOOK_UP' });

    s = run(session, 1730, 2200, () => [face(0, 25)]);
    expect(s.phase).toBe('passed');
    expect(s.completed.map((c) => c.step)).toEqual(['turn-left', 'look-up']);
  });

  it('measures from the resting pose, not from zero', () => {
    const session = new LivenessSession({ ...fixed, steps: ['turn-left'] });
    session.start();
    // Someone who naturally holds their head 10° to the left.
    run(session, 0, 800, () => [face(-10)]);
    // -30 is only 20° from their rest: not enough for a 25° turn.
    expect(run(session, 830, 1500, () => [face(-30)]).phase).toBe('challenge');
    expect(run(session, 1530, 2000, () => [face(-40)]).phase).toBe('passed');
  });

  it('a brief glance does not count; the move must be held', () => {
    const session = new LivenessSession({ ...fixed, steps: ['turn-right'], holdMs: 250 });
    session.start();
    run(session, 0, 800, () => [face()]);
    const s = run(session, 830, 1500, (t) => [face(t < 900 ? 35 : 0)]);
    expect(s.phase).toBe('challenge');
  });

  it('does not accept a wrong-direction move', () => {
    const session = new LivenessSession({ ...fixed, steps: ['turn-left'] });
    session.start();
    run(session, 0, 800, () => [face()]);
    const s = run(session, 830, 2000, () => [face(35)]);
    expect(s.phase).toBe('challenge');
    expect(s.stepProgress).toBe(0);
  });

  it('fails on timeout, face lost, other faces and a changed face', () => {
    const make = () => {
      const s = new LivenessSession({ ...fixed, steps: ['turn-left'], stepTimeout: 2000 });
      s.start();
      run(s, 0, 800, () => [face()]);
      return s;
    };
    expect(run(make(), 830, 3000, () => [face()]).failure).toBe('TIMEOUT');
    expect(run(make(), 830, 2000, () => []).failure).toBe('FACE_LOST');
    expect(run(make(), 830, 2000, () => [face(), face(0, 0, 0, { trackingId: 2 })]).failure).toBe(
      'MULTIPLE_FACES'
    );
    expect(run(make(), 830, 900, () => [face(0, 0, 0, { trackingId: 7 })]).failure).toBe(
      'FACE_CHANGED'
    );
  });

  it('tolerates a short dropout', () => {
    const session = new LivenessSession({ ...fixed, steps: ['turn-left'] });
    session.start();
    run(session, 0, 800, () => [face()]);
    const s = run(session, 830, 1300, () => []);
    expect(s.phase).toBe('challenge');
  });

  it('positioning waits for a forward-facing single face', () => {
    const session = new LivenessSession(fixed);
    session.start();
    expect(run(session, 0, 2000, () => [face(30)]).prompt).toBe('POSITION_FACE');
    expect(run(session, 2030, 4000, () => [face(), face()]).prompt).toBe('POSITION_FACE');
  });

  it('smile and blink steps complete from their signals', () => {
    const session = new LivenessSession({ ...fixed, steps: ['smile', 'blink'] });
    session.start();
    run(session, 0, 800, () => [face()]);
    let s = run(session, 830, 1300, () => [
      face(0, 0, 0, { probabilities: { smiling: 0.95, leftEyeOpen: 1, rightEyeOpen: 1 } }),
    ]);
    expect(s).toMatchObject({ phase: 'challenge', prompt: 'BLINK' });
    const eyes = (v: number) => [
      face(0, 0, 0, { probabilities: { leftEyeOpen: v, rightEyeOpen: v } }),
    ];
    s = run(session, 1330, 1400, () => eyes(1));
    s = run(session, 1430, 1500, () => eyes(0.05));
    s = run(session, 1530, 1600, () => eyes(1));
    expect(s.phase).toBe('passed');
  });

  it('randomizes the order per session', () => {
    let seed = 0.9;
    const session = new LivenessSession({
      steps: ['turn-left', 'turn-right', 'look-up', 'look-down'],
      random: () => (seed = (seed * 7.3) % 1),
    });
    const a = session.start().steps.join();
    const b = session.start().steps.join();
    expect(a).not.toBe(b);
    expect([...session.current.steps].sort()).toEqual([
      'look-down',
      'look-up',
      'turn-left',
      'turn-right',
    ]);
  });
});

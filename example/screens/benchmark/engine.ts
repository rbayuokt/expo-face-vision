import {
  createTransform,
  FaceTracker,
  getGuidance,
  HeadGestureRecognizer,
  HeadTracker,
  StabilityDetector,
  toDetectedFace,
  validateFace,
  type NativeFace,
  type Point,
} from '@rbayuokt/expo-face-vision';

/**
 * Times the JS work the library does per analyzed camera frame, on synthetic faces, on
 * whatever JS engine runs this (Hermes in the app).
 */

const FRAME = { width: 720, height: 1280 };
const VIEW = { width: 390, height: 844 };

function loop(n: number, cx: number, cy: number, r: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({
    x: cx + Math.cos(i) * r,
    y: cy + Math.sin(i) * r,
  }));
}

// ML Kit returns ~130 contour points for one face; mirror that so the numbers are realistic.
function nativeFace(t: number, id: number, withContours: boolean): NativeFace {
  const wobble = Math.sin(t / 300) * 6;
  const x = 200 + id * 150 + wobble;
  return {
    trackingId: id,
    bounds: { x, y: 400, width: 320, height: 320 },
    angles: { yaw: wobble * 2, pitch: wobble, roll: wobble / 2 },
    probabilities: { smiling: 0.2, leftEyeOpen: 0.9, rightEyeOpen: 0.9 },
    stats: { brightness: 0.5, contrast: 0.2, laplacianVariance: 180 },
    native: { platform: 'android' },
    contours: withContours
      ? {
          face: loop(36, x + 160, 560, 150),
          leftEye: loop(16, x + 220, 520, 20),
          rightEye: loop(16, x + 100, 520, 20),
          leftEyebrow: loop(10, x + 220, 480, 30),
          rightEyebrow: loop(10, x + 100, 480, 30),
          noseBridge: loop(2, x + 160, 540, 10),
          noseBottom: loop(3, x + 160, 600, 10),
          outerLips: loop(20, x + 160, 660, 40),
          innerLips: loop(18, x + 160, 660, 30),
        }
      : undefined,
  };
}

/** Median µs per frame over 5 runs of `frames` frames, after a warm-up. */
function measure(setup: () => (t: number) => void, frames = 1000): number {
  const step = setup();
  for (let i = 0; i < 200; i++) step(i * 33);
  const runs: number[] = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    for (let i = 0; i < frames; i++) step((200 + run * frames + i) * 33);
    runs.push(((performance.now() - start) * 1000) / frames);
  }
  return runs.sort((a, b) => a - b)[2]!;
}

export const ENGINE_CASES: { label: string; setup: () => (t: number) => void }[] = [
  {
    label: 'Track + smooth 1 face',
    setup: () => {
      const tracker = new FaceTracker();
      return (t) => tracker.update([toDetectedFace(nativeFace(t, 1, false), FRAME)], FRAME, t);
    },
  },
  {
    label: 'Same, plus ~130 contour points',
    setup: () => {
      const tracker = new FaceTracker();
      return (t) => tracker.update([toDetectedFace(nativeFace(t, 1, true), FRAME)], FRAME, t);
    },
  },
  {
    label: 'Track + smooth 5 faces',
    setup: () => {
      const tracker = new FaceTracker();
      return (t) =>
        tracker.update(
          [1, 2, 3, 4, 5].map((id) => toDetectedFace(nativeFace(t, id, false), FRAME)),
          FRAME,
          t
        );
    },
  },
  {
    label: 'Map 130 points to the preview',
    setup: () => {
      const points = Object.values(nativeFace(0, 1, true).contours!).flat();
      return () => {
        const transform = createTransform({ source: FRAME, mirrored: true, target: VIEW });
        for (const p of points) transform.point(p);
      };
    },
  },
  {
    label: 'Validation + guidance + stability',
    setup: () => {
      const stability = new StabilityDetector();
      return (t) => {
        const face = toDetectedFace(nativeFace(t, 1, false), FRAME);
        const s = stability.update({
          timestamp: t,
          x: 0.5,
          y: 0.45,
          scale: 0.44,
          yaw: 0,
          pitch: 0,
          roll: 0,
        });
        const validation = validateFace(
          [face],
          { image: FRAME, mirrored: true, stats: face.stats, stableFor: s.stableFor },
          {
            requireCentered: true,
            requireEyesOpen: true,
            requireLookingForward: true,
            minFaceSize: 0.3,
            region: { type: 'oval', cx: 360, cy: 560, rx: 300, ry: 400 },
            stableFor: 500,
          }
        );
        getGuidance(validation);
      };
    },
  },
  {
    label: 'Head tracking + gestures',
    setup: () => {
      const head = new HeadTracker();
      const gestures = new HeadGestureRecognizer();
      return (t) => {
        const face = toDetectedFace(nativeFace(t, 1, false), FRAME);
        head.update(face.headPose!, t);
        gestures.update(head.history, 1);
      };
    },
  },
];

export function runEngineCase(index: number): number {
  return measure(ENGINE_CASES[index]!.setup);
}

import type { DetectedFace, EulerAngles } from '../types';
import { BlinkDetector, type BlinkOptions } from './blink';
import { clamp } from './geometry';
import { HeadGestureRecognizer, type HeadGestureOptions } from './gestures';
import { HeadTracker } from './headTracker';

export type LivenessStep =
  | 'turn-left'
  | 'turn-right'
  | 'look-up'
  | 'look-down'
  | 'tilt-left'
  | 'tilt-right'
  | 'blink'
  | 'smile'
  | 'nod'
  | 'shake';

/** What the user should be told right now. Codes only; see `DEFAULT_LIVENESS_PROMPTS`. */
export type LivenessPrompt =
  | 'POSITION_FACE'
  | 'HOLD_STILL'
  | 'TURN_LEFT'
  | 'TURN_RIGHT'
  | 'LOOK_UP'
  | 'LOOK_DOWN'
  | 'TILT_LEFT'
  | 'TILT_RIGHT'
  | 'BLINK'
  | 'SMILE'
  | 'NOD'
  | 'SHAKE'
  | 'RETURN_TO_CENTER'
  | 'PASSED'
  | 'FAILED';

export type LivenessFailure = 'TIMEOUT' | 'FACE_LOST' | 'MULTIPLE_FACES' | 'FACE_CHANGED';

export type LivenessPhase =
  'idle' | 'positioning' | 'challenge' | 'returning' | 'passed' | 'failed';

export const STEP_PROMPT: Record<LivenessStep, LivenessPrompt> = {
  'turn-left': 'TURN_LEFT',
  'turn-right': 'TURN_RIGHT',
  'look-up': 'LOOK_UP',
  'look-down': 'LOOK_DOWN',
  'tilt-left': 'TILT_LEFT',
  'tilt-right': 'TILT_RIGHT',
  blink: 'BLINK',
  smile: 'SMILE',
  nod: 'NOD',
  shake: 'SHAKE',
};

/** English defaults, e.g. for text-to-speech. Override per language. */
export const DEFAULT_LIVENESS_PROMPTS: Record<LivenessPrompt, string> = {
  POSITION_FACE: 'Position your face in the circle',
  HOLD_STILL: 'Hold still',
  TURN_LEFT: 'Turn your head to the left',
  TURN_RIGHT: 'Turn your head to the right',
  LOOK_UP: 'Look up',
  LOOK_DOWN: 'Look down',
  TILT_LEFT: 'Tilt your head to the left',
  TILT_RIGHT: 'Tilt your head to the right',
  BLINK: 'Blink your eyes',
  SMILE: 'Smile',
  NOD: 'Nod your head',
  SHAKE: 'Shake your head',
  RETURN_TO_CENTER: 'Now look straight at the camera',
  PASSED: 'Verification complete',
  FAILED: 'Verification failed',
};

export interface LivenessOptions {
  /** Default turn-left, turn-right, look-up, blink. */
  steps?: LivenessStep[];
  /** Shuffle the steps each session so a recording can't anticipate them. Default true. */
  randomize?: boolean;
  /** For tests / reproducible order. Default Math.random. */
  random?: () => number;
  /** ms allowed per step (and per return to center). Default 8000. */
  stepTimeout?: number;
  /** ms a move or smile must be held to count. Default 250. */
  holdMs?: number;
  /** Degrees from the resting pose. Defaults 25 / 15 / 18. */
  turnAngle?: number;
  lookAngle?: number;
  tiltAngle?: number;
  /** Max degrees from the resting pose that counts as "back to center". Default 10. */
  centerTolerance?: number;
  /** Absolute degrees yaw/pitch allowed while positioning. Default 12. */
  forwardTolerance?: number;
  /** ms the face must be steady and forward before the resting pose is taken. Default 700. */
  positioningMs?: number;
  /** ms without a face (or with several) before failing. Default 1000. */
  faceLostTimeout?: number;
  /** Smiling probability that counts. Android only. Default 0.8. */
  smileThreshold?: number;
  gestures?: HeadGestureOptions;
  blink?: BlinkOptions;
}

export interface CompletedStep {
  step: LivenessStep;
  /** ms from the prompt to completion. */
  duration: number;
}

export interface LivenessState {
  phase: LivenessPhase;
  prompt: LivenessPrompt;
  /** Step order for this session. */
  steps: LivenessStep[];
  /** Index of the current step (or the next one while returning). */
  stepIndex: number;
  completed: CompletedStep[];
  /** 0..1 how far into the current move the user is. */
  stepProgress: number;
  failure?: LivenessFailure;
}

type Pose = Pick<EulerAngles, 'yaw' | 'pitch' | 'roll'>;

const DIRECTIONAL: Partial<Record<LivenessStep, { axis: keyof Pose; sign: 1 | -1 }>> = {
  'turn-left': { axis: 'yaw', sign: -1 },
  'turn-right': { axis: 'yaw', sign: 1 },
  'look-up': { axis: 'pitch', sign: 1 },
  'look-down': { axis: 'pitch', sign: -1 },
  'tilt-left': { axis: 'roll', sign: -1 },
  'tilt-right': { axis: 'roll', sign: 1 },
};

/**
 * Active liveness challenge, as used in KYC: the user is prompted through a (shuffled) list
 * of moves and each one is verified from the live pose.
 *
 * - Moves are measured from the user's own resting pose, taken once they hold still facing
 *   the camera, and must be held for `holdMs`.
 * - After every head move the user must return to center before the next prompt, so one
 *   sustained turn can't satisfy two steps.
 * - The session fails on a step timeout, when the face is gone or joined by another for
 *   `faceLostTimeout`, or when the tracked face changes identity mid-session.
 *
 * This shows a live person followed instructions. It is not presentation-attack detection:
 * a good enough replay or mask can still pass.
 */
export class LivenessSession {
  private state: LivenessState;
  private baseline: Pose | undefined;
  private faceId: number | undefined;
  private phaseStart: number | undefined;
  private steadySince: number | undefined;
  private holdSince: number | undefined;
  private absentSince: number | undefined;
  private crowdSince: number | undefined;
  private head = new HeadTracker({ smoothing: 0.3 });
  private gestures: HeadGestureRecognizer;
  private blink: BlinkDetector;

  constructor(private readonly options: LivenessOptions = {}) {
    this.gestures = new HeadGestureRecognizer(options.gestures);
    this.blink = new BlinkDetector(options.blink);
    this.state = this.initial('idle');
  }

  get current(): LivenessState {
    return this.state;
  }

  /** Begins (or restarts) a session with a fresh step order. */
  start(): LivenessState {
    this.state = this.initial('positioning');
    this.baseline = undefined;
    this.faceId = undefined;
    this.phaseStart = undefined;
    this.steadySince = undefined;
    this.absentSince = undefined;
    this.crowdSince = undefined;
    this.resetStep();
    return this.state;
  }

  reset(): LivenessState {
    this.start();
    this.state = { ...this.state, phase: 'idle' };
    return this.state;
  }

  /** Feed every analyzed frame. `faces` should be tracked (stable ids) and smoothed. */
  update(faces: DetectedFace[], timestamp: number): LivenessState {
    const s = this.state;
    if (s.phase === 'idle' || s.phase === 'passed' || s.phase === 'failed') return s;
    this.phaseStart ??= timestamp;

    if (s.phase === 'positioning') return this.position(faces, timestamp);

    const failure = this.presence(faces, timestamp);
    if (failure) return this.fail(failure);
    const face = faces[0];
    // Brief dropouts are tolerated; nothing to judge this frame.
    if (!face?.headPose || faces.length !== 1) return s;

    if (timestamp - this.phaseStart > (this.options.stepTimeout ?? 8000))
      return this.fail('TIMEOUT');

    return s.phase === 'returning'
      ? this.returning(face.headPose, timestamp)
      : this.challenge(face, timestamp);
  }

  private initial(phase: LivenessPhase): LivenessState {
    const steps = [...(this.options.steps ?? ['turn-left', 'turn-right', 'look-up', 'blink'])];
    if (this.options.randomize !== false) {
      const random = this.options.random ?? Math.random;
      for (let i = steps.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [steps[i], steps[j]] = [steps[j]!, steps[i]!];
      }
    }
    return { phase, prompt: 'POSITION_FACE', steps, stepIndex: 0, completed: [], stepProgress: 0 };
  }

  private set(patch: Partial<LivenessState>): LivenessState {
    this.state = { ...this.state, ...patch };
    return this.state;
  }

  private fail(failure: LivenessFailure): LivenessState {
    return this.set({ phase: 'failed', prompt: 'FAILED', failure, stepProgress: 0 });
  }

  private resetStep(): void {
    this.holdSince = undefined;
    this.head.reset();
    this.gestures.reset();
    this.blink.reset();
  }

  private deviation(pose: Pose): Pose {
    const b = this.baseline ?? { yaw: 0, pitch: 0, roll: 0 };
    return { yaw: pose.yaw - b.yaw, pitch: pose.pitch - b.pitch, roll: pose.roll - b.roll };
  }

  private position(faces: DetectedFace[], t: number): LivenessState {
    const face = faces.length === 1 ? faces[0] : undefined;
    const pose = face?.headPose;
    const tol = this.options.forwardTolerance ?? 12;
    if (!pose || Math.abs(pose.yaw) > tol || Math.abs(pose.pitch) > tol) {
      this.steadySince = undefined;
      return this.set({ prompt: 'POSITION_FACE', stepProgress: 0 });
    }
    this.steadySince ??= t;
    const needed = this.options.positioningMs ?? 700;
    const held = t - this.steadySince;
    if (held < needed) return this.set({ prompt: 'HOLD_STILL', stepProgress: held / needed });

    this.baseline = { yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll };
    this.faceId = face!.trackingId;
    return this.beginStep(t);
  }

  private beginStep(t: number): LivenessState {
    this.phaseStart = t;
    this.resetStep();
    const step = this.state.steps[this.state.stepIndex]!;
    return this.set({ phase: 'challenge', prompt: STEP_PROMPT[step], stepProgress: 0 });
  }

  private presence(faces: DetectedFace[], t: number): LivenessFailure | null {
    const limit = this.options.faceLostTimeout ?? 1000;
    if (faces.length === 0) this.absentSince ??= t;
    else this.absentSince = undefined;
    if (faces.length > 1) this.crowdSince ??= t;
    else this.crowdSince = undefined;

    if (this.absentSince !== undefined && t - this.absentSince > limit) return 'FACE_LOST';
    if (this.crowdSince !== undefined && t - this.crowdSince > limit) return 'MULTIPLE_FACES';
    const id = faces.length === 1 ? faces[0]!.trackingId : undefined;
    if (this.faceId !== undefined && id !== undefined && id !== this.faceId) return 'FACE_CHANGED';
    return null;
  }

  private challenge(face: DetectedFace, t: number): LivenessState {
    const s = this.state;
    const step = s.steps[s.stepIndex]!;
    const pose = face.headPose!;
    const o = this.options;
    let done = false;
    let progress = s.stepProgress;

    const directional = DIRECTIONAL[step];
    if (directional) {
      const angle =
        directional.axis === 'yaw'
          ? (o.turnAngle ?? 25)
          : directional.axis === 'pitch'
            ? (o.lookAngle ?? 15)
            : (o.tiltAngle ?? 18);
      const d = this.deviation(pose)[directional.axis] * directional.sign;
      progress = clamp(d / angle);
      done = this.held(d >= angle, t);
    } else if (step === 'smile') {
      const p = face.probabilities?.smiling ?? 0;
      progress = clamp(p / (o.smileThreshold ?? 0.8));
      done = this.held(p >= (o.smileThreshold ?? 0.8), t);
    } else if (step === 'blink') {
      done = this.blink.update(face, t)?.type === 'blink';
    } else {
      this.head.update(pose, t);
      done = this.gestures.update(this.head.history, face.trackingId)?.type === step;
    }

    if (!done) return progress === s.stepProgress ? s : this.set({ stepProgress: progress });

    const completed = [...s.completed, { step, duration: t - this.phaseStart! }];
    const stepIndex = s.stepIndex + 1;
    if (stepIndex >= s.steps.length) {
      return this.set({ phase: 'passed', prompt: 'PASSED', completed, stepIndex, stepProgress: 1 });
    }
    this.set({ completed, stepIndex, stepProgress: 1 });
    // Head moves must come back to center first; blink and smile leave the head where it is.
    if (directional || step === 'nod' || step === 'shake') {
      this.phaseStart = t;
      this.holdSince = undefined;
      return this.set({ phase: 'returning', prompt: 'RETURN_TO_CENTER' });
    }
    return this.beginStep(t);
  }

  private returning(pose: Pose, t: number): LivenessState {
    const d = this.deviation(pose);
    const tol = this.options.centerTolerance ?? 10;
    const centered = Math.abs(d.yaw) <= tol && Math.abs(d.pitch) <= tol && Math.abs(d.roll) <= tol;
    return this.held(centered, t, 200) ? this.beginStep(t) : this.state;
  }

  private held(condition: boolean, t: number, ms = this.options.holdMs ?? 250): boolean {
    if (!condition) {
      this.holdSince = undefined;
      return false;
    }
    this.holdSince ??= t;
    return t - this.holdSince >= ms;
  }
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { TakePhotoOptions } from './ExpoFaceVisionCameraView';
import { useFaceCameraController } from './camera/context';
import {
  FaceCameraController,
  type FaceCameraControllerOptions,
  type FrameListener,
  type GuideShape,
} from './camera/controller';
import {
  autoCaptureReducer,
  initialAutoCaptureState,
  type AutoCaptureConfig,
  type AutoCaptureEvent,
  type AutoCaptureState,
} from './core/autoCapture';
import { BlinkDetector, type BlinkEvent, type BlinkOptions } from './core/blink';
import { getCenterFace, getLargestFace } from './core/face';
import {
  HeadGestureRecognizer,
  type HeadGestureEvent,
  type HeadGestureOptions,
} from './core/gestures';
import {
  getGuidance,
  GuidanceFilter,
  type Guidance,
  type GuidanceOptions,
  type GuidanceStatus,
} from './core/guidance';
import {
  emptyCoverage,
  HeadCoverageTracker,
  type HeadCoverage,
  type HeadCoverageOptions,
} from './core/headCoverage';
import { HeadTracker, type HeadMovement, type HeadTrackingOptions } from './core/headTracker';
import {
  DEFAULT_LIVENESS_PROMPTS,
  LivenessSession,
  type LivenessFailure,
  type LivenessOptions,
  type LivenessPrompt,
  type LivenessState,
  type LivenessStep,
} from './core/liveness';
import { analyzeFaceQuality, type FaceQuality, type QualityOptions } from './core/quality';
import { StabilityDetector, type StabilityOptions, type StabilityState } from './core/stability';
import type { TrackedFace } from './core/tracker';
import { validateFace, type ValidationResult, type ValidationRules } from './core/validation';
import { playHaptic } from './haptics';
import { detectFaces, type DetectFacesOptions } from './image';
import { createSpeaker, type VoiceOptions } from './speech';
import type {
  DetectedFace,
  FaceDetectionResult,
  FaceFrame,
  ImageSource,
  ProcessedImage,
} from './types';

/** Stable controller for a `<FaceCamera camera={...}>` you render yourself. */
export function useFaceCamera(options: FaceCameraControllerOptions = {}): FaceCameraController {
  const [camera] = useState(() => new FaceCameraController(options));
  const key = JSON.stringify(options);
  useEffect(() => camera.configure(options), [camera, key]);
  return camera;
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Runs `listener` for every analyzed frame without re-rendering. */
export function useFaceFrames(listener: FrameListener, camera?: FaceCameraController | null): void {
  const controller = useFaceCameraController(camera);
  const latest = useLatest(listener);
  useEffect(() => controller?.subscribe((f, t) => latest.current(f, t)), [controller, latest]);
}

export type FaceSelector =
  'largest' | 'center' | ((faces: DetectedFace[], frame: FaceFrame) => DetectedFace | undefined);

function selectFace(frame: FaceFrame, select: FaceSelector = 'largest'): DetectedFace | undefined {
  if (typeof select === 'function') return select(frame.faces, frame);
  return select === 'center'
    ? getCenterFace(frame.faces, frame.frame)
    : getLargestFace(frame.faces);
}

interface CameraHookOptions {
  /** Defaults to the nearest `<FaceCamera>`. */
  camera?: FaceCameraController | null;
  /** Which face single-face hooks follow. Default `largest`. */
  select?: FaceSelector;
}

/** Static image detection. Re-runs when `source` or `options` change. */
export function useFaceDetection(
  source: ImageSource | null | undefined,
  options: DetectFacesOptions = {}
) {
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify([source, options, nonce]);
  const [state, setState] = useState<{
    key: string | null;
    result: FaceDetectionResult | null;
    error: unknown;
  }>({ key: null, result: null, error: null });
  const latest = useLatest({ source, options });

  useEffect(() => {
    const { source, options } = latest.current;
    if (source == null) return;
    let cancelled = false;
    detectFaces(source, options).then(
      (result) => !cancelled && setState({ key, result, error: null }),
      (error) => !cancelled && setState({ key, result: null, error })
    );
    return () => {
      cancelled = true;
    };
  }, [key, latest]);

  const current = state.key === key;
  return {
    result: current ? state.result : null,
    error: current ? state.error : null,
    loading: source != null && !current,
    /** Runs detection again with the same inputs. */
    detect: () => setNonce((n) => n + 1),
  };
}

export interface FaceTrackingCallbacks extends CameraHookOptions {
  onFaceDetected?: (face: TrackedFace) => void;
  onFaceUpdated?: (face: TrackedFace) => void;
  onFaceLost?: (face: TrackedFace) => void;
}

/** Track lifecycle callbacks. Re-renders only when the set of tracked ids changes. */
export function useFaceTracking(options: FaceTrackingCallbacks = {}): { trackingIds: number[] } {
  const cb = useLatest(options);
  const [ids, setIds] = useState<number[]>([]);
  useFaceFrames((_, tracking) => {
    if (!tracking) return;
    for (const f of tracking.entered) cb.current.onFaceDetected?.(f);
    for (const f of tracking.updated) cb.current.onFaceUpdated?.(f);
    for (const f of tracking.lost) cb.current.onFaceLost?.(f);
    if (tracking.entered.length || tracking.lost.length)
      setIds(tracking.faces.map((f) => f.trackingId));
  }, options.camera);
  return { trackingIds: ids };
}

/** ms a followed face may go undetected before per-face state (neutral pose, blink baseline) resets. */
const FACE_GONE_MS = 1000;

/**
 * Follows one face across frames and runs `fn` with it, calling `reset` when a different face
 * is followed or the face has been gone for FACE_GONE_MS. Single missed detections don't reset:
 * Vision often drops a frame when the head is turned, and resetting then would take the
 * turned pose as the new neutral.
 */
function useSelectedFace(
  options: CameraHookOptions,
  fn: (face: DetectedFace, frame: FaceFrame) => void,
  reset: () => void
) {
  const followed = useRef<{ id: number; lastSeen: number } | null>(null);
  const latestFn = useLatest(fn);
  const latestReset = useLatest(reset);
  useFaceFrames((frame) => {
    const face = selectFace(frame, options.select);
    const current = followed.current;
    if (!face) {
      if (current && frame.timestamp - current.lastSeen > FACE_GONE_MS) {
        followed.current = null;
        latestReset.current();
      }
      return;
    }
    const id = face.trackingId ?? -1;
    if (!current || current.id !== id) latestReset.current();
    followed.current = { id, lastSeen: frame.timestamp };
    latestFn.current(face, frame);
  }, options.camera);
}

export interface UseHeadTrackingOptions extends HeadTrackingOptions, CameraHookOptions {
  /** Every analyzed frame. Not a render. */
  onMovement?: (movement: HeadMovement) => void;
}

/**
 * Head movement across frames. `movement` re-renders only when its discrete parts (directions,
 * stable) change; read `getLatest()` or use `onMovement` for continuous values.
 */
export function useHeadTracking(options: UseHeadTrackingOptions = {}) {
  const key = JSON.stringify({
    ...options,
    camera: undefined,
    select: undefined,
    onMovement: undefined,
  });
  const tracker = useMemo(() => new HeadTracker(options), [key]);
  const latest = useRef<HeadMovement | null>(null);
  const [movement, setMovement] = useState<HeadMovement | null>(null);
  const cb = useLatest(options.onMovement);
  const signature = (m: HeadMovement | null) =>
    m ? `${m.horizontal}|${m.vertical}|${m.roll}|${m.direction}|${m.stable}` : '';

  useSelectedFace(
    options,
    (face, frame) => {
      if (!face.headPose) return;
      const m = tracker.update(face.headPose, frame.timestamp);
      const changed = signature(m) !== signature(latest.current);
      latest.current = m;
      cb.current?.(m);
      if (changed) setMovement(m);
    },
    () => {
      tracker.reset();
      latest.current = null;
      setMovement(null);
    }
  );
  return { movement, getLatest: () => latest.current, history: tracker.history };
}

export interface UseHeadGestureOptions
  extends HeadGestureOptions, HeadTrackingOptions, CameraHookOptions {
  onGesture?: (event: HeadGestureEvent) => void;
  /** A light tap per recognized gesture (needs expo-haptics). Default false. */
  haptics?: boolean;
}

export function useHeadGesture(options: UseHeadGestureOptions = {}) {
  const key = JSON.stringify({
    ...options,
    camera: undefined,
    select: undefined,
    onGesture: undefined,
    haptics: undefined,
  });
  const { tracker, recognizer } = useMemo(
    () => ({ tracker: new HeadTracker(options), recognizer: new HeadGestureRecognizer(options) }),
    [key]
  );
  const [last, setLast] = useState<HeadGestureEvent | null>(null);
  const cb = useLatest(options.onGesture);
  const haptics = useLatest(options.haptics);
  useSelectedFace(
    options,
    (face, frame) => {
      if (!face.headPose) return;
      tracker.update(face.headPose, frame.timestamp);
      const event = recognizer.update(tracker.history, face.trackingId);
      if (!event) return;
      if (haptics.current) playHaptic('tick', true);
      cb.current?.(event);
      setLast(event);
    },
    () => {
      tracker.reset();
      recognizer.reset();
    }
  );
  return { lastGesture: last, reset: () => recognizer.reset() };
}

export interface UseHeadCoverageOptions extends HeadCoverageOptions, CameraHookOptions {
  /** Default true. */
  enabled?: boolean;
  onComplete?: () => void;
  /** A success haptic when the circle completes (needs expo-haptics). Default true. */
  haptics?: boolean;
}

/**
 * The Face ID "move your head in a circle" step. Re-renders only when a new segment fills,
 * so at most `segments` times. Pair it with `<FaceScanRing covered={covered}>`.
 */
export function useHeadCoverage(options: UseHeadCoverageOptions = {}) {
  const key = JSON.stringify([
    options.segments,
    options.minYaw,
    options.minPitch,
    options.spread,
    options.mirrored,
  ]);
  const tracker = useMemo(() => new HeadCoverageTracker(options), [key]);
  // Tagged with its tracker so new options start from an empty ring without an extra effect.
  const [state, setState] = useState<{ tracker: HeadCoverageTracker; coverage: HeadCoverage }>({
    tracker,
    coverage: emptyCoverage(options.segments),
  });
  const coverage = state.tracker === tracker ? state.coverage : emptyCoverage(options.segments);
  const opts = useLatest(options);
  const lastCount = useRef(0);

  useFaceFrames((frame) => {
    if (opts.current.enabled === false) return;
    const face = selectFace(frame, opts.current.select);
    if (!face?.headPose) return;
    const next = tracker.update(face.headPose);
    if (next.count === lastCount.current) return;
    lastCount.current = next.count;
    setState({ tracker, coverage: next });
    if (next.complete) {
      if (opts.current.haptics !== false) playHaptic('success', opts.current.haptics === true);
      opts.current.onComplete?.();
    }
  }, options.camera);

  return {
    ...coverage,
    reset: () => {
      lastCount.current = 0;
      setState({ tracker, coverage: tracker.reset() });
    },
  };
}

export interface UseLivenessChallengeOptions extends LivenessOptions {
  camera?: FaceCameraController | null;
  /** Text per prompt, merged over `DEFAULT_LIVENESS_PROMPTS` (English). */
  prompts?: Partial<Record<LivenessPrompt, string>>;
  /**
   * Speak each prompt through expo-speech (optional peer; install it to use this). `true` for
   * defaults, or language/rate/pitch/voice. Without expo-speech it stays silent and warns once.
   */
  voice?: boolean | VoiceOptions;
  /**
   * Your own text-to-speech instead of expo-speech; takes precedence over `voice`. Prompts are
   * spoken once they've held for `speechDelay`, so a flickering state doesn't stutter the voice.
   */
  speak?: (text: string) => void;
  /** ms a prompt must hold before `speak` is called. Default 300. */
  speechDelay?: number;
  /** Tap per completed step, success on pass, error on fail (needs expo-haptics). Default true. */
  haptics?: boolean;
  onPrompt?: (prompt: LivenessPrompt, text: string) => void;
  onStepComplete?: (step: LivenessStep, index: number) => void;
  onPass?: (state: LivenessState) => void;
  onFail?: (failure: LivenessFailure, state: LivenessState) => void;
}

/**
 * KYC-style active liveness: prompts the user through shuffled head moves (and optionally
 * blink/smile), verifies each from the live pose, and speaks the prompts if you pass `speak`.
 * Re-renders on phase, prompt or step changes and in 10% steps of the current move's progress.
 * Call `start()` to begin. See `LivenessSession` for what this does and doesn't prove.
 */
export function useLivenessChallenge(options: UseLivenessChallengeOptions = {}) {
  const key = JSON.stringify({
    ...options,
    camera: undefined,
    prompts: undefined,
    voice: undefined,
    speak: undefined,
    haptics: undefined,
    onPrompt: undefined,
    onStepComplete: undefined,
    onPass: undefined,
    onFail: undefined,
  });
  const session = useMemo(() => new LivenessSession(options), [key]);
  const [state, setState] = useState<LivenessState>(() => session.current);
  const opts = useLatest(options);
  const shown = useRef(state);
  const spoken = useRef<{ prompt: LivenessPrompt | null; timer?: ReturnType<typeof setTimeout> }>({
    prompt: null,
  });

  const voiceKey = JSON.stringify(options.voice ?? false);
  const speaker = useMemo(
    () => (options.voice ? createSpeaker(options.voice === true ? {} : options.voice) : null),
    [voiceKey]
  );
  // Cut off the voice when it's turned off or the screen goes away.
  useEffect(() => () => speaker?.stop(), [speaker]);

  const textOf = (prompt: LivenessPrompt) =>
    opts.current.prompts?.[prompt] ?? DEFAULT_LIVENESS_PROMPTS[prompt];

  const publish = (next: LivenessState) => {
    const prev = shown.current;
    const bucket = (v: number) => Math.floor(v * 10);
    const changed =
      next.phase !== prev.phase ||
      next.prompt !== prev.prompt ||
      next.stepIndex !== prev.stepIndex ||
      next.steps !== prev.steps ||
      bucket(next.stepProgress) !== bucket(prev.stepProgress);
    if (!changed) return;
    shown.current = next;
    setState(next);

    const o = opts.current;
    const haptic = (kind: 'tick' | 'success' | 'error') => {
      if (o.haptics !== false) playHaptic(kind, o.haptics === true);
    };
    if (next.phase === 'passed' && prev.phase !== 'passed') haptic('success');
    else if (next.phase === 'failed' && prev.phase !== 'failed') haptic('error');
    else if (next.stepIndex > prev.stepIndex && next.steps === prev.steps) haptic('tick');
    if (next.stepIndex > prev.stepIndex && next.steps === prev.steps) {
      o.onStepComplete?.(next.steps[next.stepIndex - 1]!, next.stepIndex - 1);
    }
    if (next.phase === 'passed' && prev.phase !== 'passed') o.onPass?.(next);
    if (next.phase === 'failed' && prev.phase !== 'failed') o.onFail?.(next.failure!, next);

    if (next.prompt !== prev.prompt || next.phase !== prev.phase) {
      const text = textOf(next.prompt);
      o.onPrompt?.(next.prompt, text);
      const speech = spoken.current;
      clearTimeout(speech.timer);
      const say = o.speak ?? speaker?.speak;
      if (say && next.phase !== 'idle' && next.prompt !== speech.prompt) {
        speech.timer = setTimeout(() => {
          speech.prompt = next.prompt;
          say(text);
        }, o.speechDelay ?? 300);
      }
    }
  };

  useEffect(() => () => clearTimeout(spoken.current.timer), []);

  useFaceFrames((frame) => publish(session.update(frame.faces, frame.timestamp)), options.camera);

  return {
    ...state,
    /** Text for the current prompt. */
    text: textOf(state.prompt),
    start: () => {
      spoken.current.prompt = null;
      publish(session.start());
    },
    reset: () => {
      spoken.current.prompt = null;
      publish(session.reset());
    },
  };
}

export interface UseBlinkDetectionOptions extends BlinkOptions, CameraHookOptions {
  onBlink?: (event: BlinkEvent) => void;
  /** A light tap per blink (needs expo-haptics). Default false. */
  haptics?: boolean;
}

/**
 * Needs eye signals: `classification: true` on Android, `contours: true` on iOS. Check
 * `getCapabilities().blink` for which one this platform uses.
 */
export function useBlinkDetection(options: UseBlinkDetectionOptions = {}) {
  const key = JSON.stringify({
    ...options,
    camera: undefined,
    select: undefined,
    onBlink: undefined,
    haptics: undefined,
  });
  const detector = useMemo(() => new BlinkDetector(options), [key]);
  const [state, setState] = useState<{ count: number; lastBlink: BlinkEvent | null }>({
    count: 0,
    lastBlink: null,
  });
  const cb = useLatest(options.onBlink);
  const haptics = useLatest(options.haptics);
  useSelectedFace(
    options,
    (face, frame) => {
      const event = detector.update(face, frame.timestamp);
      if (!event) return;
      if (haptics.current) playHaptic('tick', true);
      cb.current?.(event);
      if (event.type === 'blink') setState({ count: event.count, lastBlink: event });
    },
    () => detector.reset()
  );
  const reset = () => {
    detector.reset();
    setState({ count: 0, lastBlink: null });
  };
  return { ...state, reset };
}

export interface UseFaceQualityOptions extends QualityOptions, CameraHookOptions {
  /** Min ms between re-renders. Default 250. */
  throttleMs?: number;
  stability?: StabilityOptions;
}

/** Per-face quality, throttled. Luma-based parts need `frameStats` on the camera. */
export function useFaceQuality(options: UseFaceQualityOptions = {}): FaceQuality | null {
  const key = JSON.stringify(options.stability ?? {});
  const stability = useMemo(() => new StabilityDetector(options.stability), [key]);
  const [quality, setQuality] = useState<FaceQuality | null>(null);
  const lastRender = useRef(0);
  const opts = useLatest(options);
  useSelectedFace(
    options,
    (face, frame) => {
      const s = stabilityOf(stability, face, frame);
      const now = Date.now();
      if (now - lastRender.current < (opts.current.throttleMs ?? 250)) return;
      lastRender.current = now;
      setQuality(
        analyzeFaceQuality(
          face,
          {
            image: frame.frame,
            stats: face.stats,
            stable: s.stable,
            visibleRect: frame.visibleRect,
          },
          opts.current
        )
      );
    },
    () => {
      stability.reset();
      setQuality(null);
    }
  );
  return quality;
}

function stabilityOf(
  detector: StabilityDetector,
  face: DetectedFace,
  frame: FaceFrame
): StabilityState {
  return detector.update({
    timestamp: frame.timestamp,
    x: face.normalizedBounds.x + face.normalizedBounds.width / 2,
    y: face.normalizedBounds.y + face.normalizedBounds.height / 2,
    scale: face.normalizedBounds.width,
    yaw: face.headPose?.yaw,
    pitch: face.headPose?.pitch,
    roll: face.headPose?.roll,
  });
}

/** Short-form requirements, as used by `<FaceCamera requirements>`. */
export interface FaceRequirements extends Omit<
  ValidationRules,
  | 'requireSingleFace'
  | 'requireCentered'
  | 'requireEyesOpen'
  | 'requireLookingForward'
  | 'requireFullyInFrame'
  | 'region'
> {
  /** Default true. */
  singleFace?: boolean;
  centered?: boolean;
  eyesOpen?: boolean;
  lookingForward?: boolean;
  fullyInFrame?: boolean;
  /** Face must sit inside this preview-space oval (same shape you give `<FaceGuide>`). */
  guide?: GuideShape;
  /** Min fraction of the face box inside `guide`. Default 0.9. */
  minGuideCoverage?: number;
}

export function toValidationRules(
  r: FaceRequirements,
  camera: FaceCameraController | null
): ValidationRules {
  const {
    singleFace,
    centered,
    eyesOpen,
    lookingForward,
    fullyInFrame,
    guide,
    minGuideCoverage,
    ...rest
  } = r;
  const region = guide ? (camera?.toFrameRegion(guide) ?? undefined) : undefined;
  return {
    ...rest,
    requireSingleFace: singleFace,
    requireCentered: centered,
    requireEyesOpen: eyesOpen,
    requireLookingForward: lookingForward,
    requireFullyInFrame: fullyInFrame,
    region,
    minRegionCoverage: minGuideCoverage ?? (region ? 0.9 : undefined),
  };
}

function validateFrame(
  frame: FaceFrame,
  rules: ValidationRules,
  stability: StabilityDetector
): { validation: ValidationResult; stable: StabilityState } {
  const face = getLargestFace(frame.faces);
  const stable = face ? stabilityOf(stability, face, frame) : stability.reset();
  const validation = validateFace(
    frame.faces,
    {
      image: frame.frame,
      mirrored: frame.mirrored,
      visibleRect: frame.visibleRect,
      stats: face?.stats,
      stable: stable.stable,
      stableFor: stable.stableFor,
    },
    rules
  );
  return { validation, stable };
}

export interface UseFaceValidationOptions extends GuidanceOptions {
  camera?: FaceCameraController | null;
  /** ms a new guidance status must hold before it's shown. Default 300. */
  guidanceDelay?: number;
  stability?: StabilityOptions;
}

/**
 * Validation + guidance per frame. Re-renders only when `valid`, the issue codes or the shown
 * guidance status change.
 */
export function useFaceValidation(
  requirements: FaceRequirements,
  options: UseFaceValidationOptions = {}
) {
  const camera = useFaceCameraController(options.camera);
  const key = JSON.stringify([options.stability, options.guidanceDelay]);
  const { stability, filter } = useMemo(
    () => ({
      stability: new StabilityDetector(options.stability),
      filter: new GuidanceFilter(options.guidanceDelay),
    }),
    [key]
  );
  const [state, setState] = useState<{
    validation: ValidationResult | null;
    guidance: Guidance | null;
    status: GuidanceStatus | null;
  }>({
    validation: null,
    guidance: null,
    status: null,
  });
  const req = useLatest(requirements);
  const opts = useLatest(options);
  const sig = useRef('');
  useFaceFrames((frame) => {
    const { validation } = validateFrame(frame, toValidationRules(req.current, camera), stability);
    const guidance = getGuidance(validation, opts.current);
    const status = filter.update(guidance.status, frame.timestamp);
    const next = `${validation.valid}|${status}|${validation.issues.map((i) => i.code).join(',')}`;
    if (next === sig.current) return;
    sig.current = next;
    setState({ validation, guidance, status });
  }, camera);
  return state;
}

export interface AutoCaptureResult {
  photo: ProcessedImage;
  /** The analyzed frame that satisfied the requirements. Geometry is in its `frame` pixels, not the photo's. */
  frame: FaceFrame | null;
  face?: DetectedFace;
}

export interface UseFaceAutoCaptureOptions extends AutoCaptureConfig {
  camera?: FaceCameraController | null;
  requirements?: FaceRequirements;
  /** A success haptic when the photo is taken (needs expo-haptics). Default true. */
  haptics?: boolean;
  /** Default true. When false the machine stays IDLE. */
  enabled?: boolean;
  photo?: TakePhotoOptions;
  stability?: StabilityOptions;
  onCapture?: (result: AutoCaptureResult) => void;
  onCaptureError?: (error: unknown) => void;
  onStateChange?: (state: AutoCaptureState) => void;
}

/**
 * Auto capture as a deterministic state machine (see `autoCaptureReducer`). The machine runs
 * on the JS clock; frames only feed it. Photos are taken exactly once per CAPTURING entry.
 */
export function useFaceAutoCapture(options: UseFaceAutoCaptureOptions = {}) {
  const camera = useFaceCameraController(options.camera);
  const opts = useLatest(options);
  const stabilityKey = JSON.stringify(options.stability ?? {});
  const stability = useMemo(() => new StabilityDetector(options.stability), [stabilityKey]);
  const [state, setState] = useState<AutoCaptureState>(() => initialAutoCaptureState(Date.now()));
  const stateRef = useRef(state);
  const lastValidFrame = useRef<FaceFrame | null>(null);

  const captureRef = useRef<() => void>(() => {});

  const send = useCallback((event: AutoCaptureEvent) => {
    const { stableFor, countdown, cooldown, continuous } = opts.current;
    const next = autoCaptureReducer(stateRef.current, event, {
      stableFor,
      countdown,
      cooldown,
      continuous,
    });
    if (next === stateRef.current) return;
    const prev = stateRef.current;
    stateRef.current = next;
    setState(next);
    opts.current.onStateChange?.(next);
    if (next.status === 'CAPTURING' && prev.status !== 'CAPTURING') captureRef.current();
  }, []);

  const capture = async () => {
    if (!camera)
      return send({ type: 'CAPTURE_FAILED', timestamp: Date.now(), error: new Error('No camera') });
    const frame = lastValidFrame.current ?? camera.latest;
    try {
      const photo = await camera.takePhoto(opts.current.photo);
      send({ type: 'CAPTURED', timestamp: Date.now() });
      if (opts.current.haptics !== false) playHaptic('success', opts.current.haptics === true);
      opts.current.onCapture?.({
        photo,
        frame,
        face: frame ? getLargestFace(frame.faces) : undefined,
      });
    } catch (error) {
      send({ type: 'CAPTURE_FAILED', timestamp: Date.now(), error });
      opts.current.onCaptureError?.(error);
    }
  };
  useLayoutEffect(() => {
    captureRef.current = capture;
  });

  const enabled = options.enabled ?? true;
  useEffect(() => {
    send({ type: enabled ? 'START' : 'STOP', timestamp: Date.now() });
  }, [enabled, send]);

  useFaceFrames((frame) => {
    if (stateRef.current.status === 'IDLE' || stateRef.current.status === 'CAPTURING') return;
    const { stableFor: _ignored, ...rules } = toValidationRules(
      opts.current.requirements ?? {},
      camera
    );
    const { validation, stable } = validateFrame(frame, rules, stability);
    if (validation.valid) lastValidFrame.current = frame;
    send({
      type: 'FRAME',
      timestamp: Date.now(),
      faceCount: frame.faces.length,
      valid: validation.valid,
      stableFor: stable.stableFor,
    });
  }, camera);

  // Countdown and cooldown must advance even if frames stop (e.g. detection paused).
  const timed = state.status === 'COUNTDOWN' || state.status === 'COOLDOWN';
  useEffect(() => {
    if (!timed) return;
    const id = setInterval(() => send({ type: 'TICK', timestamp: Date.now() }), 100);
    return () => clearInterval(id);
  }, [timed, send]);

  return {
    state,
    start: () => send({ type: 'START', timestamp: Date.now() }),
    stop: () => send({ type: 'STOP', timestamp: Date.now() }),
    reset: () => {
      stability.reset();
      send({ type: 'RESET', timestamp: Date.now() });
      if (opts.current.enabled ?? true) send({ type: 'START', timestamp: Date.now() });
    },
    /** Manual shutter. Goes through the machine, so it can't double-fire with an auto capture. */
    capture: () => send({ type: 'TRIGGER', timestamp: Date.now() }),
  };
}

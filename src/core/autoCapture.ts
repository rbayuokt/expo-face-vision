export type AutoCaptureStatus =
  | 'IDLE'
  | 'SEARCHING'
  | 'ALIGNING'
  | 'STABILIZING'
  | 'READY'
  | 'COUNTDOWN'
  | 'CAPTURING'
  | 'COOLDOWN';

export interface AutoCaptureConfig {
  /** ms the face must stay valid and stable before READY. Default 500. */
  stableFor?: number;
  /** ms of countdown after READY; 0 captures immediately. Default 0. */
  countdown?: number;
  /** ms after a capture before searching again. Default 1500. */
  cooldown?: number;
  /** Keep capturing after the first photo. Default false: the machine stops at IDLE. */
  continuous?: boolean;
}

export interface AutoCaptureState {
  status: AutoCaptureStatus;
  /** When the current status was entered, ms. */
  since: number;
  captures: number;
  /** Only in COUNTDOWN. */
  countdownEndsAt?: number;
  /** Only in COOLDOWN. */
  cooldownEndsAt?: number;
  /** Last capture failure, cleared on the next attempt. */
  error?: unknown;
}

/**
 * `valid` is every requirement except stability; `stableFor` is how long the face has been
 * stable (0 if not). Keeping them apart is what separates ALIGNING from STABILIZING.
 */
export interface AutoCaptureFrame {
  timestamp: number;
  faceCount: number;
  valid: boolean;
  stableFor: number;
}

export type AutoCaptureEvent =
  | { type: 'START'; timestamp: number }
  | { type: 'STOP'; timestamp: number }
  | { type: 'RESET'; timestamp: number }
  | ({ type: 'FRAME' } & AutoCaptureFrame)
  /** Advances countdown/cooldown without a frame. */
  | { type: 'TICK'; timestamp: number }
  /** Manual shutter: capture now, skipping the remaining requirements. */
  | { type: 'TRIGGER'; timestamp: number }
  | { type: 'CAPTURED'; timestamp: number }
  | { type: 'CAPTURE_FAILED'; timestamp: number; error?: unknown };

export function initialAutoCaptureState(timestamp = 0): AutoCaptureState {
  return { status: 'IDLE', since: timestamp, captures: 0 };
}

/**
 * Pure reducer. The only side effect it implies is "take a photo" on entering CAPTURING, which
 * happens exactly once per entry because CAPTURING ignores frames, triggers and ticks until
 * CAPTURED or CAPTURE_FAILED arrives. That is what prevents duplicate captures.
 */
export function autoCaptureReducer(
  state: AutoCaptureState,
  event: AutoCaptureEvent,
  config: AutoCaptureConfig = {}
): AutoCaptureState {
  const t = event.timestamp;
  const go = (
    status: AutoCaptureStatus,
    extra: Partial<AutoCaptureState> = {}
  ): AutoCaptureState =>
    status === state.status && Object.keys(extra).length === 0
      ? state
      : { status, since: t, captures: state.captures, error: state.error, ...extra };

  switch (event.type) {
    case 'STOP':
      return go('IDLE');
    case 'RESET':
      return initialAutoCaptureState(t);
    case 'START':
      return state.status === 'IDLE' ? go('SEARCHING', { error: undefined }) : state;
    case 'TRIGGER':
      return state.status === 'CAPTURING' ? state : go('CAPTURING', { error: undefined });
    case 'CAPTURED':
      if (state.status !== 'CAPTURING') return state;
      return {
        status: config.continuous ? 'COOLDOWN' : 'IDLE',
        since: t,
        captures: state.captures + 1,
        cooldownEndsAt: config.continuous ? t + (config.cooldown ?? 1500) : undefined,
      };
    case 'CAPTURE_FAILED':
      return state.status === 'CAPTURING' ? { ...go('SEARCHING'), error: event.error } : state;
    case 'TICK':
    case 'FRAME':
      break;
  }

  switch (state.status) {
    case 'IDLE':
    case 'CAPTURING':
      return state;
    case 'COOLDOWN':
      return t >= (state.cooldownEndsAt ?? t) ? go('SEARCHING') : state;
    case 'COUNTDOWN':
      if (event.type === 'FRAME' && (event.faceCount === 0 || !event.valid)) {
        return go(event.faceCount === 0 ? 'SEARCHING' : 'ALIGNING');
      }
      return t >= (state.countdownEndsAt ?? t) ? go('CAPTURING') : state;
  }

  if (event.type !== 'FRAME') return state;
  if (event.faceCount === 0) return go('SEARCHING');
  if (!event.valid) return go('ALIGNING');

  const stableFor = config.stableFor ?? 500;
  switch (state.status) {
    case 'SEARCHING':
      return go('ALIGNING');
    case 'ALIGNING':
      return go('STABILIZING');
    case 'STABILIZING':
      return event.stableFor >= stableFor ? go('READY') : state;
    case 'READY': {
      const countdown = config.countdown ?? 0;
      return countdown > 0 ? go('COUNTDOWN', { countdownEndsAt: t + countdown }) : go('CAPTURING');
    }
  }
  return state;
}

/** Stateful wrapper around the reducer for non-React use. */
export class AutoCaptureMachine {
  state: AutoCaptureState;

  constructor(
    private readonly config: AutoCaptureConfig = {},
    timestamp = 0
  ) {
    this.state = initialAutoCaptureState(timestamp);
  }

  send(event: AutoCaptureEvent): AutoCaptureState {
    this.state = autoCaptureReducer(this.state, event, this.config);
    return this.state;
  }
}

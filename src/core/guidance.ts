import type { Point } from '../types';
import type { ValidationIssue, ValidationResult } from './validation';

/** Codes only; apps own the wording and localization. */
export type GuidanceStatus =
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'FACE_TOO_SMALL'
  | 'FACE_TOO_LARGE'
  | 'MOVE_LEFT'
  | 'MOVE_RIGHT'
  | 'MOVE_UP'
  | 'MOVE_DOWN'
  | 'MOVE_CLOSER'
  | 'MOVE_FARTHER'
  | 'LOOK_FORWARD'
  | 'LOOK_LEFT'
  | 'LOOK_RIGHT'
  | 'OPEN_EYES'
  | 'TOO_DARK'
  | 'TOO_BRIGHT'
  | 'TOO_BLURRY'
  | 'HOLD_STILL'
  /** Only unmet custom rules or unavailable signals remain; see `issue`. */
  | 'REQUIREMENT_NOT_MET'
  | 'READY';

export interface GuidanceOptions {
  /**
   * `distance`: MOVE_CLOSER / MOVE_FARTHER. `size`: FACE_TOO_SMALL / FACE_TOO_LARGE.
   * Default `distance`.
   */
  sizeGuidance?: 'distance' | 'size';
  /** Override the order issues are addressed in. Earlier wins. */
  priority?: GuidanceStatus[];
}

export interface Guidance {
  status: GuidanceStatus;
  /** The issue behind `status`. */
  issue?: ValidationIssue;
  /** Every applicable status, highest priority first. */
  statuses: GuidanceStatus[];
}

export const DEFAULT_GUIDANCE_PRIORITY: GuidanceStatus[] = [
  'NO_FACE',
  'MULTIPLE_FACES',
  'TOO_DARK',
  'TOO_BRIGHT',
  'MOVE_CLOSER',
  'MOVE_FARTHER',
  'FACE_TOO_SMALL',
  'FACE_TOO_LARGE',
  'MOVE_LEFT',
  'MOVE_RIGHT',
  'MOVE_UP',
  'MOVE_DOWN',
  'LOOK_LEFT',
  'LOOK_RIGHT',
  'LOOK_FORWARD',
  'OPEN_EYES',
  'TOO_BLURRY',
  'HOLD_STILL',
  'REQUIREMENT_NOT_MET',
];

/** The move that brings a face at `offset` (screen space, + is right/down) back to center. */
function moveFor(offset: Point): GuidanceStatus {
  if (Math.abs(offset.x) >= Math.abs(offset.y)) return offset.x > 0 ? 'MOVE_LEFT' : 'MOVE_RIGHT';
  return offset.y > 0 ? 'MOVE_UP' : 'MOVE_DOWN';
}

/**
 * Turns a validation result into one actionable status. MOVE_* are screen directions (the face
 * should move toward that side of the preview as displayed); LOOK_* are the subject's own
 * left/right, which is what "turn your head left" means to a person.
 */
export function getGuidance(validation: ValidationResult, options: GuidanceOptions = {}): Guidance {
  if (validation.valid) return { status: 'READY', statuses: ['READY'] };
  const size = options.sizeGuidance ?? 'distance';
  const mapped: { status: GuidanceStatus; issue: ValidationIssue }[] = [];

  for (const issue of validation.issues) {
    let status: GuidanceStatus;
    switch (issue.code) {
      case 'NO_FACE':
      case 'MULTIPLE_FACES':
      case 'TOO_DARK':
      case 'TOO_BRIGHT':
      case 'TOO_BLURRY':
        status = issue.code as GuidanceStatus;
        break;
      case 'FACE_TOO_SMALL':
        status = size === 'size' ? 'FACE_TOO_SMALL' : 'MOVE_CLOSER';
        break;
      case 'FACE_TOO_LARGE':
        status = size === 'size' ? 'FACE_TOO_LARGE' : 'MOVE_FARTHER';
        break;
      case 'FACE_NOT_CENTERED':
      case 'FACE_OUTSIDE_FRAME':
        status = validation.position ? moveFor(validation.position.offset) : 'REQUIREMENT_NOT_MET';
        break;
      case 'FACE_OUTSIDE_REGION':
        status = validation.region ? moveFor(validation.region.offset) : 'REQUIREMENT_NOT_MET';
        break;
      case 'YAW_TOO_LARGE':
        // Turned to their right -> ask them to turn back to their left.
        status = (issue.value ?? 0) > 0 ? 'LOOK_LEFT' : 'LOOK_RIGHT';
        break;
      case 'PITCH_TOO_LARGE':
      case 'ROLL_TOO_LARGE':
        status = 'LOOK_FORWARD';
        break;
      case 'EYES_CLOSED':
        status = 'OPEN_EYES';
        break;
      case 'NOT_STABLE':
        status = 'HOLD_STILL';
        break;
      default:
        status = 'REQUIREMENT_NOT_MET';
    }
    mapped.push({ status, issue });
  }

  const priority = options.priority ?? DEFAULT_GUIDANCE_PRIORITY;
  const rank = (s: GuidanceStatus) => {
    const i = priority.indexOf(s);
    return i === -1 ? priority.length : i;
  };
  mapped.sort((a, b) => rank(a.status) - rank(b.status));
  const statuses = [...new Set(mapped.map((m) => m.status))];
  return { status: mapped[0]!.status, issue: mapped[0]!.issue, statuses };
}

/**
 * Hysteresis for on-screen guidance: a new status must hold for `minDuration` ms before it
 * replaces the shown one, so a face sitting on a threshold doesn't flicker the prompt.
 */
export class GuidanceFilter {
  private shown: GuidanceStatus | undefined;
  private pending: { status: GuidanceStatus; since: number } | undefined;

  constructor(private readonly minDuration = 300) {}

  update(status: GuidanceStatus, timestamp: number): GuidanceStatus {
    if (this.shown === undefined || status === this.shown) {
      this.shown = status;
      this.pending = undefined;
      return status;
    }
    if (this.pending?.status !== status) this.pending = { status, since: timestamp };
    if (timestamp - this.pending.since >= this.minDuration) {
      this.shown = status;
      this.pending = undefined;
    }
    return this.shown;
  }

  reset(): void {
    this.shown = undefined;
    this.pending = undefined;
  }
}

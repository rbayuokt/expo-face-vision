import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { useFaceCameraController } from '../camera/context';
import type { FaceCameraController } from '../camera/controller';
import { useFaceFrames } from '../hooks';
import type { Point } from '../types';

/** A face in preview coordinates (dp), interpolated on the UI thread. Arrays are flat x,y pairs. */
export interface AnimatedFace {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  landmarks: number[];
  contours: number[][];
  yaw: number;
  pitch: number;
  roll: number;
  /** ms since the face was last detected; > 0 while it lingers after being lost. */
  unseenFor: number;
  mirrored: boolean;
}

export interface AnimatedFacesOptions {
  camera?: FaceCameraController | null;
  /** Default true. */
  landmarks?: boolean;
  /** Default true. */
  contours?: boolean;
  /**
   * Time constant of the UI-thread interpolation, ms. Higher glides more smoothly between
   * detections but trails further behind the face. Default 70 (about one frame at 15 fps).
   */
  interpolation?: number;
  /** ms a face stays drawn after it stops being detected, bridging single missed frames. Default 150. */
  linger?: number;
}

/**
 * native frame -> JS (tracking, preview transform) -> shared value -> UI thread interpolation.
 *
 * Detection arrives at inference rate over the JS thread (one hop per analyzed frame, not per
 * display frame); a frame callback eases toward the latest target every display frame, so
 * overlays move at 60 fps without any React render.
 */
export function useAnimatedFaces(options: AnimatedFacesOptions = {}): SharedValue<AnimatedFace[]> {
  const camera = useFaceCameraController(options.camera);
  const targets = useSharedValue<AnimatedFace[]>([]);
  const current = useSharedValue<AnimatedFace[]>([]);
  const tau = options.interpolation ?? 70;
  const linger = options.linger ?? 150;
  const withLandmarks = options.landmarks ?? true;
  const withContours = options.contours ?? true;

  useFaceFrames((frame) => {
    const t = camera?.transform ?? null;
    const next: AnimatedFace[] = [];
    frame.faces.forEach((f, i) => {
      if (!f.previewBounds || !t) return;
      const flat = (points: Point[]) => {
        const out: number[] = [];
        for (const p of points) {
          const q = t.point(p);
          out.push(q.x, q.y);
        }
        return out;
      };
      next.push({
        id: f.trackingId ?? -1 - i,
        x: f.previewBounds.x,
        y: f.previewBounds.y,
        width: f.previewBounds.width,
        height: f.previewBounds.height,
        landmarks: withLandmarks && f.landmarks ? flat(Object.values(f.landmarks)) : [],
        contours: withContours && f.contours ? Object.values(f.contours).map(flat) : [],
        yaw: f.headPose?.yaw ?? 0,
        pitch: f.headPose?.pitch ?? 0,
        roll: f.headPose?.roll ?? 0,
        unseenFor: 0,
        mirrored: frame.mirrored,
      });
    });
    targets.value = next;
  }, camera);

  useFrameCallback((info) => {
    'worklet';
    const goal = targets.value;
    const prev = current.value;
    if (goal.length === 0 && prev.length === 0) return;
    const dt = info.timeSincePreviousFrame ?? 16;
    const k = 1 - Math.exp(-dt / tau);
    const mix = (a: number, b: number) => a + (b - a) * k;
    const mixArray = (a: number[], b: number[]) => {
      if (a.length !== b.length) return b.slice();
      const out = new Array<number>(b.length);
      for (let i = 0; i < b.length; i++) out[i] = a[i]! + (b[i]! - a[i]!) * k;
      return out;
    };

    const next: AnimatedFace[] = [];
    for (const g of goal) {
      let p: AnimatedFace | undefined;
      for (const c of prev) if (c.id === g.id) p = c;
      if (!p) {
        next.push(g);
        continue;
      }
      next.push({
        ...g,
        x: mix(p.x, g.x),
        y: mix(p.y, g.y),
        width: mix(p.width, g.width),
        height: mix(p.height, g.height),
        landmarks: mixArray(p.landmarks, g.landmarks),
        contours:
          p.contours.length === g.contours.length
            ? g.contours.map((c, i) => mixArray(p!.contours[i]!, c))
            : g.contours,
        yaw: mix(p.yaw, g.yaw),
        pitch: mix(p.pitch, g.pitch),
        roll: mix(p.roll, g.roll),
      });
    }
    for (const c of prev) {
      let alive = false;
      for (const g of goal) if (g.id === c.id) alive = true;
      if (!alive && c.unseenFor + dt < linger) next.push({ ...c, unseenFor: c.unseenFor + dt });
    }
    current.value = next;
  });

  return current;
}

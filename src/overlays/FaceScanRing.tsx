import { Canvas, createPicture, Picture, Skia, StrokeCap } from '@shopify/react-native-skia';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

export interface FaceScanRingProps {
  /** Outer diameter, dp. */
  size: number;
  /** Covered flags from `useHeadCoverage`. Its length sets the tick count. */
  covered?: boolean[];
  /** Tick count when `covered` isn't given. Default 60. */
  segments?: number;
  /** A light wave travels around the ring, for an intro or waiting state. */
  idle?: boolean;
  /** Diameter of the centered content (camera, icon). Default 72% of `size`. */
  innerSize?: number;
  /** Default `#C7C7CC`. */
  color?: string;
  /** Default `#34C759`. */
  activeColor?: string;
  /** Tick color at the crest of the idle wave. Default `#8E8E93`. */
  highlightColor?: string;
  /** Default 3. */
  tickWidth?: number;
  style?: StyleProp<ViewStyle>;
  /** Rendered centered in the ring, not clipped. Size it to `innerSize`. */
  children?: ReactNode;
}

/**
 * The Face ID enrollment ring: radial ticks that grow and turn green as they're covered.
 * Each tick eases on the UI thread and the whole ring is one Skia picture per frame, so it
 * stays smooth whatever the detection rate. It pulses once when every tick is covered.
 */
export function FaceScanRing({
  size,
  covered,
  segments = covered?.length ?? 60,
  idle = false,
  innerSize = size * 0.72,
  color = '#C7C7CC',
  activeColor = '#34C759',
  highlightColor = '#8E8E93',
  tickWidth = 3,
  style,
  children,
}: FaceScanRingProps) {
  const targets = useSharedValue<number[]>(new Array(segments).fill(0));
  const levels = useSharedValue<number[]>(new Array(segments).fill(0));
  const phase = useSharedValue(0);
  const pulse = useSharedValue(0);
  const idleOn = useSharedValue(idle ? 1 : 0);

  const complete = !!covered && covered.length > 0 && covered.every(Boolean);
  const key = covered?.map((c) => (c ? 1 : 0)).join('') ?? '';
  useEffect(() => {
    targets.value = Array.from({ length: segments }, (_, i) => (covered?.[i] ? 1 : 0));
  }, [key, segments, targets]);

  useEffect(() => {
    idleOn.value = withTiming(idle ? 1 : 0, { duration: 400 });
  }, [idle, idleOn]);

  useEffect(() => {
    if (complete)
      pulse.value = withSequence(
        withTiming(1, { duration: 180 }),
        withTiming(0, { duration: 420 })
      );
  }, [complete, pulse]);

  useFrameCallback((info) => {
    'worklet';
    const dt = info.timeSincePreviousFrame ?? 16;
    if (idleOn.value > 0) phase.value = (phase.value + dt / 1600) % 1;
    const goal = targets.value;
    const cur = levels.value;
    // ~150 ms ease per tick; skip the write once everything has settled.
    const k = 1 - Math.exp(-dt / 150);
    let moving = false;
    const next = new Array<number>(goal.length);
    for (let i = 0; i < goal.length; i++) {
      const c = cur[i] ?? 0;
      const d = goal[i]! - c;
      if (Math.abs(d) > 0.002) moving = true;
      next[i] = Math.abs(d) > 0.002 ? c + d * k : goal[i]!;
    }
    if (moving || cur.length !== goal.length) levels.value = next;
  });

  // Skia colors are [r, g, b, a] in 0..1; mixing them per tick happens on the UI thread.
  const base = Array.from(Skia.Color(color));
  const active = Array.from(Skia.Color(activeColor));
  const highlight = Array.from(Skia.Color(highlightColor));

  const picture = useDerivedValue(() =>
    createPicture(
      (canvas) => {
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        paint.setStrokeWidth(tickWidth);
        paint.setStrokeCap(StrokeCap.Round);

        const c = size / 2;
        const inner = innerSize / 2 + tickWidth * 3;
        const outer = c - tickWidth;
        // Covered ticks grow 60% and the completion pulse another 12%; leave room for both.
        const baseLength = (outer - inner) / (1.6 * 1.12);
        const lv = levels.value;
        const wave = idleOn.value;
        const grow = 1 + pulse.value * 0.12;

        for (let i = 0; i < lv.length; i++) {
          const angle = (i / lv.length) * Math.PI * 2;
          const a = lv[i]!;
          // A narrow crest travelling clockwise.
          const offset = ((i / lv.length - phase.value + 1) % 1) * Math.PI * 2;
          const crest = wave * Math.pow(Math.max(0, Math.cos(offset)), 16);

          const rgba = [0, 1, 2, 3].map((j) => {
            const mixed = base[j]! + (active[j]! - base[j]!) * a;
            return mixed + (highlight[j]! - mixed) * crest * (1 - a);
          });
          paint.setColor(Float32Array.from(rgba));

          const length = baseLength * (1 + 0.6 * a + 0.25 * crest) * grow;
          const sin = Math.sin(angle);
          const cos = Math.cos(angle);
          canvas.drawLine(
            c + sin * inner,
            c - cos * inner,
            c + sin * (inner + length),
            c - cos * (inner + length),
            paint
          );
        }
      },
      { width: size, height: size }
    )
  );

  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={[
          styles.center,
          {
            width: innerSize,
            height: innerSize,
            left: (size - innerSize) / 2,
            top: (size - innerSize) / 2,
          },
        ]}>
        {children}
      </View>
      {/* Drawn last: center content (e.g. a camera masked to a circle with an opaque square)
          must never cover the ticks. */}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});

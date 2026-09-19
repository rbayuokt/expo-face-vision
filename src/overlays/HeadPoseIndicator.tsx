import { Canvas, Circle, Line, vec } from '@shopify/react-native-skia';
import type { StyleProp, ViewStyle } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

import { useAnimatedFaces, type AnimatedFacesOptions } from './useAnimatedFaces';

export interface HeadPoseIndicatorProps extends Pick<
  AnimatedFacesOptions,
  'camera' | 'interpolation'
> {
  /** Diameter, dp. Default 72. */
  size?: number;
  /** Degrees mapped to the rim. Default 40. */
  range?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A dot that follows where the largest face points, as the user sees it: on a mirrored selfie
 * preview turning to your right moves the dot right.
 */
export function HeadPoseIndicator({
  size = 72,
  range = 40,
  color = '#35E0A1',
  camera,
  interpolation,
  style,
}: HeadPoseIndicatorProps) {
  const faces = useAnimatedFaces({ camera, interpolation, landmarks: false, contours: false });
  const r = size / 2;

  const dot = useDerivedValue(() => {
    let best = null;
    for (const f of faces.value) if (!best || f.width > best.width) best = f;
    if (!best) return vec(r, r);
    // Subject's right is screen right only when mirrored.
    const sx = best.mirrored ? 1 : -1;
    const clampUnit = (v: number) => Math.max(-1, Math.min(1, v));
    return vec(
      r + sx * clampUnit(best.yaw / range) * (r - 6),
      r - clampUnit(best.pitch / range) * (r - 6)
    );
  });

  return (
    <Canvas style={[{ width: size, height: size }, style]} pointerEvents="none">
      <Circle
        cx={r}
        cy={r}
        r={r - 1}
        style="stroke"
        strokeWidth={1.5}
        color={color}
        opacity={0.5}
      />
      <Line p1={vec(r, 4)} p2={vec(r, size - 4)} color={color} opacity={0.25} strokeWidth={1} />
      <Line p1={vec(4, r)} p2={vec(size - 4, r)} color={color} opacity={0.25} strokeWidth={1} />
      <Circle c={dot} r={5} color={color} />
    </Canvas>
  );
}

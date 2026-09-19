import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { StyleSheet } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

import { useAnimatedFaces, type AnimatedFacesOptions } from './useAnimatedFaces';

export interface FaceOverlayProps extends AnimatedFacesOptions {
  /** Default true. */
  boxes?: boolean;
  /** Draw landmark points. Default false. */
  landmarks?: boolean;
  /** Draw contour lines. Default false. */
  contours?: boolean;
  /** Default `#35E0A1`. */
  color?: string;
  /** Default 2. */
  strokeWidth?: number;
  /** Default 12. */
  cornerRadius?: number;
  /** Default 2.5. */
  pointRadius?: number;
}

/**
 * Boxes, landmarks and contours in one Skia canvas. Geometry is rebuilt on the UI thread each
 * display frame from interpolated shared values; React renders this once.
 */
export function FaceOverlay(props: FaceOverlayProps) {
  const {
    boxes = true,
    landmarks = false,
    contours = false,
    color = '#35E0A1',
    strokeWidth = 2,
    cornerRadius = 12,
    pointRadius = 2.5,
  } = props;
  const faces = useAnimatedFaces({ ...props, landmarks, contours });

  const boxPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    if (!boxes) return path;
    for (const f of faces.value) {
      path.addRRect(
        Skia.RRectXY(Skia.XYWHRect(f.x, f.y, f.width, f.height), cornerRadius, cornerRadius)
      );
    }
    return path;
  });

  const pointPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    for (const f of faces.value) {
      for (let i = 0; i + 1 < f.landmarks.length; i += 2)
        path.addCircle(f.landmarks[i]!, f.landmarks[i + 1]!, pointRadius);
    }
    return path;
  });

  const contourPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    for (const f of faces.value) {
      for (const c of f.contours) {
        if (c.length < 4) continue;
        path.moveTo(c[0]!, c[1]!);
        for (let i = 2; i + 1 < c.length; i += 2) path.lineTo(c[i]!, c[i + 1]!);
      }
    }
    return path;
  });

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path path={boxPath} style="stroke" strokeWidth={strokeWidth} color={color} />
      {contours ? (
        <Path path={contourPath} style="stroke" strokeWidth={1} color={color} opacity={0.8} />
      ) : null}
      {landmarks ? <Path path={pointPath} color={color} /> : null}
    </Canvas>
  );
}

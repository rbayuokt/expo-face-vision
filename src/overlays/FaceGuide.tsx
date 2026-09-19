import { Canvas, FillType, Path, Skia } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  interpolateColor,
  isSharedValue,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { GuideShape } from '../camera/controller';
import type { GuidanceStatus } from '../core/guidance';

export interface FaceGuideProps {
  /** Same shape you pass as `requirements.guide`, so the drawn oval is the one validated. */
  shape?: GuideShape;
  /** READY turns the guide `readyColor`. Ignored when `ready` is set. */
  status?: GuidanceStatus | null;
  ready?: boolean;
  /** 0..1 ring along the oval, e.g. stability or countdown progress. */
  progress?: number | SharedValue<number>;
  /** Default white. */
  color?: string;
  /** Default `#35E0A1`. */
  readyColor?: string;
  /** Color of the progress arc. Defaults to following the guide color (and `readyColor`). */
  progressColor?: string;
  /** Tint outside the oval. Default `rgba(0,0,0,0.55)`; `transparent` to disable. */
  dimColor?: string;
  /** Default 4. */
  strokeWidth?: number;
}

export function FaceGuide(props: FaceGuideProps) {
  const {
    shape = {},
    color = '#FFFFFF',
    readyColor = '#35E0A1',
    progressColor,
    dimColor = 'rgba(0,0,0,0.55)',
    strokeWidth = 4,
  } = props;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ready = props.ready ?? props.status === 'READY';

  const readiness = useSharedValue(ready ? 1 : 0);
  useEffect(() => {
    readiness.value = withTiming(ready ? 1 : 0, { duration: 220 });
  }, [ready, readiness]);

  const ownProgress = useSharedValue(typeof props.progress === 'number' ? props.progress : 0);
  const external = isSharedValue<number>(props.progress) ? props.progress : null;
  useEffect(() => {
    if (typeof props.progress === 'number')
      ownProgress.value = withTiming(props.progress, { duration: 150 });
  }, [props.progress, ownProgress]);

  const w = (shape.width ?? 0.72) * size.width;
  const h = (shape.height ?? 0.48) * size.height;
  const oval = Skia.XYWHRect(
    (size.width - w) / 2,
    size.height * (shape.centerY ?? 0.45) - h / 2,
    w,
    h
  );
  // Index 0 starts the oval at 12 o'clock so progress fills clockwise from the top.
  const ovalPath = Skia.Path.Make().addOval(oval, false, 0);
  const dimPath = Skia.Path.Make();
  dimPath.addRect(Skia.XYWHRect(0, 0, size.width, size.height));
  dimPath.addOval(oval);
  dimPath.setFillType(FillType.EvenOdd);

  const strokeColor = useDerivedValue(() =>
    interpolateColor(readiness.value, [0, 1], [color, readyColor])
  );
  const end = useDerivedValue(() => (external ? external.value : ownProgress.value));

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) =>
        setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
      }>
      {size.width > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Path path={dimPath} color={dimColor} />
          <Path
            path={ovalPath}
            style="stroke"
            strokeWidth={strokeWidth}
            color={strokeColor}
            opacity={0.5}
          />
          <Path
            path={ovalPath}
            style="stroke"
            strokeWidth={strokeWidth}
            strokeCap="round"
            color={progressColor ?? strokeColor}
            start={0}
            end={end}
          />
        </Canvas>
      ) : null}
    </View>
  );
}

import { Canvas, FillType, Path, Skia } from '@shopify/react-native-skia';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

type Props = { radius: number; color: string };

// Reach past the edges: iOS can round a fractional-width canvas down and leave a hairline.
const BLEED = 2;

/**
 * Paints the corners outside a rounded rect in `color`. Rounds a camera preview reliably,
 * where clipping a native camera view with borderRadius doesn't work on every Android device.
 */
export function CornerMask({ radius, color }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const path = Skia.Path.Make();
  path.addRect(Skia.XYWHRect(0, 0, size.width + BLEED * 2, size.height + BLEED * 2));
  path.addRRect(Skia.RRectXY(Skia.XYWHRect(BLEED, BLEED, size.width, size.height), radius, radius));
  path.setFillType(FillType.EvenOdd);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) =>
        setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
      }>
      {size.width > 0 ? (
        <Canvas
          style={{
            position: 'absolute',
            left: -BLEED,
            top: -BLEED,
            width: size.width + BLEED * 2,
            height: size.height + BLEED * 2,
          }}>
          <Path path={path} color={color} />
        </Canvas>
      ) : null}
    </View>
  );
}

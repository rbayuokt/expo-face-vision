import { Canvas, FillType, Path, Skia } from '@shopify/react-native-skia';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

type Props = { radius: number; color: string };

/**
 * Paints the corners outside a rounded rect in `color`. Rounds a camera preview reliably,
 * where clipping a native camera view with borderRadius doesn't work on every Android device.
 */
export function CornerMask({ radius, color }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const path = Skia.Path.Make();
  path.addRect(Skia.XYWHRect(0, 0, size.width, size.height));
  path.addRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, size.width, size.height), radius, radius));
  path.setFillType(FillType.EvenOdd);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) =>
        setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
      }>
      {size.width > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Path path={path} color={color} />
        </Canvas>
      ) : null}
    </View>
  );
}

import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius } from '../theme';

/** Box as fractions of the image (0..1). */
export type NormalizedBox = { x: number; y: number; width: number; height: number };

type Props = {
  uri: string;
  aspectRatio: number;
  boxes: NormalizedBox[];
  selected: number;
  onSelect: (index: number) => void;
};

/** The photo with tappable, numbered face boxes. */
export function PhotoPreview({ uri, aspectRatio, boxes, selected, onSelect }: Props) {
  const [width, setWidth] = useState(0);
  const height = width / aspectRatio;

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Image source={{ uri }} style={{ width, height, borderRadius: radius.xl }} />
      {boxes.map((b, i) => {
        const active = i === selected;
        return (
          <Pressable
            key={i}
            onPress={() => onSelect(i)}
            hitSlop={8}
            style={[
              styles.box,
              active && styles.active,
              {
                left: b.x * width,
                top: b.y * height,
                width: b.width * width,
                height: b.height * height,
              },
            ]}>
            <View style={[styles.badge, active && styles.badgeActive]}>
              <Text style={styles.badgeText}>{i + 1}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', borderRadius: radius.xl },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: 10,
  },
  active: { borderColor: color.faceBox, borderWidth: 3 },
  badge: {
    position: 'absolute',
    top: -11,
    left: -11,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeActive: { backgroundColor: color.faceBox },
  badgeText: { fontWeight: '700', fontSize: 12, color: '#000000' },
});

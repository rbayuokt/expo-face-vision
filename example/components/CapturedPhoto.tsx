import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, radius } from '../theme';
import { Button } from './Button';

type Props = {
  uri: string;
  width: number;
  height: number;
  onRetake: () => void;
  onDone: () => void;
};

export function CapturedPhoto({ uri, width, height, onRetake, onDone }: Props) {
  const insets = useSafeAreaInsets();
  // An Image needs a real width and height, so fit the photo into the space we measured.
  const [box, setBox] = useState({ width: 0, height: 0 });
  const scale = Math.min(box.width / width, box.height / height) || 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <Text style={styles.title}>Looking good</Text>
      <Text style={styles.subtitle}>
        {width} × {height} · saved un-mirrored, the way others see you
      </Text>
      <View
        style={styles.frame}
        onLayout={(e) =>
          setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }>
        {scale > 0 ? (
          <Animated.View entering={ZoomIn.duration(280)}>
            <Image
              source={{ uri }}
              style={[styles.photo, { width: width * scale, height: height * scale }]}
            />
          </Animated.View>
        ) : null}
      </View>
      <View style={styles.actions}>
        <View style={styles.flex}>
          <Button label="Retake" variant="tinted" onPress={onRetake} />
        </View>
        <View style={styles.flex}>
          <Button label="Done" onPress={onDone} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg, paddingHorizontal: 20, gap: 8 },
  title: { color: color.label, fontSize: 28, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: color.secondary, fontSize: 15, textAlign: 'center' },
  frame: { flex: 1, alignItems: 'center', justifyContent: 'center', marginVertical: 16 },
  photo: { borderRadius: radius.xl },
  actions: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
});

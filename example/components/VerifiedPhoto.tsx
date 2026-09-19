import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { color } from '../theme';

type Props = { uri: string; size: number };

/** The captured selfie in a circle with a green check badge. */
export function VerifiedPhoto({ uri, size }: Props) {
  const badge = size * 0.28;
  return (
    <Animated.View entering={ZoomIn.springify()} style={{ width: size, height: size }}>
      <Image
        source={{ uri }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 4,
          borderColor: color.green,
        }}
      />
      <View style={[styles.badge, { width: badge, height: badge, borderRadius: badge / 2 }]}>
        <Ionicons name="checkmark" size={badge * 0.6} color="#FFFFFF" />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: color.green,
    borderWidth: 4,
    borderColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

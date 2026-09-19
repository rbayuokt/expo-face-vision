import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import type { IconName } from './Screen';

type Props = { icon: IconName; size: number; color: string; filled?: boolean };

/**
 * A large icon for the middle of a ring. `filled` puts it white on a solid circle (success),
 * otherwise it's an outlined glyph (intro).
 */
export function CenterIcon({ icon, size, color, filled = false }: Props) {
  if (!filled) return <Ionicons name={icon} size={size * 0.62} color={color} />;
  return (
    <Animated.View
      entering={ZoomIn.springify()}
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
      ]}>
      <Ionicons name={icon} size={size * 0.5} color="#FFFFFF" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
});

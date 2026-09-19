import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';

import { color } from '../theme';
import type { IconName } from './Screen';

export type CueDirection = 'left' | 'right' | 'up' | 'down' | null;

type Props = { icon: IconName; direction?: CueDirection };

const OFFSET: Record<Exclude<CueDirection, null>, { x: number; y: number }> = {
  left: { x: -10, y: 0 },
  right: { x: 10, y: 0 },
  up: { x: 0, y: -10 },
  down: { x: 0, y: 10 },
};

/** Big icon for the current instruction; nudges toward `direction` so the move is obvious. */
export function PromptCue({ icon, direction = null }: Props) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = 0;
    if (direction) {
      t.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 450, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 450, easing: Easing.in(Easing.quad) })
        ),
        -1
      );
    }
    return () => cancelAnimation(t);
  }, [direction, t]);

  const nudge = useAnimatedStyle(() => {
    const o = direction ? OFFSET[direction] : { x: 0, y: 0 };
    return { transform: [{ translateX: o.x * t.value }, { translateY: o.y * t.value }] };
  });

  return (
    <Animated.View key={icon} entering={ZoomIn.springify()} style={styles.circle}>
      <Animated.View style={nudge}>
        <Ionicons name={icon} size={30} color={color.blue} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

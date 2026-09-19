import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { color } from '../theme';

type Props = { title: string; hint: string; ready?: boolean };

/** Large instruction with a quieter hint underneath. The title fades in when it changes. */
export function Instruction({ title, hint, ready = false }: Props) {
  return (
    <View style={styles.root}>
      {/* In normal layout at full width: absolute positioning let some Android devices measure
          the bold title too narrow and wrap or cut it. */}
      <Animated.Text
        key={title}
        entering={FadeIn.duration(200)}
        style={[styles.title, ready && styles.ready]}>
        {title}
      </Animated.Text>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'stretch', alignItems: 'center', gap: 6, paddingHorizontal: 24 },
  title: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: color.label,
    fontSize: 26,
    fontWeight: '700',
  },
  ready: { color: color.green },
  hint: { color: color.secondary, fontSize: 15, textAlign: 'center' },
});

import { StyleSheet, Text } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { color } from '../theme';

type Props = { title: string; body?: string };

/** Multi-line title with an optional paragraph, for step screens. Fades in when the title changes. */
export function Headline({ title, body }: Props) {
  return (
    <Animated.View key={title} entering={FadeIn.duration(220)} style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 10, paddingHorizontal: 32, minHeight: 110 },
  title: { color: color.label, fontSize: 26, fontWeight: '700', textAlign: 'center' },
  body: { color: color.secondary, fontSize: 17, lineHeight: 24, textAlign: 'center' },
});

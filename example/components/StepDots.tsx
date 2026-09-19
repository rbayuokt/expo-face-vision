import { StyleSheet, View } from 'react-native';

import { color } from '../theme';

type Props = { total: number; done: number };

/** One pill per step: green when done, white for the current one, gray after. */
export function StepDots({ total, done }: Props) {
  return (
    <View style={styles.row}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.dot, i < done && styles.done, i === done && styles.current]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.tertiary },
  done: { backgroundColor: color.green },
  current: { width: 22, backgroundColor: color.label },
});

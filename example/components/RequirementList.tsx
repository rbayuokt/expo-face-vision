import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { color, radius } from '../theme';

/** `detail` shows on the right once passed, e.g. a confidence. */
export type Requirement = { label: string; passed: boolean; detail?: string };

/** White grouped card of pass/fail rows, matching the home screen lists. */
export function RequirementList({ items }: { items: Requirement[] }) {
  return (
    <View style={styles.card}>
      {items.map((item, i) => (
        <View key={item.label} style={[styles.row, i > 0 && styles.separator]}>
          {item.passed ? (
            <Animated.View key="on" entering={ZoomIn.springify()}>
              <Ionicons name="checkmark-circle" size={22} color={color.green} />
            </Animated.View>
          ) : (
            <Ionicons name="ellipse-outline" size={22} color={color.tertiary} />
          )}
          <Text style={[styles.label, !item.passed && styles.pending]}>{item.label}</Text>
          {item.passed && item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.card, borderRadius: radius.lg, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.separator },
  label: { flex: 1, color: color.label, fontSize: 17 },
  pending: { color: color.secondary },
  detail: { color: color.secondary, fontSize: 15 },
});

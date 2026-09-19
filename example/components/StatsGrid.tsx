import { StyleSheet, Text, View } from 'react-native';

import { color, font, radius } from '../theme';

export type Stat = { label: string; value: string };

/** Two-column tiles in a white card, for live numbers. */
export function StatsGrid({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.card}>
      {stats.map((s) => (
        <View key={s.label} style={styles.tile}>
          <Text style={styles.label}>{s.label}</Text>
          <Text style={styles.value} numberOfLines={1}>
            {s.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.card,
    borderRadius: radius.lg,
    padding: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tile: { width: '50%', paddingVertical: 8, paddingHorizontal: 8, gap: 2 },
  label: { color: color.secondary, fontSize: 12, textTransform: 'uppercase' },
  value: { color: color.label, fontSize: 17, fontWeight: '600', fontFamily: font.mono },
});

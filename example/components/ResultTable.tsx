import { StyleSheet, Text, View } from 'react-native';

import { color, font, radius } from '../theme';

type Props = { columns: string[]; rows: string[][] };

/** Compact results table in a card. The first column is left aligned, the rest right. */
export function ResultTable({ columns, rows }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {columns.map((c, i) => (
          <Text key={c} style={[styles.head, i === 0 ? styles.first : styles.cell]}>
            {c}
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={[styles.row, styles.separator]}>
          {row.map((value, i) => (
            <Text key={i} style={[styles.value, i === 0 ? styles.first : styles.cell]}>
              {value}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.card, borderRadius: radius.lg, paddingHorizontal: 16 },
  row: { flexDirection: 'row', paddingVertical: 10, gap: 8 },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.separator },
  head: { color: color.secondary, fontSize: 12, textTransform: 'uppercase' },
  value: { color: color.label, fontSize: 15, fontFamily: font.mono },
  first: { flex: 2 },
  cell: { flex: 1, textAlign: 'right' },
});

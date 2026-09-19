import { Image, StyleSheet, Text, View } from 'react-native';

import { color, radius } from '../theme';
import type { Stat } from './StatsGrid';

type Props = {
  title: string;
  cropUri?: string;
  alignedUri?: string;
  /** 0..1 */
  score: number;
  details: Stat[];
};

/** Crops side by side, a quality score, then grouped rows of values. */
export function FaceDetails({ title, cropUri, alignedUri, score, details }: Props) {
  const percent = Math.round(score * 100);
  const scoreColor = percent >= 75 ? color.green : percent >= 50 ? color.orange : color.pink;

  return (
    <View style={styles.section}>
      <Text style={styles.header}>{title}</Text>
      <View style={styles.card}>
        <View style={styles.thumbs}>
          <Thumb uri={cropUri} caption="Crop" />
          <Thumb uri={alignedUri} caption={alignedUri ? 'Aligned' : 'No eyes found'} />
        </View>
        <View style={styles.scoreRow}>
          <Text style={styles.rowLabel}>Quality</Text>
          <View style={styles.meter}>
            <View
              style={[styles.meterFill, { width: `${percent}%`, backgroundColor: scoreColor }]}
            />
          </View>
          <Text style={[styles.rowValue, { color: scoreColor }]}>{percent}</Text>
        </View>
        {details.map((d) => (
          <View key={d.label} style={styles.row}>
            <Text style={styles.rowLabel}>{d.label}</Text>
            <Text style={styles.rowValue}>{d.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Thumb({ uri, caption }: { uri?: string; caption: string }) {
  return (
    <View style={styles.thumbWrap}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.empty]} />
      )}
      <Text style={styles.caption}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  header: { color: color.secondary, fontSize: 13, textTransform: 'uppercase', marginLeft: 16 },
  card: { backgroundColor: color.card, borderRadius: radius.lg, paddingHorizontal: 16 },
  thumbs: { flexDirection: 'row', gap: 12, paddingVertical: 16 },
  thumbWrap: { flex: 1, gap: 6 },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: radius.md },
  empty: { backgroundColor: color.fill },
  caption: { color: color.secondary, fontSize: 13, textAlign: 'center' },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.separator,
  },
  meter: { flex: 1, height: 6, borderRadius: 3, backgroundColor: color.fill, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.separator,
  },
  rowLabel: { color: color.label, fontSize: 17 },
  rowValue: { color: color.secondary, fontSize: 17 },
});

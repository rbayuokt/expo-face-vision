import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius } from '../theme';

type Props<T> = { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void };

/** iOS segmented control: gray track, white thumb on the selected option. */
export function Segmented<T extends string | number>({ options, value, onChange }: Props<T>) {
  return (
    <View style={styles.track}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && styles.thumb]}>
            <Text style={[styles.label, selected && styles.selectedLabel]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: color.fill,
    borderRadius: radius.sm + 1,
    padding: 2,
  },
  segment: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: radius.sm - 1 },
  thumb: { backgroundColor: color.fillSelected },
  label: { color: color.label, fontSize: 13, fontWeight: '500' },
  selectedLabel: { fontWeight: '600' },
});

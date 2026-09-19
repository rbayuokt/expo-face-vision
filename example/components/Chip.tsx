import { Pressable, StyleSheet, Text } from 'react-native';

import { color, radius } from '../theme';

type Props = { label: string; selected: boolean; onPress: () => void };

/** On/off capsule: white when off, blue when on. */
export function Chip({ label, selected, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: color.card,
  },
  selected: { backgroundColor: color.blue },
  pressed: { opacity: 0.6 },
  label: { color: color.label, fontSize: 15, fontWeight: '500' },
  selectedLabel: { color: '#FFFFFF' },
});

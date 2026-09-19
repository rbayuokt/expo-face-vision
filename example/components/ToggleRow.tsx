import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { color, radius } from '../theme';
import type { IconName } from './Screen';

type Props = { icon: IconName; label: string; value: boolean; onChange: (value: boolean) => void };

/** A single settings-style row with a switch. */
export function ToggleRow({ icon, label, value, onChange }: Props) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={22} color={color.blue} />
      <Text style={styles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: color.fill, true: color.green }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.card,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  label: { flex: 1, color: color.label, fontSize: 17 },
});

import { Ionicons } from '@expo/vector-icons';
import { Children, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius } from '../theme';
import type { IconName } from './Screen';

/** Inset grouped list, like iOS Settings. */
export function MenuGroup({
  header,
  footer,
  children,
}: {
  header?: string;
  footer?: string;
  children: ReactNode;
}) {
  const rows = Children.toArray(children);
  return (
    <View style={styles.group}>
      {header ? <Text style={styles.header}>{header}</Text> : null}
      <View style={styles.card}>
        {rows.map((row, i) => (
          <View key={i}>
            {row}
            {i < rows.length - 1 ? <View style={styles.separator} /> : null}
          </View>
        ))}
      </View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

type RowProps = {
  icon: IconName;
  tint: string;
  title: string;
  subtitle: string;
  onPress: () => void;
};

export function MenuRow({ icon, tint, title, subtitle, onPress }: RowProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.icon, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={20} color="#FFFFFF" />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={color.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  header: { color: color.secondary, fontSize: 13, textTransform: 'uppercase', marginLeft: 16 },
  footer: { color: color.secondary, fontSize: 13, lineHeight: 18, marginHorizontal: 16 },
  card: { backgroundColor: color.card, borderRadius: radius.lg, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  pressed: { backgroundColor: color.fill },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  title: { color: color.label, fontSize: 17 },
  subtitle: { color: color.secondary, fontSize: 13, lineHeight: 18 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: color.separator, marginLeft: 62 },
});

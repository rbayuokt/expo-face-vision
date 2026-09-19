import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { color } from '../theme';
import type { IconName } from './Screen';

type Props = { icon: IconName; title: string; body: string };

export function EmptyState({ icon, title, body }: Props) {
  return (
    <View style={styles.root}>
      <Ionicons name={icon} size={56} color={color.tertiary} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 8, paddingTop: 96, paddingHorizontal: 24 },
  title: { color: color.label, fontSize: 22, fontWeight: '700', marginTop: 8 },
  body: { color: color.secondary, fontSize: 17, lineHeight: 23, textAlign: 'center' },
});

import { StyleSheet, Text } from 'react-native';

import { color } from '../theme';

/** Small uppercase gray label above a group, as in iOS Settings. */
export function SectionHeader({ children }: { children: string }) {
  return <Text style={styles.header}>{children}</Text>;
}

const styles = StyleSheet.create({
  header: {
    color: color.secondary,
    fontSize: 13,
    textTransform: 'uppercase',
    marginLeft: 16,
    marginBottom: -4,
  },
});

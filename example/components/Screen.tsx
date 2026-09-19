import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  onBack: () => void;
  /** Label of the blue button that leaves the screen. Default "Cancel". */
  backLabel?: string;
  /** Small centered title. Flow screens leave it out and use a big headline instead. */
  title?: string;
  /** Optional control on the right of the nav bar, e.g. a `NavButton`. */
  headerRight?: ReactNode;
  /** Pinned to the bottom, above the home indicator. */
  footer?: ReactNode;
  children: ReactNode;
};

/** Black page with a Face ID style nav bar: a blue text button top left. */
export function Screen({
  onBack,
  backLabel = 'Cancel',
  title,
  headerRight,
  footer,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.nav}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => [styles.side, pressed && styles.pressed]}>
          <Text style={styles.backLabel}>{backLabel}</Text>
        </Pressable>
        <Text style={styles.navTitle} numberOfLines={1}>
          {title ?? ''}
        </Text>
        <View style={[styles.side, styles.right]}>{headerRight}</View>
      </View>
      <View style={styles.flex}>{children}</View>
      {footer ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>{footer}</View>
      ) : null}
    </View>
  );
}

/** Blue icon button for the nav bar. */
export function NavButton({ icon, onPress }: { icon: IconName; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
      <Ionicons name={icon} size={26} color={color.blue} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: color.bg },
  nav: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  side: { width: 90 },
  right: { alignItems: 'flex-end' },
  backLabel: { color: color.blue, fontSize: 17 },
  navTitle: { flex: 1, textAlign: 'center', color: color.label, fontSize: 17, fontWeight: '600' },
  pressed: { opacity: 0.4 },
  footer: { paddingHorizontal: 20, paddingTop: 12, gap: 4, backgroundColor: color.bg },
});

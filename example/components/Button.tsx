import { Pressable, StyleSheet, Text } from 'react-native';

import { color, radius } from '../theme';

type Props = {
  label: string;
  onPress: () => void;
  /**
   * `filled`: the one blue primary action ("Get Started").
   * `plain`: blue text link for secondary actions ("Accessibility Options").
   * `tinted`: gray button with blue text, when two buttons sit side by side.
   */
  variant?: 'filled' | 'plain' | 'tinted';
  disabled?: boolean;
};

export function Button({ label, onPress, variant = 'filled', disabled }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.base, styles[variant], (pressed || disabled) && styles.dim]}>
      <Text style={[styles.label, variant === 'filled' ? styles.filledLabel : styles.blueLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { height: 54, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  filled: { backgroundColor: color.blue },
  plain: {},
  tinted: { backgroundColor: color.fill },
  dim: { opacity: 0.4 },
  label: { fontSize: 17, fontWeight: '600' },
  filledLabel: { color: '#FFFFFF' },
  blueLabel: { color: color.blue, fontWeight: '400' },
});

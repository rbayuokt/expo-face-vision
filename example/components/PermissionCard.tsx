import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { color } from '../theme';
import { Button } from './Button';

type Props = { canAskAgain: boolean; onRequest: () => void; onOpenSettings: () => void };

export function PermissionCard({ canAskAgain, onRequest, onOpenSettings }: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <View style={styles.icon}>
          <Ionicons name="camera" size={36} color="#FFFFFF" />
        </View>
        <Text style={styles.title}>Allow camera access</Text>
        <Text style={styles.body}>
          Faces are analyzed on this device. No image or video ever leaves your phone.
        </Text>
      </View>
      {canAskAgain ? (
        <Button label="Continue" onPress={onRequest} />
      ) : (
        <Button label="Open Settings" onPress={onOpenSettings} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  icon: {
    width: 76,
    height: 76,
    borderRadius: 20,
    backgroundColor: color.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { color: color.label, fontSize: 28, fontWeight: '700', textAlign: 'center' },
  body: { color: color.secondary, fontSize: 17, lineHeight: 24, textAlign: 'center' },
});

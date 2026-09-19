import { useCameraPermissions } from '@rbayuokt/expo-face-vision';
import type { ReactNode } from 'react';
import { Linking, View } from 'react-native';

import { PermissionCard } from '../../components/PermissionCard';
import { Screen } from '../../components/Screen';
import { color } from '../../theme';

/** Renders `children` once camera permission is granted, otherwise asks for it. */
export function CameraGate({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission) return <View style={{ flex: 1, backgroundColor: color.bg }} />;
  if (permission.granted) return children;
  return (
    <Screen onBack={onBack}>
      <PermissionCard
        canAskAgain={permission.canAskAgain}
        onRequest={requestPermission}
        onOpenSettings={() => Linking.openSettings()}
      />
    </Screen>
  );
}

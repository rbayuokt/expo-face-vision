/**
 * Demo app entry: a menu and one screen per demo.
 *
 * screens/     one file per demo; each shows a slice of the expo-face-vision API
 * components/  plain React Native UI, no library imports
 */
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BenchmarkScreen } from './screens/BenchmarkScreen';
import { FaceScanScreen } from './screens/FaceScanScreen';
import { GesturesScreen } from './screens/GesturesScreen';
import { HomeScreen, type DemoId } from './screens/HomeScreen';
import { InspectorScreen } from './screens/InspectorScreen';
import { KycScreen } from './screens/KycScreen';
import { PhotoScreen } from './screens/PhotoScreen';
import { SelfieScreen } from './screens/SelfieScreen';
import { CameraGate } from './screens/shared/CameraGate';

export default function App() {
  const [demo, setDemo] = useState<DemoId | null>(null);
  const goHome = () => setDemo(null);

  // Android back button returns to the menu instead of closing the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!demo) return false;
      setDemo(null);
      return true;
    });
    return () => sub.remove();
  }, [demo]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {demo === null ? <HomeScreen onOpen={setDemo} /> : null}
      {demo === 'photo' ? <PhotoScreen onBack={goHome} /> : null}
      {demo && demo !== 'photo' ? (
        <CameraGate onBack={goHome}>
          {demo === 'kyc' ? <KycScreen onBack={goHome} /> : null}
          {demo === 'selfie' ? <SelfieScreen onBack={goHome} /> : null}
          {demo === 'scan' ? <FaceScanScreen onBack={goHome} /> : null}
          {demo === 'gestures' ? <GesturesScreen onBack={goHome} /> : null}
          {demo === 'inspector' ? <InspectorScreen onBack={goHome} /> : null}
          {demo === 'benchmark' ? <BenchmarkScreen onBack={goHome} /> : null}
        </CameraGate>
      ) : null}
    </SafeAreaProvider>
  );
}

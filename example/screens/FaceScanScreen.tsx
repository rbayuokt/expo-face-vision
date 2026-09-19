import { useFaceCamera, useFaceTracking, useHeadCoverage } from '@rbayuokt/expo-face-vision';
import { FaceScanRing } from '@rbayuokt/expo-face-vision/overlays';
import { useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button } from '../components/Button';
import { CenterIcon } from '../components/CenterIcon';
import { Headline } from '../components/Headline';
import { Screen } from '../components/Screen';
import { color } from '../theme';
import { RoundCamera } from './shared/RoundCamera';

type Step = 'intro' | 'scan' | 'done';

/** Face ID style enrollment: move the head in a circle until every tick is green. */
export function FaceScanScreen({ onBack }: { onBack: () => void }) {
  const camera = useFaceCamera();
  const [step, setStep] = useState<Step>('intro');
  const { width, height } = useWindowDimensions();
  const ringSize = Math.min(width - 48, height * 0.42);
  const innerSize = ringSize * 0.72;

  // Which directions the head has pointed in. Re-renders only when a new tick fills.
  const coverage = useHeadCoverage({
    camera,
    enabled: step === 'scan',
    // Plays a success haptic on completion by default.
    // Let the ring finish its completion pulse before switching screens.
    onComplete: () => setTimeout(() => setStep('done'), 700),
  });
  // Only used to know whether a face is in view; re-renders when one appears or leaves.
  const { trackingIds } = useFaceTracking({ camera });
  const faceInView = trackingIds.length > 0;

  const restart = () => {
    coverage.reset();
    setStep('scan');
  };

  let headline: { title: string; body?: string };
  if (step === 'intro') {
    headline = {
      title: 'How to Scan Your Face',
      body: 'First, position your face in the circle. Then move your head slowly in a circle to show all the angles of your face.',
    };
  } else if (step === 'done') {
    headline = { title: 'Scan complete', body: 'Every angle of your face was captured.' };
  } else if (!faceInView) {
    headline = { title: 'Position your face in the circle', body: 'Hold your phone at eye level.' };
  } else {
    headline = {
      title: 'Move your head slowly to complete the circle',
      body: `${Math.round(coverage.progress * 100)}%`,
    };
  }

  let footer: ReactNode;
  if (step === 'intro') {
    footer = <Button label="Get Started" onPress={() => setStep('scan')} />;
  } else if (step === 'scan') {
    footer = <Button label="Start Over" variant="plain" onPress={coverage.reset} />;
  } else {
    footer = (
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button label="Scan Again" variant="tinted" onPress={restart} />
        </View>
        <View style={styles.flex}>
          <Button label="Done" onPress={onBack} />
        </View>
      </View>
    );
  }

  return (
    <Screen onBack={onBack} footer={footer}>
      <View style={styles.centered}>
        <FaceScanRing
          size={ringSize}
          innerSize={innerSize}
          covered={step === 'intro' ? undefined : coverage.covered}
          idle={step === 'intro'}
          color={color.tick}
          activeColor={color.green}
          highlightColor="#FFFFFF">
          {step === 'intro' ? (
            <CenterIcon icon="happy-outline" size={innerSize} color={color.tick} />
          ) : null}
          {step === 'scan' ? (
            <RoundCamera camera={camera} diameter={innerSize} ring={false} />
          ) : null}
          {step === 'done' ? (
            <CenterIcon icon="checkmark" size={innerSize * 0.6} color={color.green} filled />
          ) : null}
        </FaceScanRing>
        <Headline title={headline.title} body={headline.body} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 8 },
  row: { flexDirection: 'row', gap: 12, alignSelf: 'stretch' },
});

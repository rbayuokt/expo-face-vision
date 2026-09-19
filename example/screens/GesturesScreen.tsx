import {
  getCapabilities,
  useBlinkDetection,
  useFaceCamera,
  useHeadGesture,
  type FaceDetectionOptions,
  type HeadGesture,
} from '@rbayuokt/expo-face-vision';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import { Button } from '../components/Button';
import { Instruction } from '../components/Instruction';
import { RequirementList } from '../components/RequirementList';
import { Screen } from '../components/Screen';
import { RoundCamera } from './shared/RoundCamera';

type Challenge = HeadGesture | 'blink';

const CHALLENGES: { id: Challenge; label: string }[] = [
  { id: 'nod', label: 'Nod yes' },
  { id: 'shake', label: 'Shake your head' },
  { id: 'turn-left', label: 'Turn your head left' },
  { id: 'turn-right', label: 'Turn your head right' },
  { id: 'blink', label: 'Blink' },
];

/** Tick off each head gesture and a blink, in any order. */
export function GesturesScreen({ onBack }: { onBack: () => void }) {
  const camera = useFaceCamera();
  // Completed challenges, with the detail shown next to each (confidence or duration).
  const [done, setDone] = useState<Partial<Record<Challenge, string>>>({});

  const complete = (id: Challenge, detail: string) =>
    setDone((d) => (d[id] ? d : { ...d, [id]: detail }));

  useHeadGesture({
    camera,
    gestures: ['nod', 'shake', 'turn-left', 'turn-right'],
    haptics: true,
    onGesture: (e) => complete(e.type, `${Math.round(e.confidence * 100)}%`),
  });
  useBlinkDetection({
    camera,
    haptics: true,
    onBlink: (e) => complete('blink', `${Math.round(e.duration)} ms`),
  });

  const count = Object.keys(done).length;
  const allDone = count === CHALLENGES.length;
  const next = CHALLENGES.find((c) => !done[c.id]);

  // The ring shows overall progress through the list.
  const ring = useSharedValue(0);
  useEffect(() => {
    ring.value = withTiming(count / CHALLENGES.length, { duration: 300 });
  }, [count, ring]);

  // Blinks need eye signals: probabilities on Android, eye contours on iOS.
  const eyeSignals: FaceDetectionOptions = getCapabilities().eyeOpenProbability
    ? { classification: true }
    : { contours: true };

  return (
    <Screen
      onBack={onBack}
      footer={
        <Button
          label="Start Over"
          variant="plain"
          onPress={() => setDone({})}
          disabled={count === 0}
        />
      }>
      <View style={styles.centered}>
        <RoundCamera
          camera={camera}
          // Blinks are short; more analyzed frames catch more of them.
          inferenceFps={24}
          detection={{ performanceMode: 'fast', ...eyeSignals }}
          ready={allDone}
          progress={ring}
        />
        <Instruction
          title={allDone ? 'All done!' : (next?.label ?? '')}
          hint={
            allDone
              ? 'Every gesture was recognized'
              : `${count} of ${CHALLENGES.length} done · any order`
          }
          ready={allDone}
        />
        <View style={styles.list}>
          <RequirementList
            items={CHALLENGES.map((c) => ({
              label: c.label,
              passed: !!done[c.id],
              detail: done[c.id],
            }))}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 8 },
  list: { alignSelf: 'stretch', paddingHorizontal: 16 },
});

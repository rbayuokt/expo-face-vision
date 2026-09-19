import {
  getCapabilities,
  useFaceCamera,
  useLivenessChallenge,
  type FaceDetectionOptions,
  type LivenessFailure,
  type LivenessPrompt,
  type LivenessStep,
  type ProcessedImage,
} from '@rbayuokt/expo-face-vision';
import { FaceScanRing } from '@rbayuokt/expo-face-vision/overlays';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import { Button } from '../components/Button';
import { CenterIcon } from '../components/CenterIcon';
import { Headline } from '../components/Headline';
import { Instruction } from '../components/Instruction';
import { PromptCue, type CueDirection } from '../components/PromptCue';
import { RequirementList } from '../components/RequirementList';
import { NavButton, Screen, type IconName } from '../components/Screen';
import { StepDots } from '../components/StepDots';
import { ToggleRow } from '../components/ToggleRow';
import { VerifiedPhoto } from '../components/VerifiedPhoto';
import { color } from '../theme';
import { RoundCamera } from './shared/RoundCamera';

/** Shuffled every session by the library, so a recording can't anticipate the order. */
const STEPS: LivenessStep[] = ['turn-left', 'turn-right', 'look-up', 'look-down', 'blink'];

const STEP_LABEL: Record<LivenessStep, string> = {
  'turn-left': 'Turned left',
  'turn-right': 'Turned right',
  'look-up': 'Looked up',
  'look-down': 'Looked down',
  'tilt-left': 'Tilted left',
  'tilt-right': 'Tilted right',
  blink: 'Blinked',
  smile: 'Smiled',
  nod: 'Nodded',
  shake: 'Shook head',
};

/** Icon and nudge direction per prompt. Left/right are as seen in the mirrored selfie preview. */
const CUE: Partial<Record<LivenessPrompt, { icon: IconName; direction?: CueDirection }>> = {
  TURN_LEFT: { icon: 'arrow-back', direction: 'left' },
  TURN_RIGHT: { icon: 'arrow-forward', direction: 'right' },
  LOOK_UP: { icon: 'arrow-up', direction: 'up' },
  LOOK_DOWN: { icon: 'arrow-down', direction: 'down' },
  TILT_LEFT: { icon: 'return-up-back', direction: 'left' },
  TILT_RIGHT: { icon: 'return-up-forward', direction: 'right' },
  BLINK: { icon: 'eye-outline' },
  SMILE: { icon: 'happy-outline' },
  NOD: { icon: 'swap-vertical', direction: 'down' },
  SHAKE: { icon: 'swap-horizontal', direction: 'right' },
};

const FAILURE_TEXT: Record<LivenessFailure, { title: string; body: string }> = {
  TIMEOUT: {
    title: 'That took too long',
    body: 'Each move has a few seconds. Try again at a steady pace.',
  },
  FACE_LOST: {
    title: 'We lost your face',
    body: 'Keep your whole face in the circle the entire time.',
  },
  MULTIPLE_FACES: {
    title: 'More than one face',
    body: 'Make sure you are the only person in view.',
  },
  FACE_CHANGED: { title: 'Face changed', body: 'The same person must complete every step.' },
};

type Step = 'intro' | 'check' | 'result';

/** KYC-style liveness check: random head moves, spoken prompts, a selfie on success. */
export function KycScreen({ onBack }: { onBack: () => void }) {
  const camera = useFaceCamera();
  const [step, setStep] = useState<Step>('intro');
  const [voice, setVoice] = useState(true);
  const [selfie, setSelfie] = useState<ProcessedImage | null>(null);
  const startedAt = useRef(0);
  const [totalMs, setTotalMs] = useState(0);
  const { width, height } = useWindowDimensions();

  const liveness = useLivenessChallenge({
    camera,
    steps: STEPS,
    // Built-in voice via expo-speech (pass `speak` instead to use another engine).
    // Haptics are on by default: a tap per step, success on pass, error on fail.
    voice: voice ? { rate: 0.95 } : false,
    onPass: () => {
      setTotalMs(Date.now() - startedAt.current);
      setStep('result');
    },
    onFail: () => setStep('result'),
  });

  // Take the selfie the moment positioning succeeds: the face is centered, still and forward.
  const phase = liveness.phase;
  const shooting = useRef(false);
  useEffect(() => {
    if (phase !== 'challenge' || selfie || shooting.current) return;
    shooting.current = true;
    camera
      .takePhoto()
      .then(setSelfie, () => {})
      .finally(() => (shooting.current = false));
  }, [phase, selfie, camera]);

  // Ring = finished steps plus how far into the current move the user is.
  const ring = useSharedValue(0);
  const progress =
    (liveness.completed.length + liveness.stepProgress * (phase === 'challenge' ? 1 : 0)) /
    STEPS.length;
  useEffect(() => {
    ring.value = withTiming(progress, { duration: 150 });
  }, [progress, ring]);

  const begin = () => {
    setSelfie(null);
    startedAt.current = Date.now();
    setStep('check');
    liveness.start();
  };

  const voiceButton = (
    <NavButton icon={voice ? 'volume-high' : 'volume-mute'} onPress={() => setVoice((v) => !v)} />
  );

  if (step === 'intro') {
    const ringSize = Math.min(width - 48, height * 0.36);
    return (
      <Screen onBack={onBack} footer={<Button label="Get Started" onPress={begin} />}>
        <View style={styles.centered}>
          <FaceScanRing
            size={ringSize}
            innerSize={ringSize * 0.6}
            idle
            color={color.tick}
            highlightColor="#FFFFFF">
            <CenterIcon icon="id-card-outline" size={ringSize * 0.6} color={color.tick} />
          </FaceScanRing>
          <Headline
            title="Verify It's You"
            body={`Follow ${STEPS.length} quick prompts, like turning your head or blinking. The order changes every time.`}
          />
          <View style={styles.stretch}>
            <ToggleRow
              icon="volume-high"
              label="Voice guidance"
              value={voice}
              onChange={setVoice}
            />
          </View>
        </View>
      </Screen>
    );
  }

  if (step === 'result') {
    const passed = phase === 'passed';
    const failure = liveness.failure ? FAILURE_TEXT[liveness.failure] : undefined;
    let footer: ReactNode;
    if (passed) {
      footer = (
        <>
          <Button label="Done" onPress={onBack} />
          <Button label="Verify Again" variant="plain" onPress={begin} />
        </>
      );
    } else {
      footer = (
        <>
          <Button label="Try Again" onPress={begin} />
          <Button label="Cancel" variant="plain" onPress={onBack} />
        </>
      );
    }
    return (
      <Screen onBack={onBack} backLabel="Close" footer={footer}>
        <View style={styles.centered}>
          {passed && selfie ? (
            <VerifiedPhoto uri={selfie.uri} size={Math.min(width * 0.5, 200)} />
          ) : (
            <CenterIcon
              icon={passed ? 'checkmark' : 'close'}
              size={120}
              color={passed ? color.green : color.pink}
              filled
            />
          )}
          <Headline
            title={passed ? "You're verified" : (failure?.title ?? 'Verification failed')}
            body={
              passed
                ? `All ${STEPS.length} checks passed in ${(totalMs / 1000).toFixed(1)} s.`
                : failure?.body
            }
          />
          <View style={styles.stretch}>
            <RequirementList
              items={liveness.steps.map((s) => {
                const done = liveness.completed.find((c) => c.step === s);
                return {
                  label: STEP_LABEL[s],
                  passed: !!done,
                  detail: done ? `${(done.duration / 1000).toFixed(1)} s` : undefined,
                };
              })}
            />
          </View>
        </View>
      </Screen>
    );
  }

  // Blinks need eye signals: probabilities on Android, eye contours on iOS.
  const eyeSignals: FaceDetectionOptions = getCapabilities().eyeOpenProbability
    ? { classification: true }
    : { contours: true };
  const cue = CUE[liveness.prompt];
  const stepNumber = Math.min(liveness.stepIndex + 1, STEPS.length);
  const hint =
    phase === 'positioning'
      ? 'Look straight at the camera'
      : phase === 'returning'
        ? `Step ${liveness.stepIndex} of ${STEPS.length} done`
        : `Step ${stepNumber} of ${STEPS.length}`;

  return (
    <Screen onBack={onBack} headerRight={voiceButton}>
      <View style={styles.centered}>
        <RoundCamera
          camera={camera}
          inferenceFps={24}
          detection={{ performanceMode: 'fast', ...eyeSignals }}
          progress={ring}
          progressColor={color.green}
          ready={phase === 'passed'}
        />
        <View style={styles.prompt}>
          <View style={styles.cueSlot}>
            {cue ? <PromptCue icon={cue.icon} direction={cue.direction} /> : null}
          </View>
          <Instruction title={liveness.text} hint={hint} />
          <StepDots total={STEPS.length} done={liveness.completed.length} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 8 },
  stretch: { alignSelf: 'stretch', paddingHorizontal: 16 },
  prompt: { alignSelf: 'stretch', alignItems: 'center', gap: 14 },
  // Fixed height so the text below doesn't jump when the cue disappears.
  cueSlot: { height: 60, justifyContent: 'center' },
});

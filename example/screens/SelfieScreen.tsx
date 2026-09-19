import {
  useFaceAutoCapture,
  useFaceCamera,
  useFaceValidation,
  type FaceRequirements,
  type GuidanceStatus,
  type ProcessedImage,
} from '@rbayuokt/expo-face-vision';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import { Button } from '../components/Button';
import { CapturedPhoto } from '../components/CapturedPhoto';
import { Instruction } from '../components/Instruction';
import { RequirementList } from '../components/RequirementList';
import { Screen } from '../components/Screen';
import { RoundCamera, ROUND_GUIDE } from './shared/RoundCamera';

const STABLE_FOR_MS = 700;

/** Everything that must hold before the photo is taken. */
const REQUIREMENTS: FaceRequirements = {
  singleFace: true,
  guide: ROUND_GUIDE,
  minFaceSize: 0.35,
  lookingForward: true,
  eyesOpen: true,
  stableFor: STABLE_FOR_MS,
};

// The library only returns status codes; the wording (and its translation) is the app's job.
const GUIDANCE_TEXT: Record<GuidanceStatus, string> = {
  NO_FACE: 'Position your face',
  MULTIPLE_FACES: 'Only one face, please',
  FACE_TOO_SMALL: 'Face too small',
  FACE_TOO_LARGE: 'Face too large',
  MOVE_LEFT: 'Move left',
  MOVE_RIGHT: 'Move right',
  MOVE_UP: 'Move up',
  MOVE_DOWN: 'Move down',
  MOVE_CLOSER: 'Move closer',
  MOVE_FARTHER: 'Move back a little',
  LOOK_FORWARD: 'Look straight ahead',
  LOOK_LEFT: 'Turn your head left',
  LOOK_RIGHT: 'Turn your head right',
  OPEN_EYES: 'Keep your eyes open',
  TOO_DARK: 'Find more light',
  TOO_BRIGHT: 'Too much light',
  TOO_BLURRY: 'Hold the phone steady',
  HOLD_STILL: 'Hold still',
  REQUIREMENT_NOT_MET: 'Almost there',
  READY: 'Perfect!',
};

/** Which validation issue codes each on-screen check stands for. */
const CHECKS = [
  {
    label: 'Face in the circle',
    codes: ['NO_FACE', 'MULTIPLE_FACES', 'FACE_OUTSIDE_REGION', 'FACE_TOO_SMALL', 'FACE_TOO_LARGE'],
  },
  {
    label: 'Looking straight ahead',
    codes: ['YAW_TOO_LARGE', 'PITCH_TOO_LARGE', 'ROLL_TOO_LARGE'],
  },
  { label: 'Eyes open', codes: ['EYES_CLOSED'] },
  { label: 'Holding still', codes: ['NOT_STABLE'] },
];

function hintFor(status: GuidanceStatus | null): string {
  if (!status || status === 'NO_FACE') return 'Hold your phone at eye level';
  if (status === 'HOLD_STILL') return 'Keep still for a moment';
  if (status === 'READY') return 'Taking your photo';
  return 'The photo is taken automatically when every check passes';
}

/** Guided selfie: validation → guidance text → auto capture. */
export function SelfieScreen({ onBack }: { onBack: () => void }) {
  const camera = useFaceCamera();
  const [photo, setPhoto] = useState<ProcessedImage | null>(null);

  // Drives the instruction and the check list. Re-renders only when the issue codes change.
  const { validation, status } = useFaceValidation(REQUIREMENTS, { camera });

  // Runs the IDLE → SEARCHING → … → CAPTURING state machine and takes the photo.
  const autoCapture = useFaceAutoCapture({
    camera,
    enabled: !photo,
    requirements: REQUIREMENTS,
    stableFor: STABLE_FOR_MS,
    // A success haptic plays on capture by default (haptics: false to turn it off).
    onCapture: (result) => setPhoto(result.photo),
  });

  // The ring fills while the face holds still, so the short wait reads as progress.
  const ring = useSharedValue(0);
  const captureStatus = autoCapture.state.status;
  useEffect(() => {
    if (captureStatus === 'STABILIZING') ring.value = withTiming(1, { duration: STABLE_FOR_MS });
    else if (captureStatus === 'READY' || captureStatus === 'CAPTURING') ring.value = 1;
    else ring.value = withTiming(0, { duration: 150 });
  }, [captureStatus, ring]);

  if (photo) {
    return (
      <CapturedPhoto
        uri={photo.uri}
        width={photo.width}
        height={photo.height}
        onRetake={() => setPhoto(null)}
        onDone={onBack}
      />
    );
  }

  const issues = validation?.issues.map((i) => i.code) ?? ['NO_FACE'];
  const faceFound = !issues.includes('NO_FACE');
  const checks = CHECKS.map((c) => ({
    label: c.label,
    passed: faceFound && !c.codes.some((code) => issues.includes(code)),
  }));

  return (
    <Screen
      onBack={onBack}
      footer={<Button label="Take Photo Now" variant="plain" onPress={autoCapture.capture} />}>
      <View style={styles.centered}>
        <RoundCamera
          camera={camera}
          requirements={REQUIREMENTS}
          ready={status === 'READY'}
          progress={ring}
        />
        <Instruction
          title={status ? GUIDANCE_TEXT[status] : 'Starting camera…'}
          hint={hintFor(status)}
          ready={status === 'READY'}
        />
        <View style={styles.list}>
          <RequirementList items={checks} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 8 },
  list: { alignSelf: 'stretch', paddingHorizontal: 16 },
});

import {
  FaceCamera,
  type FaceCameraController,
  type FaceDetectionOptions,
  type FaceRequirements,
  type GuideShape,
} from '@rbayuokt/expo-face-vision';
import { FaceGuide } from '@rbayuokt/expo-face-vision/overlays';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { color } from '../../theme';

/** Circle filling a square camera view. Drawn by FaceGuide and usable as a requirement. */
export const ROUND_GUIDE: GuideShape = { width: 0.92, height: 0.92, centerY: 0.5 };
const FULL_CIRCLE: GuideShape = { width: 1, height: 1, centerY: 0.5 };

type Props = {
  camera: FaceCameraController;
  requirements?: FaceRequirements;
  detection?: FaceDetectionOptions;
  inferenceFps?: number;
  ready?: boolean;
  progress?: SharedValue<number>;
  /** Defaults to fit the window. */
  diameter?: number;
  /** Draw the progress ring. Default true. */
  ring?: boolean;
  /** Progress arc color. Default: gray until ready, then green. */
  progressColor?: string;
};

/**
 * Front camera shown as a circle with a progress ring. FaceGuide paints everything outside the
 * circle in the page color, which rounds the preview reliably on both platforms.
 */
export function RoundCamera({
  camera,
  requirements,
  detection,
  inferenceFps,
  ready = false,
  progress,
  diameter,
  ring = true,
  progressColor,
}: Props) {
  const { width, height } = useWindowDimensions();
  const size = diameter ?? Math.min(width - 64, height * 0.36);
  return (
    <View style={{ width: size, height: size }}>
      {/* `requirements` only tells the camera which detector features to turn on (e.g. eye
          signals); nothing is captured unless a hook like useFaceAutoCapture asks for it. */}
      <FaceCamera
        camera={camera}
        style={styles.flex}
        facing="front"
        requirements={requirements}
        detection={detection}
        inferenceFps={inferenceFps}>
        <FaceGuide
          // Without the ring the circle can fill the whole square.
          shape={ring ? ROUND_GUIDE : FULL_CIRCLE}
          ready={ready}
          progress={progress}
          color={ring ? color.tick : 'transparent'}
          readyColor={ring ? color.green : 'transparent'}
          progressColor={ring ? progressColor : 'transparent'}
          dimColor={color.bg}
          strokeWidth={ring ? 6 : 0}
        />
      </FaceCamera>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});

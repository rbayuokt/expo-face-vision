import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  NativeCameraView,
  type NativeCameraRef,
  type TakePhotoOptions,
} from './ExpoFaceVisionCameraView';
import { FaceCameraContext } from './camera/context';
import { FaceCameraController } from './camera/controller';
import type { AutoCaptureState } from './core/autoCapture';
import type { TrackingOptions } from './core/tracker';
import {
  useFaceAutoCapture,
  useFaceFrames,
  type AutoCaptureResult,
  type FaceRequirements,
} from './hooks';
import { getCapabilities } from './image';
import type { CameraFacing, FaceDetectionOptions, FaceFrame, ResizeMode, Size } from './types';

export interface FaceCameraProps {
  /** From `useFaceCamera()`, to use hooks outside this component's children. */
  camera?: FaceCameraController;
  /** Default `front`. */
  facing?: CameraFacing;
  /** false pauses the camera and analysis. Default true. */
  active?: boolean;
  /** Max analyzed frames per second; preview and overlays still run at display rate. Default 15. */
  inferenceFps?: number;
  detection?: FaceDetectionOptions;
  /** Default true. */
  tracking?: boolean | TrackingOptions;
  /** Per-face brightness/contrast/sharpness. On automatically when `requirements` need it. */
  frameStats?: boolean;
  /** Default `cover`. */
  resizeMode?: ResizeMode;
  /** Every analyzed frame. Runs on the JS thread; don't set state here on every call. */
  onFrame?: (frame: FaceFrame) => void;
  onCameraReady?: (info: { frame: Size }) => void;
  onCameraError?: (error: { code: string; message: string }) => void;

  autoCapture?: boolean;
  requirements?: FaceRequirements;
  /** Default 500 when auto capturing. */
  stableFor?: number;
  countdown?: number;
  cooldown?: number;
  continuous?: boolean;
  photo?: TakePhotoOptions;
  /** Success haptic on auto capture (needs expo-haptics). Default true. */
  haptics?: boolean;
  onCapture?: (result: AutoCaptureResult) => void;
  onCaptureError?: (error: unknown) => void;
  onAutoCaptureStateChange?: (state: AutoCaptureState) => void;

  style?: StyleProp<ViewStyle>;
  /** Overlays. Rendered over the preview with the camera in context. */
  children?: ReactNode;
}

/** Turns requirements into the detector features they need, so they can't silently never pass. */
function detectionFor(
  options: FaceDetectionOptions,
  requirements: FaceRequirements | undefined,
  tracking: boolean
) {
  const out: FaceDetectionOptions = { performanceMode: 'fast', ...options };
  if (requirements?.eyesOpen) {
    if (getCapabilities().eyeOpenProbability) out.classification = true;
    else out.contours = true;
  }
  // ML Kit only returns contours for one face, so its native ids add nothing there.
  out.tracking ??= tracking && !out.contours;
  return out;
}

export function FaceCamera(props: FaceCameraProps) {
  const {
    facing = 'front',
    active = true,
    inferenceFps = 15,
    resizeMode = 'cover',
    tracking = true,
    requirements,
  } = props;
  const [own] = useState(() => new FaceCameraController({ tracking }));
  const camera = props.camera ?? own;
  const trackingKey = JSON.stringify(tracking);
  useEffect(() => camera.configure({ tracking }), [camera, trackingKey]);

  // Tracks from the other camera or before a pause are meaningless now.
  useEffect(() => camera.reset(), [camera, facing, active]);

  const trackingEnabled =
    tracking !== false && (typeof tracking !== 'object' || tracking.enabled !== false);
  const detectionKey = JSON.stringify([props.detection, requirements?.eyesOpen, trackingEnabled]);
  const detection = useMemo(
    () => detectionFor(props.detection ?? {}, requirements, trackingEnabled),
    [detectionKey]
  );
  const frameStats =
    props.frameStats ??
    (requirements?.minBrightness !== undefined ||
      requirements?.maxBrightness !== undefined ||
      requirements?.minSharpness !== undefined);

  useFaceFrames((frame) => props.onFrame?.(frame), camera);
  useFaceAutoCapture({
    camera,
    enabled: !!props.autoCapture && active,
    requirements,
    stableFor: props.stableFor,
    countdown: props.countdown,
    cooldown: props.cooldown,
    continuous: props.continuous,
    photo: props.photo,
    haptics: props.haptics,
    onCapture: props.onCapture,
    onCaptureError: props.onCaptureError,
    onStateChange: props.onAutoCaptureStateChange,
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    camera.setLayout({ width, height }, resizeMode);
  };
  useEffect(() => {
    const p = camera.latest?.preview;
    if (p) camera.setLayout(p, resizeMode);
  }, [camera, resizeMode]);

  return (
    <FaceCameraContext.Provider value={camera}>
      <View style={[styles.container, props.style]} onLayout={onLayout}>
        <NativeCameraView
          ref={(ref: NativeCameraRef | null) => camera.attach(ref)}
          style={StyleSheet.absoluteFill}
          facing={facing}
          active={active}
          inferenceFps={inferenceFps}
          detection={detection}
          frameStats={frameStats}
          resizeMode={resizeMode}
          onFrame={(e) => camera.handleFrame(e.nativeEvent)}
          onCameraReady={(e) => props.onCameraReady?.(e.nativeEvent)}
          onCameraError={(e) => props.onCameraError?.(e.nativeEvent)}
        />
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {props.children}
        </View>
      </View>
    </FaceCameraContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', backgroundColor: 'black' },
});

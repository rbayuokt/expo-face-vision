import {
  FaceCamera,
  getLargestFace,
  useFaceCamera,
  useFaceFrames,
  type CameraFacing,
  type FaceCameraController,
  type FaceFrame,
} from '@rbayuokt/expo-face-vision';
import { FaceOverlay, HeadPoseIndicator } from '@rbayuokt/expo-face-vision/overlays';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Chip } from '../components/Chip';
import { CornerMask } from '../components/CornerMask';
import { NavButton, Screen } from '../components/Screen';
import { SectionHeader } from '../components/SectionHeader';
import { Segmented } from '../components/Segmented';
import { StatsGrid, type Stat } from '../components/StatsGrid';
import { color, radius } from '../theme';

const FPS_OPTIONS = [10, 15, 30].map((n) => ({ value: n, label: `${n} fps` }));

/** Overlays drawn over the live camera, plus the raw numbers behind them. */
export function InspectorScreen({ onBack }: { onBack: () => void }) {
  const camera = useFaceCamera();
  const [facing, setFacing] = useState<CameraFacing>('front');
  const [landmarks, setLandmarks] = useState(true);
  const [contours, setContours] = useState(false);
  const [fps, setFps] = useState(15);
  const stats = useLiveStats(camera);
  const { width } = useWindowDimensions();

  return (
    <Screen
      title="Inspector"
      backLabel="Done"
      onBack={onBack}
      headerRight={
        <NavButton
          icon="camera-reverse-outline"
          onPress={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))}
        />
      }>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={{ height: ((width - 32) * 4) / 3 }}>
          <FaceCamera
            camera={camera}
            style={styles.flex}
            facing={facing}
            inferenceFps={fps}
            detection={{ performanceMode: 'fast', landmarks, contours, classification: true }}
            frameStats>
            {/* Boxes glide at display rate even when detection runs at 10 fps. */}
            <FaceOverlay color={color.green} landmarks={landmarks} contours={contours} />
            <HeadPoseIndicator color={color.green} size={64} style={styles.pose} />
            <CornerMask radius={radius.xl} color={color.bg} />
          </FaceCamera>
        </View>

        <SectionHeader>Overlay</SectionHeader>
        <View style={styles.chips}>
          <Chip label="Landmarks" selected={landmarks} onPress={() => setLandmarks((v) => !v)} />
          <Chip label="Contours" selected={contours} onPress={() => setContours((v) => !v)} />
        </View>

        <SectionHeader>Detection rate</SectionHeader>
        <Segmented options={FPS_OPTIONS} value={fps} onChange={setFps} />

        <SectionHeader>Live values</SectionHeader>
        <StatsGrid stats={stats} />
      </ScrollView>
    </Screen>
  );
}

/**
 * Raw frames via `useFaceFrames`: the callback runs for every analyzed frame without
 * rendering, and the panel refreshes 4 times a second from the latest one.
 */
function useLiveStats(camera: FaceCameraController): Stat[] {
  const frames = useRef<number[]>([]);
  const latest = useRef<FaceFrame | null>(null);
  const [stats, setStats] = useState<Stat[]>([]);

  useFaceFrames((frame) => {
    latest.current = frame;
    frames.current.push(frame.timestamp);
    while (frame.timestamp - frames.current[0]! > 1000) frames.current.shift();
  }, camera);

  useEffect(() => {
    const id = setInterval(() => {
      const frame = latest.current;
      if (!frame) return;
      const face = getLargestFace(frame.faces);
      const pose = face?.headPose;
      const p = face?.probabilities;
      const deg = (v?: number) => (v === undefined ? '–' : `${v.toFixed(0)}°`);
      const pct = (v?: number) => (v === undefined ? '–' : `${Math.round(v * 100)}%`);
      setStats([
        { label: 'Analysis', value: `${frames.current.length} fps` },
        { label: 'Latency', value: `${frame.processingTime.toFixed(0)} ms` },
        { label: 'Frame', value: `${frame.frame.width}×${frame.frame.height}` },
        { label: 'Faces', value: String(frame.faces.length) },
        { label: 'Yaw', value: deg(pose?.yaw) },
        { label: 'Pitch', value: deg(pose?.pitch) },
        { label: 'Roll', value: deg(pose?.roll) },
        {
          label: 'Track id',
          value: face?.trackingId !== undefined ? String(face.trackingId) : '–',
        },
        { label: 'Smile', value: pct(p?.smiling) },
        { label: 'Eyes open', value: p ? `${pct(p.leftEyeOpen)} ${pct(p.rightEyeOpen)}` : '–' },
        { label: 'Brightness', value: pct(face?.stats?.brightness) },
        { label: 'Sharpness', value: face?.stats ? face.stats.laplacianVariance.toFixed(0) : '–' },
      ]);
    }, 250);
    return () => clearInterval(id);
  }, []);

  return stats;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: 16, gap: 16 },
  chips: { flexDirection: 'row', gap: 8 },
  pose: { position: 'absolute', right: 12, bottom: 12 },
});

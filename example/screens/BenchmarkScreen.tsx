import {
  detectFaces,
  useFaceCamera,
  useFaceFrames,
  type PerformanceMode,
} from '@rbayuokt/expo-face-vision';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { ResultTable } from '../components/ResultTable';
import { Screen } from '../components/Screen';
import { SectionHeader } from '../components/SectionHeader';
import { color } from '../theme';
import { ENGINE_CASES, runEngineCase } from './benchmark/engine';
import { RoundCamera } from './shared/RoundCamera';

const MODES: PerformanceMode[] = ['fast', 'balanced', 'accurate'];
const CAMERA_WARMUP_MS = 2000;
const CAMERA_SAMPLE_MS = 8000;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
};

function deviceName(): string {
  const c = Platform.constants as { Brand?: string; Model?: string };
  const model = c.Brand && c.Model ? `${c.Brand} ${c.Model}` : Platform.OS;
  return `${model}, ${Platform.OS} ${Platform.Version}`;
}

/** Logs results as a Markdown table, so they can be pulled from `adb logcat` or Xcode. */
function logTable(title: string, columns: string[], rows: string[][]) {
  const lines = [
    `### ${title} (${deviceName()})`,
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ];
  console.log(`[benchmark]\n${lines.join('\n')}`);
}

/** Measures the library on this device: JS engine, still-image detection and the live camera. */
export function BenchmarkScreen({ onBack }: { onBack: () => void }) {
  const [engineRows, setEngineRows] = useState<string[][] | null>(null);
  const [imageRows, setImageRows] = useState<string[][] | null>(null);
  const [cameraRows, setCameraRows] = useState<string[][] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const runEngine = () => {
    setBusy('Timing the JS engine…');
    // Let the "busy" text render before the tight loops block the JS thread.
    setTimeout(() => {
      const rows = ENGINE_CASES.map((c, i) => [c.label, `${runEngineCase(i).toFixed(1)} µs`]);
      setEngineRows(rows);
      logTable('JS engine per analyzed frame', ['Work', 'Median'], rows);
      setBusy(null);
    }, 50);
  };

  const runImage = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (picked.canceled) return;
    const uri = picked.assets[0]!.uri;
    setBusy('Detecting faces on the photo…');
    const rows: string[][] = [];
    for (const mode of MODES) {
      const options = { performanceMode: mode, landmarks: true, classification: true } as const;
      await detectFaces(uri, options); // warm-up: model load, first decode
      const times: number[] = [];
      let faces = 0;
      for (let i = 0; i < 5; i++) {
        const result = await detectFaces(uri, options);
        times.push(result.processingTime);
        faces = result.faces.length;
      }
      rows.push([mode, `${median(times).toFixed(0)} ms`, String(faces)]);
    }
    const asset = picked.assets[0]!;
    setImageRows(rows);
    logTable(
      `detectFaces on a ${asset.width}×${asset.height} photo`,
      ['Mode', 'Median', 'Faces'],
      rows
    );
    setBusy(null);
  };

  return (
    <Screen title="Benchmark" backLabel="Done" onBack={onBack}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.device}>{deviceName()}</Text>
        {busy ? <Text style={styles.busy}>{busy}</Text> : null}

        <SectionHeader>JS engine, per analyzed frame</SectionHeader>
        {engineRows ? <ResultTable columns={['Work', 'Median']} rows={engineRows} /> : null}
        <Button label="Run" variant="tinted" onPress={runEngine} disabled={!!busy} />

        <SectionHeader>Still photo</SectionHeader>
        {imageRows ? <ResultTable columns={['Mode', 'Median', 'Faces']} rows={imageRows} /> : null}
        <Button label="Choose a Photo" variant="tinted" onPress={runImage} disabled={!!busy} />

        <SectionHeader>Live camera</SectionHeader>
        <Text style={styles.note}>
          Look at the front camera. Each mode runs {CAMERA_SAMPLE_MS / 1000} s at an uncapped
          detection rate, so the numbers show what the detector can sustain.
        </Text>
        {cameraRows ? (
          <ResultTable columns={['Mode', 'Analyzed', 'Latency', 'Face']} rows={cameraRows} />
        ) : null}
        <CameraRun
          disabled={!!busy && busy !== 'camera'}
          onBusy={(b) => setBusy(b ? 'camera' : null)}
          onDone={(rows) => {
            setCameraRows(rows);
            logTable(
              'Live camera (front, landmarks + classification)',
              ['Mode', 'Analyzed', 'Latency', 'Face'],
              rows
            );
          }}
        />
      </ScrollView>
    </Screen>
  );
}

type Sample = { timestamp: number; latency: number; face: boolean };

/** Runs the front camera in each performance mode and records throughput and latency. */
function CameraRun(props: {
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onDone: (rows: string[][]) => void;
}) {
  const camera = useFaceCamera();
  const [modeIndex, setModeIndex] = useState<number | null>(null);
  const samples = useRef<Sample[]>([]);
  const recording = useRef(false);
  const rows = useRef<string[][]>([]);
  const mode = modeIndex === null ? null : MODES[modeIndex]!;

  useFaceFrames((frame) => {
    if (!recording.current) return;
    samples.current.push({
      timestamp: frame.timestamp,
      latency: frame.processingTime,
      face: frame.faces.length > 0,
    });
  }, camera);

  // Per mode: let the camera restart and settle, record, then move to the next mode.
  useEffect(() => {
    if (modeIndex === null) return;
    samples.current = [];
    const start = setTimeout(() => (recording.current = true), CAMERA_WARMUP_MS);
    const stop = setTimeout(() => {
      recording.current = false;
      const s = samples.current;
      const span = s.length > 1 ? (s[s.length - 1]!.timestamp - s[0]!.timestamp) / 1000 : 0;
      const fps = span > 0 ? (s.length - 1) / span : 0;
      const faceShare = s.length ? s.filter((x) => x.face).length / s.length : 0;
      rows.current.push([
        MODES[modeIndex]!,
        `${fps.toFixed(1)} fps`,
        `${median(s.map((x) => x.latency)).toFixed(0)} ms`,
        `${Math.round(faceShare * 100)}%`,
      ]);
      if (modeIndex + 1 < MODES.length) {
        setModeIndex(modeIndex + 1);
      } else {
        setModeIndex(null);
        props.onBusy(false);
        props.onDone(rows.current);
      }
    }, CAMERA_WARMUP_MS + CAMERA_SAMPLE_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [modeIndex]);

  if (mode === null) {
    return (
      <Button
        label="Start Camera Test"
        variant="tinted"
        disabled={props.disabled}
        onPress={() => {
          rows.current = [];
          props.onBusy(true);
          setModeIndex(0);
        }}
      />
    );
  }
  return (
    <View style={styles.cameraRow}>
      <RoundCamera
        camera={camera}
        diameter={140}
        ring={false}
        inferenceFps={60}
        detection={{ performanceMode: mode, landmarks: true, classification: true }}
      />
      <Text style={styles.busy}>
        Testing {mode} ({(modeIndex ?? 0) + 1} of {MODES.length})…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  device: { color: color.secondary, fontSize: 15, textAlign: 'center' },
  busy: { color: color.blue, fontSize: 15, textAlign: 'center' },
  note: { color: color.secondary, fontSize: 13, lineHeight: 18, marginHorizontal: 16 },
  cameraRow: { alignItems: 'center', gap: 10 },
});

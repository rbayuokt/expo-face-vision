import {
  alignFace,
  analyzeFaceQuality,
  cropFace,
  detectFaces,
  measureFaceRegion,
} from '@rbayuokt/expo-face-vision';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { FaceDetails } from '../components/FaceDetails';
import { PhotoPreview } from '../components/PhotoPreview';
import { Screen } from '../components/Screen';
import { Segmented } from '../components/Segmented';
import type { Stat } from '../components/StatsGrid';
import { color } from '../theme';

type AnalyzedFace = {
  box: { x: number; y: number; width: number; height: number };
  cropUri: string;
  alignedUri?: string;
  score: number;
  details: Stat[];
};

type PhotoResult = { uri: string; aspectRatio: number; faces: AnalyzedFace[]; ms: number };

const THUMB = { square: true, padding: 0.25, outputSize: { width: 300, height: 300 } };

/** detect → for each face: crop, align (when eyes were found), measure and score. */
async function analyzePhoto(uri: string): Promise<PhotoResult> {
  const result = await detectFaces(uri, {
    performanceMode: 'accurate',
    landmarks: true,
    classification: true,
  });

  const faces = await Promise.all(
    result.faces.map(async (face): Promise<AnalyzedFace> => {
      const hasEyes = !!(face.landmarks?.leftEye && face.landmarks.rightEye);
      const [crop, aligned, stats] = await Promise.all([
        cropFace(uri, face, THUMB),
        hasEyes ? alignFace(uri, face, THUMB) : undefined,
        measureFaceRegion(uri, face),
      ]);
      const quality = analyzeFaceQuality(face, { image: result.image, stats });
      const pose = face.headPose;
      const p = face.probabilities;

      const details: Stat[] = [
        {
          label: 'Head pose',
          value: pose ? `${pose.direction} · yaw ${pose.yaw.toFixed(0)}°` : '–',
        },
        { label: 'Face size', value: `${Math.round(quality.faceSize * 100)}% of width` },
        { label: 'Brightness', value: `${Math.round(stats.brightness * 100)}%` },
        { label: 'Sharpness', value: quality.tooBlurry ? 'blurry' : 'sharp' },
      ];
      if (p?.smiling !== undefined) {
        details.push({ label: 'Smiling', value: `${Math.round(p.smiling * 100)}%` });
      }
      if (face.confidence !== undefined) {
        details.push({ label: 'Confidence', value: `${Math.round(face.confidence * 100)}%` });
      }

      return {
        box: face.normalizedBounds,
        cropUri: crop.uri,
        alignedUri: aligned?.uri,
        score: quality.score,
        details,
      };
    })
  );

  return {
    uri,
    aspectRatio: result.image.width / result.image.height,
    faces,
    ms: result.processingTime,
  };
}

/** The still-image API: no camera, just a picked photo. */
export function PhotoScreen({ onBack }: { onBack: () => void }) {
  const [result, setResult] = useState<PhotoResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (picked.canceled) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await analyzePhoto(picked.assets[0]!.uri));
      setSelected(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const face = result?.faces[selected];
  const faceCount = result?.faces.length ?? 0;
  return (
    <Screen
      title="Photo Analysis"
      backLabel="Done"
      onBack={onBack}
      footer={
        <Button
          label={result ? 'Choose Another Photo' : 'Choose a Photo'}
          onPress={pick}
          disabled={busy}
        />
      }>
      <ScrollView contentContainerStyle={styles.page}>
        {busy ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" />
            <Text style={styles.caption}>Analyzing…</Text>
          </View>
        ) : null}
        {!busy && !result ? (
          <EmptyState
            icon="images-outline"
            title="No photo yet"
            body="Pick a photo with one or more faces. Group shots work well."
          />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {result && !busy ? (
          <>
            <PhotoPreview
              uri={result.uri}
              aspectRatio={result.aspectRatio}
              boxes={result.faces.map((f) => f.box)}
              selected={selected}
              onSelect={setSelected}
            />
            <Text style={styles.caption}>
              {faceCount === 0
                ? 'No faces found in this photo.'
                : `${faceCount} face${faceCount > 1 ? 's' : ''} found in ${result.ms.toFixed(0)} ms`}
            </Text>
            {faceCount > 1 ? (
              <Segmented
                options={result.faces.map((_, i) => ({ value: i, label: `Face ${i + 1}` }))}
                value={selected}
                onChange={setSelected}
              />
            ) : null}
            {face ? (
              <FaceDetails
                title={`Face ${selected + 1}`}
                cropUri={face.cropUri}
                alignedUri={face.alignedUri}
                score={face.score}
                details={face.details}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16 },
  loading: { alignItems: 'center', gap: 12, marginTop: 120 },
  caption: { color: color.secondary, textAlign: 'center', fontSize: 15 },
  error: { color: color.pink, textAlign: 'center', fontSize: 15 },
});

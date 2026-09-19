import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import type { FaceCameraController } from '../camera/controller';
import { getLargestFace } from '../core/face';
import { useFaceFrames } from '../hooks';
import type { FaceFrame } from '../types';
import { FaceOverlay } from './FaceOverlay';

export interface DebugOverlayProps {
  camera?: FaceCameraController | null;
  /** Text refresh rate, Hz. Default 4. */
  refreshHz?: number;
}

const fmt = (v: number | undefined, digits = 1) => (v === undefined ? '-' : v.toFixed(digits));

/** Boxes, landmarks and contours plus a stats panel. Text updates at `refreshHz`, not per frame. */
export function DebugOverlay({ camera, refreshHz = 4 }: DebugOverlayProps) {
  const latest = useRef<FaceFrame | null>(null);
  const stamps = useRef<number[]>([]);
  const [text, setText] = useState('waiting for frames');

  useFaceFrames((frame) => {
    latest.current = frame;
    const s = stamps.current;
    s.push(frame.timestamp);
    while (s.length > 0 && frame.timestamp - s[0]! > 1000) s.shift();
  }, camera);

  useEffect(() => {
    const id = setInterval(() => {
      const f = latest.current;
      if (!f) return;
      const face = getLargestFace(f.faces);
      const p = face?.headPose;
      const lines = [
        `analysis ${stamps.current.length} fps · ${fmt(f.processingTime, 0)} ms`,
        `frame ${f.frame.width}×${f.frame.height}${f.mirrored ? ' mirrored' : ''} · faces ${f.faces.length}`,
      ];
      if (face) {
        lines.push(`id ${face.trackingId ?? '-'} · size ${fmt(face.normalizedBounds.width, 2)}`);
        lines.push(`yaw ${fmt(p?.yaw)} pitch ${fmt(p?.pitch)} roll ${fmt(p?.roll)}`);
        const pr = face.probabilities;
        if (pr)
          lines.push(
            `smile ${fmt(pr.smiling, 2)} eyes ${fmt(pr.leftEyeOpen, 2)}/${fmt(pr.rightEyeOpen, 2)}`
          );
        const st = face.stats;
        if (st)
          lines.push(
            `luma ${fmt(st.brightness, 2)} contrast ${fmt(st.contrast, 2)} sharp ${fmt(st.laplacianVariance, 0)}`
          );
      }
      setText(lines.join('\n'));
    }, 1000 / refreshHz);
    return () => clearInterval(id);
  }, [refreshHz]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <FaceOverlay camera={camera} landmarks contours />
      <View style={styles.panel}>
        <Text style={styles.text}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  text: {
    color: 'white',
    fontSize: 11,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    lineHeight: 15,
  },
});

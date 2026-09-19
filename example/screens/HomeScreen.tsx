import { getCapabilities } from '@rbayuokt/expo-face-vision';
import { FaceScanRing } from '@rbayuokt/expo-face-vision/overlays';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CenterIcon } from '../components/CenterIcon';
import { MenuGroup, MenuRow } from '../components/MenuList';
import { color } from '../theme';

export type DemoId = 'kyc' | 'selfie' | 'scan' | 'gestures' | 'inspector' | 'photo' | 'benchmark';

export function HomeScreen({ onOpen }: { onOpen: (demo: DemoId) => void }) {
  const insets = useSafeAreaInsets();
  // What this platform's detector actually supports. Worth checking before relying on a signal.
  const caps = getCapabilities();
  const engine = caps.platform === 'ios' ? 'Apple Vision' : 'Google ML Kit';
  const blink = caps.blink === 'probability' ? 'eye-open probability' : 'eye shape';

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}>
      <View style={styles.hero}>
        <FaceScanRing size={200} innerSize={110} idle color={color.tick} highlightColor="#FFFFFF">
          <CenterIcon icon="happy-outline" size={110} color={color.tick} />
        </FaceScanRing>
        <Text style={styles.title}>Face Vision</Text>
        <Text style={styles.lead}>
          Face detection, tracking and guidance that run entirely on your phone.
        </Text>
      </View>

      <MenuGroup header="Verification">
        <MenuRow
          icon="shield-checkmark"
          tint={color.blue}
          title="Identity check (KYC)"
          subtitle="Random head moves with voice guidance, then a selfie"
          onPress={() => onOpen('kyc')}
        />
      </MenuGroup>

      <MenuGroup header="Camera">
        <MenuRow
          icon="person-circle-outline"
          tint={color.orange}
          title="Selfie capture"
          subtitle="Shoots by itself once you're centered and still"
          onPress={() => onOpen('selfie')}
        />
        <MenuRow
          icon="scan-circle-outline"
          tint={color.pink}
          title="Face scan"
          subtitle="Face ID style ring: move your head in a circle"
          onPress={() => onOpen('scan')}
        />
        <MenuRow
          icon="sync-outline"
          tint={color.purple}
          title="Head gestures"
          subtitle="Nod, shake, turn and blink"
          onPress={() => onOpen('gestures')}
        />
        <MenuRow
          icon="scan-outline"
          tint={color.tertiary}
          title="Live inspector"
          subtitle="Landmarks, contours, pose and raw numbers"
          onPress={() => onOpen('inspector')}
        />
      </MenuGroup>

      <MenuGroup
        header="Photos"
        footer={`Running on ${engine} with ${caps.landmarks.length} landmarks, ${caps.contours.length} contours, ${caps.tracking} tracking and blink detection via ${blink}.`}>
        <MenuRow
          icon="images-outline"
          tint={color.green}
          title="Photo analysis"
          subtitle="Detect, crop, align and score every face"
          onPress={() => onOpen('photo')}
        />
      </MenuGroup>

      <MenuGroup header="Developer">
        <MenuRow
          icon="speedometer-outline"
          tint={color.tertiary}
          title="Benchmark"
          subtitle="Time the detector and the JS engine on this phone"
          onPress={() => onOpen('benchmark')}
        />
      </MenuGroup>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: 16, gap: 28 },
  hero: { alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  title: { color: color.label, fontSize: 28, fontWeight: '700', marginTop: 12 },
  lead: { color: color.secondary, fontSize: 17, lineHeight: 24, textAlign: 'center' },
});

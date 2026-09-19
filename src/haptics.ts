import type * as ExpoHaptics from 'expo-haptics';

/** `tick`: a step or event. `success` / `error`: the end of a flow. */
export type HapticKind = 'tick' | 'success' | 'error';

let expoHaptics: typeof ExpoHaptics | null | undefined;

// expo-haptics is an optional peer, loaded the same way as expo-speech.
function loadExpoHaptics(): typeof ExpoHaptics | null {
  if (expoHaptics === undefined) {
    try {
      expoHaptics = require('expo-haptics') as typeof ExpoHaptics;
    } catch {
      expoHaptics = null;
    }
  }
  return expoHaptics;
}

/** Whether built-in haptics can work, i.e. expo-haptics is installed. */
export function isHapticsAvailable(): boolean {
  return loadExpoHaptics() !== null;
}

let warned = false;

/**
 * Plays a haptic through expo-haptics when it's installed. `requested` means the app asked for
 * haptics explicitly, which is the only case worth a warning when the package is missing.
 */
export function playHaptic(kind: HapticKind, requested = false): void {
  const haptics = loadExpoHaptics();
  if (!haptics) {
    if (requested && !warned) {
      warned = true;
      console.warn('[expo-face-vision] Haptics need expo-haptics: npx expo install expo-haptics');
    }
    return;
  }
  const done =
    kind === 'tick'
      ? haptics.impactAsync(haptics.ImpactFeedbackStyle.Light)
      : haptics.notificationAsync(
          kind === 'success'
            ? haptics.NotificationFeedbackType.Success
            : haptics.NotificationFeedbackType.Error
        );
  // Some devices have no haptic engine; that's not worth an unhandled rejection.
  done.catch(() => {});
}

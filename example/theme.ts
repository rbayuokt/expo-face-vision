import { Platform } from 'react-native';

/** iOS dark system palette, as in the Face ID setup screens. */
export const color = {
  bg: '#000000',
  card: '#1C1C1E',
  // Resting controls: tinted buttons, segmented track.
  fill: '#2C2C2E',
  // Selected segment.
  fillSelected: '#636366',
  separator: '#38383A',
  label: '#FFFFFF',
  secondary: '#AEAEB2',
  tertiary: '#636366',
  // Ring ticks at rest.
  tick: '#C7C7CC',
  blue: '#0A84FF',
  green: '#30D158',
  orange: '#FF9F0A',
  purple: '#BF5AF2',
  pink: '#FF375F',
  // The yellow the iOS camera uses for face boxes.
  faceBox: '#FFD60A',
};

export const font = {
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
};

export const radius = { sm: 8, md: 14, lg: 16, xl: 22, pill: 999 };

// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The library root has its own dev copies of these in ../node_modules. Native-backed packages
// must be loaded exactly once (two Skias both register SkiaPictureView and crash), so imports
// of them always resolve from the example, wherever the importing file lives.
const SINGLETONS = [
  'react',
  'react-native',
  'expo',
  'expo-modules-core',
  '@shopify/react-native-skia',
  'react-native-reanimated',
  'react-native-worklets',
  'expo-speech',
  'expo-haptics',
];
const exampleEntry = path.join(__dirname, 'index.ts');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shared = SINGLETONS.some((p) => moduleName === p || moduleName.startsWith(`${p}/`));
  return context.resolveRequest(
    shared ? { ...context, originModulePath: exampleEntry } : context,
    moduleName,
    platform
  );
};

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, './node_modules'),
  path.resolve(__dirname, '../node_modules'),
];

config.resolver.extraNodeModules = {
  '@rbayuokt/expo-face-vision': '..',
};

config.watchFolders = [path.resolve(__dirname, '..')];

config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;

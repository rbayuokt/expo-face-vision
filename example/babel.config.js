module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // babel-preset-expo resolves from the library root, where react-native-worklets isn't
    // installed, so its auto-detection misses it. Declaring the plugin here is explicit
    // and must stay last.
    plugins: ['react-native-worklets/plugin'],
  };
};

module.exports = {
  preset: '@react-native/jest-preset',
  // The default RN preset only transforms react-native* scoped packages. Several
  // deps here ship untranspiled ESM (react-native-mmkv, nitro-modules, the local
  // @glide/vlc-player package), which makes any test importing them fail to parse.
  transformIgnorePatterns: [
    'node_modules/(?!(?:jest-)?react-native|@react-native(-community)?|react-native-|@react-navigation/|@shopify/|@glide/)',
  ],
};

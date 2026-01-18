module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./'],  // Base directory for resolution (matches baseUrl: ".")
        alias: {
          '@': './src',  // Maps "@/*" to "src/*"
        },
        extensions: ['.ios.js', '.android.js', '.js', '.ts', '.tsx', '.json'],  // Support common extensions
      },
    ],
    'react-native-reanimated/plugin',
  ],
};

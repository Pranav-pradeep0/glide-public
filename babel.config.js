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
    ['transform-inline-environment-variables', {
      include: [
        'SUBDL_API_KEY',
        'SUBDL_API_URL',
        'SUBDL_DOWNLOAD_URL',
        'OMDB_API_KEY',
        'OMDB_API_URL',
        'GROQ_API_KEY',
        'GROQ_API_URL',
        'GROQ_CHAT_API_URL',
        'STALLION_PROJECT_ID',
        'STALLION_APP_TOKEN'
      ]
    }],
    'react-native-reanimated/plugin',
  ],
};

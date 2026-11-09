// Flat ESLint config: Expo's rules, Prettier owns formatting, and the domain boundary (plan section 3.1).
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');

// src/domain and src/data are platform-free TypeScript: no React, React Native, Expo or MapLibre imports.
// Platform wrappers live in src/adapters and implement interfaces declared in domain or data.
const PLATFORM = [
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
  'react-native',
  'react-native/*',
  'react-native-*',
  '@react-native/*',
  '@react-native-*/*',
  'expo',
  'expo/*',
  'expo-*',
  '@expo/*',
  '@maplibre/*',
];

module.exports = [
  { ignores: ['node_modules/', 'ios/', 'android/', '.expo/', 'dist/', 'ota/', 'reports/', 'reference/', 'coverage/'] },
  ...expoConfig,
  prettierConfig,
  {
    files: ['src/domain/**/*.{ts,tsx}', 'src/data/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: PLATFORM,
              message:
                'src/domain and src/data are platform-free. Put platform code in src/adapters behind an interface.',
            },
          ],
        },
      ],
    },
  },
  {
    // Node scripts (screenshot compare, CI helpers).
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { Buffer: 'readonly', process: 'readonly' } },
  },
  {
    // Spike code kept as is until the map track rewrites it: it reads refs and the clock during render on purpose
    // (render timing diagnostics). Do not copy the pattern into new code.
    files: ['src/ui/map/MapSurface.tsx'],
    rules: { 'react-hooks/refs': 'off', 'react-hooks/purity': 'off' },
  },
];

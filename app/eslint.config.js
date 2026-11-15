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

// Production code never imports sample data (brief, Track A acceptance). Fixtures serve tests and the capture routes
// that the screenshot gate compares against the SwiftUI references.
const SAMPLE_DATA = [
  '**/fixtures',
  '**/fixtures/*',
  '**/fixture',
  '**/fixture.*',
  '**/*Fixtures',
  '**/*Fixture',
  '**/__fixtures__/*',
  '**/capture/*',
  '**/capture*',
];
// Files that still import sample data and leave with their ticket: the Log reference (I1c). Remove each entry in the PR
// that wires its screen; an entry here is a to-do, not a permission.
const SAMPLE_DATA_UNTIL_I1B_I1C = ['src/ui/log/LogReference.tsx', 'src/ui/log/fixtures.ts'];
// What may import sample data: tests, the capture routes and their seeds, and the files that build capture screens.
const SAMPLE_DATA_ALLOWED = [
  '**/*.test.{ts,tsx}',
  'src/ui/capture/**',
  'src/fixtures/**',
  'src/app/*.tsx', // capture routes: each renders a screen with its fixtures (index.tsx is the live app, checked below)
  'src/ui/**/fixture.ts',
  'src/ui/**/fixtures.ts',
  'src/ui/**/__fixtures__/**',
  'src/ui/screens/*Captures.tsx',
  'src/ui/screens/capture*.ts',
  'src/ui/screens/CaptureScreens.tsx',
  'src/ui/flightLog/fixtures.ts',
  'tests/**',
];

module.exports = [
  { ignores: ['node_modules/', 'ios/', 'android/', '.expo/', 'dist/', 'ota/', 'reports/', 'reference/', 'coverage/'] },
  ...expoConfig,
  prettierConfig,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [...SAMPLE_DATA_ALLOWED, ...SAMPLE_DATA_UNTIL_I1B_I1C],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: SAMPLE_DATA,
              message:
                'Production code does not import sample data. Feed the slice from a service; seeds live in ui/capture.',
            },
          ],
        },
      ],
    },
  },
  {
    // The live app route is production code even though it lives beside the capture routes.
    files: ['src/app/index.tsx', 'src/app/_layout.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: SAMPLE_DATA, message: 'The live app route does not import sample data.' }] },
      ],
    },
  },
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
            { group: SAMPLE_DATA, message: 'Production code does not import sample data.' },
          ],
        },
      ],
    },
  },
  {
    // Tests under domain and data stay platform-free but may use their fixtures.
    files: ['src/domain/**/*.test.{ts,tsx}', 'src/data/**/*.test.{ts,tsx}'],
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

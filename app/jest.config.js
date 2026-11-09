// Jest runs on Linux with no device: pure domain and data tests, plus component tests via jest-expo.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}', '<rootDir>/tests/**/*.test.{ts,tsx}'],
};

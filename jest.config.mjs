// jest.config.mjs
export default {
  preset: 'ts-jest/presets/default-esm', // Use ESM preset
  testEnvironment: 'jsdom', // Changed to jsdom for DOM testing
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      // If you have specific tsconfig for tests, specify here:
      // tsconfig: 'tsconfig.test.json'
    }],
  },
  moduleNameMapper: {
    // This regex ensures that when ts-jest compiles .ts files to .js (in memory or cache),
    // imports like `import ... from '../src/schema.js'` (which Node expects for ESM)
    // correctly map from source code `import ... from '../src/schema';`
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // If your package.json has "type": "module", Jest needs this to treat .ts files as ESM
  extensionsToTreatAsEsm: ['.ts'],
};

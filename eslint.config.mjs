import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['.build/**', 'dist/**', 'node_modules/**', 'native/**', 'licenses/**'] },
  {
    files: ['{bin,src,scripts,test}/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: Object.fromEntries(
        [
          'fetch',
          'process',
          'Buffer',
          'URL',
          'URLSearchParams',
          'AbortSignal',
          'AbortController',
          'setTimeout',
          'clearTimeout',
          'queueMicrotask',
          'ReadableStream',
          'Response',
          '__GOG_DISTRIBUTION__',
        ].map((name) => [name, 'readonly']),
      ),
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': [
        'error',
        { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-constant-condition': 'error',
      'no-console': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['src/**/*.mts', 'test/**/*.mts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  // Fixtures implement asynchronous ports without introducing artificial waits.
  { files: ['test/**/*.mts'], rules: { '@typescript-eslint/require-await': 'off' } },
  // The terminal sanitizer intentionally preserves JavaScript String coercion.
  { files: ['src/output.mts'], rules: { '@typescript-eslint/no-base-to-string': 'off' } },
);

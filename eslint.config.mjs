export default [
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
];

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
  { files: ['src/cli/output.mts'], rules: { '@typescript-eslint/no-base-to-string': 'off' } },
  {
    files: ['src/{domain,application,cli}/**/*.mts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'process',
        'fetch',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'Keep dependencies explicit so module boundaries can be checked.',
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'Receive the current time through an explicit dependency.',
        },
        {
          selector: "MemberExpression[object.name='Date'][property.value='now']",
          message: 'Receive the current time through an explicit dependency.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Receive the current time through an explicit dependency.',
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.mts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\./)',
              message: 'Domain modules depend only on other domain modules.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**/*.mts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\./|\\.\\./domain/|node:)',
              message: 'Application modules depend on domain modules and application ports.',
            },
            {
              group: ['node:*'],
              allowTypeImports: true,
              message: 'Receive host operations through application ports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/adapters/**/*.mts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../cli/**',
                '../../cli/**',
                '../application/service.mjs',
                '../../application/service.mjs',
                '../*.mjs',
                '../../*.mjs',
                '!../runtime-paths.mjs',
                '!../../runtime-paths.mjs',
                '!../version.mjs',
                '!../../version.mjs',
              ],
              message:
                'Adapters implement ports; they do not depend on handlers or compatibility facades.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/cli/**/*.mts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../adapters/**', '../*.mjs', '!../version.mjs'],
              message: 'Receive external operations through handler dependencies.',
            },
            {
              group: ['../application/**'],
              allowTypeImports: true,
              message: 'Receive application operations through typed dependencies.',
            },
            {
              regex: '^node:(?!util$)',
              message: 'CLI modules use host operations through dependencies.',
            },
          ],
        },
      ],
    },
  },
);

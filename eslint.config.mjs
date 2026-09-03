export default [
  {
    // `vscode/` is linted like everything else — it is plain CommonJS, and
    // `sourceType: 'module'` parses it. Only what a package step generates is
    // ignored; there is no compiled output, because the extension is not built.
    ignores: ['reference/**', '**/node_modules/**', 'coverage/**', '**/*.vsix'],
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off',
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];

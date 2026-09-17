export default [
  {
    // `vscode/` is linted like everything else — it is plain CommonJS, and
    // `sourceType: 'module'` parses it. Only what a package step generates is
    // ignored; there is no compiled output, because the extension is not built.
    ignores: [
      'reference/**',
      '**/node_modules/**',
      'coverage/**',
      '.claude/**',
      // The private planning repository — WP-95b. It is a separate git
      // repository mounted here, it carries its own tooling, and it is absent
      // on every machine but a maintainer's. Linting it from the public
      // configuration would fail on the machines that have it and pass on the
      // ones that do not, which is the opposite of a gate.
      'internal/**',
      '**/*.vsix',
      // The documentation site's build output — WP-94c. `site/` itself is
      // linted; `site/dist/` is a copy of it that `node site/build.mjs` writes
      // and `.gitignore` and `.prettierignore` already exclude. Linting it
      // reports every finding twice and reports them against a file nobody
      // edits.
      'site/dist/**',
    ],
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

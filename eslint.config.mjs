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
      '**/docs/media/design/**',
      // The motion mockups' browser-side pages, for the same reason as
      // `design/` above: they are classic scripts loaded over `file://` (no
      // modules, because file:// blocks module CORS), so `var` and globals are
      // the language they are written in rather than a lapse. `render.mjs`
      // beside them is an ordinary module and stays linted.
      '**/docs/media/motion/*.js',
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

const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['node_modules/**', 'data/**', 'uploads/**', 'feedback/**', 'test/fixtures/**'],
  },
  js.configs.recommended,
  {
    // .mjs files are ES modules, not CommonJS. Without this block they fall
    // through to js.configs.recommended alone — no Node globals, no module
    // sourceType — so every `process`/`fetch`/`console` reads as no-undef.
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'warn',
      'no-empty': 'warn',
      'no-constant-condition': 'warn',
      'no-prototype-builtins': 'off',
      'no-control-regex': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module' },
  },
  {
    // lib/dot is a vendored sub-project with its own package.json declaring
    // "type": "module", so its .js files are ES modules. The commonjs block
    // above matches **/*.js and would otherwise fail to parse every one of
    // them ("'import' and 'export' may appear only with sourceType: module"),
    // which is 14 hard errors — enough to fail `npm run lint` and the CI gate.
    files: ['lib/dot/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
  prettier,
];

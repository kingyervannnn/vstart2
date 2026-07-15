import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', 'coverage'] },
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaVersion: 'latest', ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { react, 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-globals': ['error',
        { name: 'alert', message: 'Use an in-app dialog or toast instead of a browser prompt.' },
        { name: 'confirm', message: 'Use an in-app dialog instead of a browser prompt.' },
        { name: 'prompt', message: 'Use an in-app dialog instead of a browser prompt.' },
      ],
      'no-restricted-properties': ['error',
        { object: 'window', property: 'alert', message: 'Use an in-app dialog or toast instead of a browser prompt.' },
        { object: 'window', property: 'confirm', message: 'Use an in-app dialog instead of a browser prompt.' },
        { object: 'window', property: 'prompt', message: 'Use an in-app dialog instead of a browser prompt.' },
      ],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
]

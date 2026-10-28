import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

export default defineConfig([
    ...nextVitals,
    ...nextTs,
    prettier,
    {
        files: ['**/*.js', '**/*.jsx', '**/*.cjs'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
    {
        files: ['**/*.cjs'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: {
                __dirname: 'readonly',
                __filename: 'readonly',
                exports: 'writable',
                global: 'readonly',
                module: 'writable',
                process: 'readonly',
                require: 'readonly',
            },
        },
    },
    {
        files: ['**/*.js', '**/*.jsx', '**/*.cjs'],
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            'no-undef': 'error',
        },
    },
    globalIgnores([
        '.next/**',
        'out/**',
        'build/**',
        'dist/**',
        'coverage/**',
        'test-results/**',
        'playwright-report/**',
        'next-env.d.ts',
    ]),
]);

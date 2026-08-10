import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const runtimeGlobals = {
	...globals.browser,
	...globals.node,
	...globals.serviceworker,
	...globals.worker,
	__SCAPE_PRODUCT__: 'readonly',
};

export default tseslint.config(
	{
		ignores: [
			'.astro/**',
			'.claude/worktrees/**',
			'.desktop-build/**',
			'.wrangler/**',
			'coverage/**',
			'dist/**',
			'node_modules/**',
			'playwright-report/**',
			'release/**',
			'src/common/editor/**/native/**',
			'test-results/**',
		],
	},
	{
		...js.configs.recommended,
		files: ['**/*.{js,jsx,mjs,cjs}'],
		languageOptions: {
			ecmaVersion: 'latest',
			globals: runtimeGlobals,
			parserOptions: {
				ecmaFeatures: { jsx: true },
			},
			sourceType: 'module',
		},
		rules: {
			...js.configs.recommended.rules,
			'no-empty': ['error', { allowEmptyCatch: true }],
			'no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				caughtErrors: 'all',
				caughtErrorsIgnorePattern: '^_',
				ignoreRestSiblings: true,
				varsIgnorePattern: '^_',
			}],
		},
	},
	{
		files: ['**/*.cjs'],
		languageOptions: { sourceType: 'commonjs' },
	},
	...tseslint.configs.recommended.map((config) => ({
		...config,
		files: ['**/*.{cts,mts,ts,tsx}'],
		languageOptions: {
			...config.languageOptions,
			globals: runtimeGlobals,
			parserOptions: {
				...config.languageOptions?.parserOptions,
				ecmaFeatures: { jsx: true },
				project: ['./tsconfig.json', './tsconfig.tests.json'],
				tsconfigRootDir: import.meta.dirname,
			},
		},
	})),
	{
		files: ['**/*.{cts,mts,ts,tsx}'],
		rules: {
			'@typescript-eslint/no-floating-promises': ['error', {
				allowForKnownSafeCalls: [{ from: 'package', name: 'test', package: 'node:test' }],
			}],
			'@typescript-eslint/no-misused-promises': 'error',
			'@typescript-eslint/no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				caughtErrors: 'all',
				caughtErrorsIgnorePattern: '^_',
				ignoreRestSiblings: true,
				varsIgnorePattern: '^_',
			}],
		},
	},
	{
		files: ['**/*.{jsx,tsx}'],
		plugins: {
			'react-hooks': reactHooks,
		},
		rules: {
			'react-hooks/exhaustive-deps': 'error',
			'react-hooks/rules-of-hooks': 'error',
		},
	},
	{
		files: ['src/common/editor/ui/**/*.{ts,tsx}'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector: 'JSXAttribute[name.name=/^(aria-label|aria-description|title|placeholder)$/] > Literal[value=/[A-Za-z]/]',
					message: 'User-visible and accessible text must come from the localization catalog.',
				},
				{
					selector: 'JSXElement > JSXText[value=/[A-Za-z]/]',
					message: 'User-visible JSX text must come from the localization catalog.',
				},
				{
					selector: "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(setAttribute|removeAttribute|appendChild|insertBefore|replaceChildren)$/]",
					message: 'Wrap vendor DOM adaptation in a typed adapter component instead of mutating it from feature code.',
				},
			],
		},
	},
);

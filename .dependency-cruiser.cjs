/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: 'no-circular',
			comment: 'Cycles hide initialization order and make AI-assisted changes harder to bound.',
			severity: 'error',
			from: {},
			to: { circular: true },
		},
		{
			name: 'editor-core-does-not-import-ui',
			comment: 'Editor core modules must stay independent of React presentation modules.',
			severity: 'error',
			from: { path: '^src/common/editor/(?!ui/)' },
			to: { path: '^src/common/editor/ui/' },
		},
		{
			name: 'editor-implementation-does-not-import-facade',
			comment: 'Internal editor modules use narrow implementation imports; the curated facade is for external consumers.',
			severity: 'error',
			from: { path: '^src/common/editor/(?!(?:index\\.js|facade\\.ts)$)' },
			to: { path: '^src/common/editor/(?:index\\.js|facade\\.ts)$' },
		},
		{
			name: 'production-does-not-import-tests',
			comment: 'Production code must not depend on test fixtures or browser harnesses.',
			severity: 'error',
			from: { path: '^src/' },
			to: { path: '^tests/' },
		},
	],
	options: {
		doNotFollow: {
			path: 'node_modules|^vendor/',
			dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'npm-no-pkg'],
		},
		tsConfig: { fileName: 'tsconfig.json' },
	},
};

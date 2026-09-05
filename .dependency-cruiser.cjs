/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: 'no-circular',
			comment: 'Cycles hide initialization order and make AI-assisted changes harder to bound. '
				+ 'A cycle is an initialization-order hazard only when every edge in it survives '
				+ 'compilation, so `viaOnly` excludes any cycle that passes through an `import '
				+ 'type` edge: that edge is erased, the ring is open at runtime, and there is no '
				+ 'order to hide. This keeps exactly the coverage the rule had before '
				+ '`tsPreCompilationDeps` was set - it caught no type-only cycle then because it '
				+ 'could see none - while the layering rules below now do see those edges. The '
				+ 'moment a type-only edge in such a ring is changed to a value import, the ring '
				+ 'closes and this rule fires.',
			severity: 'error',
			from: {},
			to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
		},
		{
			name: 'editor-core-does-not-import-ui',
			comment: 'Editor core modules must stay independent of React presentation modules. '
				+ 'With `tsPreCompilationDeps` set this now covers `import type` as well, which is '
				+ 'the half that had gone wrong: the assistance vocabulary lived in ui/ and '
				+ 'controller/ read it across sixteen type-only edges while this rule stayed green.',
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
		// Without this, dependency-cruiser's tsc extractor never runs, so an `import type`
		// edge is invisible to every rule above. `editor-core-does-not-import-ui` is
		// severity error and sat green for the whole time controller/ read the assistance
		// vocabulary out of ui/ across sixteen type-only edges, and `no-circular` cannot
		// see a type-level cycle at all -- which is the shape a value cycle arrives as one
		// edit before it becomes real.
		tsPreCompilationDeps: true,
	},
};

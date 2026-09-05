/**
 * The shared desktop modules browser code is allowed to read.
 *
 * `desktop/` is not only the main process: it is also where the renderer/main
 * contracts and the bundled stream parsers live, and browser code genuinely reads
 * both. Nine modules under `src/common/editor` import eight modules under
 * `desktop/`, and the allow-list is written out so that a tenth is a decision
 * someone makes rather than one that happens.
 *
 * Two kinds are named here, and they are not the same claim:
 *
 * - `desktop-*-contract.ts` are the codec capability and operation contracts. Both
 *   sides of the IPC boundary must agree on them by construction, so a shared
 *   declaration is the point of the module and reading it from `src/` is correct.
 * - `bundled-*-stream.ts` are the container parsers the packaged app ships. They are
 *   shared *implementation*, not contract: `browser-dedicated-audio-codec.ts` runs
 *   the same parser inside the dedicated audio worker so the browser and the desktop
 *   build agree byte for byte on what a file contains. That is a deliberate reuse
 *   and it is allowed, but it is the entry that should move into `src/common/` if
 *   this list is ever tidied - not the contracts.
 *
 * Everything else under `desktop/` is off limits to `src/`, which is what keeps the
 * main-process half of the directory from being reachable from a renderer by
 * accident.
 */
const SHARED_DESKTOP_CONTRACTS = [
	'^desktop/desktop-audio-codec-capability-contract\\.ts$',
	'^desktop/desktop-audio-codec-operation-contract\\.ts$',
	'^desktop/desktop-video-codec-operation-contract\\.ts$',
	'^desktop/bundled-flac-stream\\.ts$',
	'^desktop/bundled-mpeg-audio-stream\\.ts$',
	'^desktop/bundled-opus-stream\\.ts$',
	'^desktop/bundled-vorbis-stream\\.ts$',
	'^desktop/bundled-wavpack-stream\\.ts$',
];

/**
 * The `desktop/` modules that exist only inside the Electron main or preload context.
 *
 * The definition is mechanical rather than editorial: these are the modules that
 * import `electron` or `electron/main`, which is what makes them unloadable from a
 * page. `renderer-does-not-import-electron` keeps the list honest from the other
 * side - a module the allow-list above lets `src/` read cannot acquire an electron
 * import without failing the cruise - so the two rules together mean this list
 * cannot silently fall behind the tree.
 */
const DESKTOP_MAIN_PROCESS_ONLY = [
	'^desktop/assistance-registration\\.mjs$',
	'^desktop/external-display-sink-preload\\.cjs$',
	'^desktop/framescaper-capture-sandbox-preload\\.ts$',
	'^desktop/framescaper-native-media-electron-runtime\\.mjs$',
	'^desktop/framescaper-native-services-electron-ports\\.mjs$',
	'^desktop/framescaper-openfx-electron-runtime\\.mjs$',
	'^desktop/framescaper-web-vcr-sandbox-preload\\.ts$',
	'^desktop/helper-registration\\.mjs$',
	'^desktop/host-affordances\\.mjs$',
	'^desktop/main\\.mjs$',
	'^desktop/native-helper-registration\\.mjs$',
	'^desktop/nightly-tests-main\\.mjs$',
	'^desktop/plugin-hosting-runtime\\.mjs$',
	'^desktop/plugin-registration\\.mjs$',
	'^desktop/preload\\.mjs$',
	'^desktop/soundscaper-project-library-sandbox-preload\\.ts$',
];

/** Both the bare `electron` package and the unresolvable `electron/main` subpath. */
const ELECTRON = '(?:^|/)electron(?:/|$)';

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
				+ 'controller/ read it across sixteen type-only edges while this rule stayed green. '
				+ 'desktop/ and native/ are held to it too: neither is presentation, and a main '
				+ 'process module that names a React module cannot be loaded where it runs.',
			severity: 'error',
			from: { path: '^(?:src/common/editor/(?!ui/)|desktop/|native/)' },
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
			comment: 'Production code must not depend on test fixtures or browser harnesses. '
				+ 'The desktop shell and the native helpers are production too, so they are held '
				+ 'to it as well.',
			severity: 'error',
			from: { path: '^(?:src|desktop|native)/' },
			to: { path: '^tests/' },
		},
		{
			name: 'src-imports-only-shared-desktop-contracts',
			comment: 'Browser code may read the renderer/main contracts and the bundled stream '
				+ 'parsers listed at the top of this file, and nothing else under desktop/. The '
				+ 'directory is half shared contract and half Electron main process, and until '
				+ 'this rule existed nothing said which half a src/ module had reached into.',
			severity: 'error',
			from: { path: '^src/' },
			to: { path: '^desktop/', pathNot: SHARED_DESKTOP_CONTRACTS },
		},
		{
			name: 'src-does-not-import-desktop-main-process',
			comment: 'A renderer that reaches a main-process-only module fails at load, in the '
				+ 'packaged app, on whichever surface happened to import it - which is the class '
				+ 'of defect scripts/lib/desktop-renderer-product-isolation.mjs was written to '
				+ 'catch after the bundle was already built. These are the desktop modules that '
				+ 'import electron, so they exist only inside the main or preload context.',
			severity: 'error',
			from: { path: '^src/' },
			to: { path: DESKTOP_MAIN_PROCESS_ONLY },
		},
		{
			name: 'renderer-does-not-import-electron',
			comment: 'Nothing under src/ runs in the Electron main process, so nothing under src/ '
				+ 'may name electron. This is also what keeps the main-process module list above '
				+ 'from falling behind the tree: a shared desktop contract that acquires an '
				+ 'electron import stops being loadable from a page, and the cruise says so.',
			severity: 'error',
			from: { path: '^src/' },
			to: { path: ELECTRON },
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

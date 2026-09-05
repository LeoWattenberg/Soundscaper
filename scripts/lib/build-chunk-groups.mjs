/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which built chunk owns which source module.
 *
 * The groups are semantic: a reader should be able to say what is in a chunk
 * from its name. They are also load-order contracts, which is the part that is
 * easy to lose. A module with no owner is placed by reachability, so a leaf that
 * only a lazily imported dialog reaches is put inside that dialog's chunk - even
 * when eagerly loaded shell code imports it too. The shell then statically
 * imports the dialog chunk, the dialog chunk initializes during the shell's own
 * import, and it calls back into a shell binding that does not exist yet. The
 * editor fails to mount with a bare "y is not a function", far from the module
 * that actually moved.
 *
 * So every shared flat editor domain module and every shared assistance-domain
 * module has an owner here. Single-owner optional feature modules are the
 * deliberate exception: reachability keeps them behind their dynamic entry.
 *
 * `tests/audio-editor-build-chunk-ownership.test.ts` keeps it that way.
 */

import {
	DESIGN_SYSTEM_EDITOR_SHELL_COMPONENT_CHUNK_TEST,
	EDITOR_ASSISTANCE_SEMANTIC_SEARCH_RUNTIME_CHUNK_TEST,
	EDITOR_CODEC_FOUNDATION_CHUNK_TEST,
	EDITOR_COPY_CHUNK_TEST,
	EDITOR_DOMAIN_CHUNK_TEST,
	EDITOR_EFFECT_CONTRACT_CHUNK_TEST,
	EDITOR_EFFECT_DIALOG_SHELL_CHUNK_TEST,
	EDITOR_EFFECT_PARAMETER_SURFACE_CHUNK_TEST,
	EDITOR_OPTIONAL_ASSISTANCE_CHUNK_TEST,
	EDITOR_OPTIONAL_CAPTURE_CHUNK_TEST,
	EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST,
	EDITOR_OPTIONAL_EXPORT_CHUNK_TEST,
	EDITOR_OPTIONAL_SPLIT_TOOL_CHUNK_TEST,
	EDITOR_OPTIONAL_SURFACE_CHUNK_TEST,
	EDITOR_PFFFT_RUNTIME_CHUNK_TEST,
	EDITOR_PRODUCTION_METER_CHUNK_TEST,
	EDITOR_SELECTION_EFFECTS_RUNTIME_CHUNK_TEST,
	FRAMESCAPER_PROJECT_COMMAND_CHUNK_TEST,
	FRAMESCAPER_PROJECT_FOUNDATION_CHUNK_TEST,
	FRAMESCAPER_SESSION_CLIPBOARD_CHUNK_TEST,
	FRAMESCAPER_TIMELINE_IMAGE_CHUNK_TEST,
	PROJECT_INTERCHANGE_FOUNDATION_CHUNK_TEST,
	SOUNDSCAPER_PROJECT_FOUNDATION_CHUNK_TEST,
	editorOptionalAssistanceModule,
	editorOptionalCaptureControllerModule,
	editorOptionalControllerModule,
	editorOptionalSurfaceModule,
	editorPath,
} from './build-chunk-tests.mjs';

// The membership patterns keep their long-standing import site.
export {
	EDITOR_DOMAIN_CHUNK_TEST,
	EDITOR_EFFECT_DIALOG_SHELL_CHUNK_TEST,
	EDITOR_EFFECT_PARAMETER_SURFACE_CHUNK_TEST,
	EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST,
	EDITOR_OPTIONAL_ASSISTANCE_CHUNK_TEST,
	EDITOR_OPTIONAL_CAPTURE_CHUNK_TEST,
	EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST,
	EDITOR_OPTIONAL_EXPORT_CHUNK_TEST,
	EDITOR_OPTIONAL_SPLIT_TOOL_CHUNK_TEST,
	EDITOR_OPTIONAL_SURFACE_CHUNK_TEST,
	EDITOR_PFFFT_RUNTIME_CHUNK_TEST,
	EDITOR_PRODUCTION_METER_CHUNK_TEST,
	EDITOR_SELECTION_EFFECTS_RUNTIME_CHUNK_TEST,
	FRAMESCAPER_PROJECT_COMMAND_CHUNK_TEST,
	FRAMESCAPER_TIMELINE_IMAGE_CHUNK_TEST,
	PROJECT_INTERCHANGE_FOUNDATION_CHUNK_TEST,
} from './build-chunk-tests.mjs';

/** @type {import('rolldown').CodeSplittingGroup[]} */
export const chunkGroups = [
	{
		name: 'vendor-mediabunny',
		test: /node_modules[\\/]mediabunny[\\/]/,
		priority: 101,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'vendor-react',
		test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
		priority: 100,
		maxSize: 400_000,
	},
	{
		name: 'vendor-design-system',
		test: /(?:^|[\\/])vendor[\\/]audacity-design-system[\\/](?:core[\\/]src|tokens[\\/]src|components[\\/]src[\\/](?:ThemeProvider|contexts|hooks|utils|constants\.ts|assets[\\/]fonts))/,
		priority: 95,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Components used by the ready editor shell belong to that consumer. Components
		// reached only by a lazy dialog remain unowned and follow the dialog instead of
		// being hoisted into a broad shared vendor chunk.
		name: 'editor-shell-design-components',
		test: DESIGN_SYSTEM_EDITOR_SHELL_COMPONENT_CHUNK_TEST,
		priority: 94,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Keep the shared FFT leaf out of the broader execution group. A dynamic
		// spectrogram import must not evaluate every unrelated effect/export entry.
		name: 'editor-pffft-runtime',
		test: EDITOR_PFFFT_RUNTIME_CHUNK_TEST,
		priority: 99,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// The selection dispatcher imports Audacity and spectral implementations.
		// Keep it out of their broader owner so its lazy facade cannot import itself.
		name: 'editor-selection-effects-runtime',
		test: EDITOR_SELECTION_EFFECTS_RUNTIME_CHUNK_TEST,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Indexed search opens from a tiny shell facade. Its custody and strict bridge
		// remain a distinct dynamic owner even while other assistance surfaces are shared.
		name: 'editor-assistance-semantic-search-runtime',
		test: EDITOR_ASSISTANCE_SEMANTIC_SEARCH_RUNTIME_CHUNK_TEST,
		priority: 99,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Dependency-closed interchange leaves shared by editors and transfer pages.
		// Deliberately not named `editor-`: these contracts belong to both worlds.
		name: 'project-interchange-foundations',
		test: PROJECT_INTERCHANGE_FOUNDATION_CHUNK_TEST,
		priority: 99,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// These engine helpers are also typed by product UI. An explicit owner keeps
		// Rolldown from placing them inside a selected product bootstrap and making
		// the engine import its own importer during standalone transfer-page startup.
		name: 'editor-production-meter',
		test: EDITOR_PRODUCTION_METER_CHUNK_TEST,
		priority: 91,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-optional-execution',
		test: EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST,
		priority: 93,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// The product bootstrap and eager editor controller both read the complete
		// catalog. Give that dependency closure a shared owner instead of letting a
		// product bootstrap absorb it and making the editor import its own importer.
		// The small site-only catalog remains in the static entry graph.
		name: 'editor-copy',
		test: EDITOR_COPY_CHUNK_TEST,
		priority: 97,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-optional-export',
		test: EDITOR_OPTIONAL_EXPORT_CHUNK_TEST,
		priority: 93,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-optional-capture',
		test: EDITOR_OPTIONAL_CAPTURE_CHUNK_TEST,
		priority: 93,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-optional-assistance',
		test: EDITOR_OPTIONAL_ASSISTANCE_CHUNK_TEST,
		priority: 93,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-optional-split-tool',
		test: EDITOR_OPTIONAL_SPLIT_TOOL_CHUNK_TEST,
		priority: 93,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Co-locate the rack consumer and its optional design-system shell. Splitting
		// these source-acyclic modules makes Rolldown emit a three-chunk init cycle.
		name: 'editor-effect-dialog-shell',
		test: EDITOR_EFFECT_DIALOG_SHELL_CHUNK_TEST,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// These three modules form one shared leaf for the rack, macro, and
		// selection dialogs. Splitting the leaf creates a generated self-import.
		name: 'editor-effect-parameter-surfaces',
		test: EDITOR_EFFECT_PARAMETER_SURFACE_CHUNK_TEST,
		priority: 98,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-optional-surfaces',
		test: EDITOR_OPTIONAL_SURFACE_CHUNK_TEST,
		priority: 92,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-codec-foundations',
		test: EDITOR_CODEC_FOUNDATION_CHUNK_TEST,
		priority: 98,
		maxSize: 490_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-effect-contracts',
		test: EDITOR_EFFECT_CONTRACT_CHUNK_TEST,
		priority: 98,
		maxSize: 490_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'soundscaper-project-foundations',
		test: SOUNDSCAPER_PROJECT_FOUNDATION_CHUNK_TEST,
		priority: 98,
		maxSize: 490_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'framescaper-project-foundations',
		test: FRAMESCAPER_PROJECT_FOUNDATION_CHUNK_TEST,
		priority: 98,
		maxSize: 490_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'framescaper-project-commands',
		test: FRAMESCAPER_PROJECT_COMMAND_CHUNK_TEST,
		priority: 98,
		minSize: 0,
		maxSize: 490_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'framescaper-session-clipboard',
		test: FRAMESCAPER_SESSION_CLIPBOARD_CHUNK_TEST,
		priority: 98,
		maxSize: 490_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-engine',
		test: new RegExp(`${editorPath}(?:engine(?:\\.js|[\\\\/])|recording(?:\\.js|[\\\\/])|playback-meter\\.js)`),
		priority: 90,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-storage-model',
		test: new RegExp(`${editorPath}(?:storage(?:\\.js|[\\\\/])|project(?:-[^\\\\/]+)?\\.js|migration\\.js|retention\\.js|history\\.js|session\\.js|stable-id\\.js|preferences\\.js)`),
		priority: 85,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-timeline',
		test: new RegExp(`${editorPath}(?:ui[\\\\/](?:AudioEditorTimeline|AudioEditorSampleTools)|audacity-waveform-renderer\\.js)`),
		priority: 80,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-controller-core',
		test: new RegExp(`${editorPath}(?!controller[\\\\/](?:${editorOptionalControllerModule}|${editorOptionalAssistanceModule}|${editorOptionalCaptureControllerModule})\\.ts$)(?:app\\.js|controller[\\\\/]|commands(?:\\.js|[\\\\/])|facade\\.ts|index\\.js)`),
		priority: 75,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-shell',
		test: new RegExp(`(?:${editorPath}(?!${editorOptionalSurfaceModule}$)ui[\\\\/](?!(?:dialogs[\\\\/](?!editor-dialog-model\\.js$)|inspector[\\\\/]))|src[\\\\/]common[\\\\/](?:products\\.js|url\\.ts)$|src[\\\\/]soundscaper[\\\\/](?:editor-capture-toolbar-control|editor-framescaper-overlay-model|editor-video-preview-product-runtime|editor-application-menu-product-runtime|editor-workspace-application-menu-runtime|editor-workspace-panel-runtime)\\.(?:js|tsx?)$|src[\\\\/]framescaper[\\\\/]editor-soundscaper-workflow-product-runtime\\.tsx$)`),
		priority: 70,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// The schema, planners, assistance domain, and value tables the shell and dialogs share.
		// They are owned here rather than placed by reachability; see the module
		// comment for what an unowned shared leaf does to the boot path.
		name: 'editor-domain',
		test: EDITOR_DOMAIN_CHUNK_TEST,
		priority: 65,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Image import, body custody, clipboard, preview, and export form one optional
		// Framescaper feature slice. Keep it out of the selected bootstrap chunk while
		// preserving one semantic owner for modules shared by its menu-opened surfaces.
		name: 'framescaper-timeline-images',
		test: FRAMESCAPER_TIMELINE_IMAGE_CHUNK_TEST,
		priority: 64,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'vendor',
		test: /node_modules[\\/](?!(?:@zip\.js[\\/]zip\.js|@echogarden[\\/]pffft-wasm|@ffmpeg[\\/]ffmpeg)[\\/])/,
		priority: 60,
		maxSize: 400_000,
	},
	{
		// Own only the HTML/main/site entry role. Editor and product modules retain
		// their semantic owners even when they sit in the selected startup graph.
		name: 'site-entry',
		tags: ['$initial'],
		priority: 110,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
];

/** Saxes and the XML character tables it imports inside maintained workers. */
export const WORKER_XML_VENDOR_CHUNK_TEST = /node_modules[\\/](?:saxes|xmlchars)[\\/]/;

/** @type {import('rolldown').CodeSplittingGroup[]} */
export const workerChunkGroups = [
	{
		name: 'vendor-sqlite-worker',
		test: /node_modules[\\/]@sqlite\.org[\\/]sqlite-wasm[\\/]/,
		priority: 100,
		maxSize: 400_000,
	},
	{
		// Keep the parser and its character tables under one explicit owner instead
		// of placing either by reachability. Non-recursive ownership keeps future
		// dependency growth from silently broadening this worker vendor surface.
		name: 'vendor-xml-worker',
		test: WORKER_XML_VENDOR_CHUNK_TEST,
		priority: 99,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
];

/**
 * The group that claims one repository-relative module path, or null.
 *
 * `$initial`-tagged groups match by build role rather than by path, so they
 * claim nothing here: a module they would catch is one this answer deliberately
 * leaves unowned.
 */
export function chunkGroupForModulePath(path) {
	const candidates = chunkGroups
		.filter((group) => group.test instanceof RegExp && group.test.test(path))
		.sort((left, right) => right.priority - left.priority);
	return candidates[0]?.name ?? null;
}

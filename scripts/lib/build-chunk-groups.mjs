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

const editorPath = String.raw`src[\\/]common[\\/]editor[\\/]`;
const editorOptionalArchiveModule = String.raw`(?:aup-legacy(?:-block-budget|-conversion|-xml)?|aup4-(?:client|opaque-persistence|profile|sanitization)|audacity-(?:annotation-interchange|tempo-import)|scape-(?:archive-copy|archive-manifest|archive-reader|export-destination|import-transaction|project-source-remap)|scape-project)`;

/** Archive/interchange implementation modules owned only by lazy file-menu actions. */
export const EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST = new RegExp(
	`${editorPath}${editorOptionalArchiveModule}\\.(?:[cm]?[jt]s)$`,
);

/** Flat editor modules and `assistance/` domain modules shared by the shell and dialogs. */
export const EDITOR_DOMAIN_CHUNK_TEST = new RegExp(
	`${editorPath}(?!${editorOptionalArchiveModule}\\.(?:[cm]?[jt]s)$)(?:[^\\\\/]+|assistance[\\\\/][^\\\\/]+)\\.(?:[cm]?[jt]s)$`,
);

/** @type {import('rolldown').CodeSplittingGroup[]} */
export const chunkGroups = [
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
		// Exact app imports decide which components enter the graph. Once selected,
		// keep their implementation and CSS together instead of emitting one request
		// per shared component reached by both the shell and lazy dialogs.
		name: 'vendor-design-system-components',
		test: /(?:^|[\\/])vendor[\\/]audacity-design-system[\\/]components[\\/]src[\\/](?!(?:ThemeProvider|contexts|hooks|utils|constants\.ts|assets[\\/]fonts)(?:[\\/]|$))/,
		priority: 94,
		maxSize: 400_000,
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
		test: new RegExp(`${editorPath}(?:ui[\\\\/](?:AudioEditorTimeline|AudioEditorSampleTools)|video-timeline\\.js|audacity-waveform-renderer\\.js)`),
		priority: 80,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-controller-core',
		test: new RegExp(`${editorPath}(?:app\\.js|controller[\\\\/]|commands(?:\\.js|[\\\\/])|facade\\.ts|index\\.js)`),
		priority: 75,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-shell',
		test: new RegExp(`${editorPath}ui[\\\\/](?!(?:dialogs|inspector)[\\\\/])`),
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
		test: /src[\\/]framescaper[\\/](?:editor-(?:image-(?:import-coordinator|placement)-v32|project-v32-image-command|selected-v32-image|session-clipboard-v13|timeline-image)|video-export-image-)/,
		priority: 64,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'vendor',
		test: /node_modules[\\/](?!@zip\.js[\\/]zip\.js[\\/])/,
		priority: 60,
		maxSize: 400_000,
	},
	{
		name: 'application',
		tags: ['$initial'],
		priority: 10,
		maxSize: 400_000,
	},
];

/** @type {import('rolldown').CodeSplittingGroup[]} */
export const workerChunkGroups = [
	{
		name: 'vendor-sqlite-worker',
		test: /node_modules[\\/]@sqlite\.org[\\/]sqlite-wasm[\\/]/,
		priority: 100,
		maxSize: 400_000,
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

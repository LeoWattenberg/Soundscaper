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
const editorOptionalArchiveModule = String.raw`(?:aup-legacy(?:-block-budget|-conversion|-xml)?|aup4-(?:client|opaque-persistence|profile|sanitization)|audacity-(?:annotation-interchange|tempo-import)|scape-(?:archive-(?:copy|layout(?:-witness)?|manifest|reader)|export-destination|import-transaction|project-source-remap)|scape-project)`;
const editorOptionalExecutionModule = String.raw`(?:analysis|pffft|selection-effects-runtime|spectral-edit(?:-admission)?)`;
const editorOptionalExportControllerModule = String.raw`(?:audio-export-render-orchestration|audio-realtime-encoded-export|audio-rendered-fallback-export|delivery-conformance-action|desktop-audio-export-capability|direct-(?:aiff-export|audio-render-plan|broadcast-wave-export|bw64-export|bwf-export|compressed-export|compressed-plan|compressed-stem-archive-plan|export-dispatch|mp3-export|native-stem-archive-plan|offline-compressed-export|offline-pcm-export|pcm-export|stem-archive-export|video-export|video-plan-contract|wav-export)|export-render-project|export-service|realtime-export-pcm-transform|rendered-audio-encoding|video-export-service|video-rendered-fallback-export)`;
const editorOptionalControllerModule = String.raw`(?:analysis-service|${editorOptionalExportControllerModule})`;
const editorOptionalAssistanceModule = String.raw`(?:local-assistance-runtime|local-assistance-(?:selected-media|selected-video|selected-preparation|selected-media-router|result-acceptance|cleanup-workflow|cleanup-acceptance|range-label-acceptance|shot-acceptance|transcript-acceptance))`;
const editorOptionalSurfaceModule = String.raw`ui[\\/](?:AudacityEffectLayout\.jsx|ParametricEqEditor\.jsx|SoundActivationPreferences\.tsx|VideoDeliveryFields\.jsx|desktop-export-codec-model\.ts|export-(?:dialog-audio-codec-options\.ts|dialog-model\.js|preset-model\.ts)|framescaper-native-services-dialog-model\.ts|framescaper-v27-(?:caption-file-interchange|finishing-dialog-model|visual-inspector-model)\.ts|local-assistance-(?:cleanup|preparation|session-store)\.ts|local-model-manager-store\.ts|soundscaper-(?:production-dialog-model|routing-editor-model)\.ts|video-keyframe-(?:curve-transfer|dialog-model)\.ts|workspace[\\/](?:FramescaperCaptureSources|RecordingSetupPanel|WebVcrPanel|WebVcrPreview)\.tsx)`;

/** Archive/interchange implementation modules owned only by lazy file-menu actions. */
export const EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST = new RegExp(
	`${editorPath}${editorOptionalArchiveModule}\\.(?:[cm]?[jt]s)$`,
);

/** Shared FFT runtime loaded by spectrogram and selection-effect consumers. */
export const EDITOR_PFFFT_RUNTIME_CHUNK_TEST = new RegExp(
	`${editorPath}pffft\\.js$`,
);

/** Selection dispatcher and its destructive parametric-EQ implementation. */
export const EDITOR_SELECTION_EFFECTS_RUNTIME_CHUNK_TEST = new RegExp(
	`${editorPath}(?:selection-effects-runtime|parametric-eq[\\/]destructive)\\.js$`,
);

/** Effect and Analyze implementations reached only after their eager action facade runs. */
export const EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST = new RegExp(
	`${editorPath}(?:${editorOptionalExecutionModule}\\.(?:[cm]?[jt]s)|controller[\\\\/]analysis-service\\.ts)$`,
);

/** Audio and video delivery execution isolated from the effect-runtime graph. */
export const EDITOR_OPTIONAL_EXPORT_CHUNK_TEST = new RegExp(
	`${editorPath}controller[\\\\/]${editorOptionalExportControllerModule}\\.ts$`,
);

/** Stateful assistance workflows loaded only after their menu-owned dialog is invoked. */
export const EDITOR_OPTIONAL_ASSISTANCE_CHUNK_TEST = new RegExp(
	`${editorPath}(?:controller[\\/]${editorOptionalAssistanceModule}|assistance[\\/](?:disfluency|transcript-body-publication-v1|transcript-labels|vad-silence))\\.ts$`,
);

/** Menu-opened UI implementations that remain behind existing React.lazy surfaces. */
export const EDITOR_OPTIONAL_SURFACE_CHUNK_TEST = new RegExp(
	`${editorPath}${editorOptionalSurfaceModule}$`,
);

/** Shared parameter editor plus its Audacity and parametric-EQ surface implementations. */
export const EDITOR_EFFECT_PARAMETER_SURFACE_CHUNK_TEST = new RegExp(
	`${editorPath}ui[\\/](?:AudacityEffectLayout|ParametricEqEditor|inspector[\\/]EffectParameterEditor)\\.jsx$`,
);

const DESIGN_SYSTEM_OPTIONAL_EFFECTS_CHUNK_TEST = /(?:^|[\\/])vendor[\\/]audacity-design-system[\\/]components[\\/]src[\\/](?:EffectsPanel[\\/].*|EffectDialog[\\/]EffectHeader\.tsx)$/;
const DESIGN_SYSTEM_EDITOR_SHELL_COMPONENT_CHUNK_TEST = /(?:^|[\\/])vendor[\\/]audacity-design-system[\\/]components[\\/]src[\\/](?:AddTrackFlyout|ApplicationHeader|Button|Checkbox|Clip|ClipBody|ClipHeader|CloudProjectIndicator|ContextMenu|ContextMenuItem|DialogHeader|Dropdown|EnvelopeCurve|EnvelopeInteractionLayer|EnvelopeOverlay|EnvelopePoint|Flyout|GhostButton|Icon|Knob|LabelMarker|LabeledCheckbox|LabeledRadio|MidiClipBody|MixerChannel|MixerEffect|MixerFader|MixerFaderHandle|MixerPanel|NumberStepper|PanKnob|PanelHeader|PlayheadCursor|Radio|RulerFlyout|SelectionToolbar|Separator|Slider|TextInput|TimeCode|TimelineRuler|TimelineRulerContextMenu|ToggleButton|ToggleToolButton|ToolButton|Toolbar|Tooltip|Track|TrackControlPanel|TrackMeter|TransportButton|VerticalRuler)[\\/]/;
const EDITOR_CODEC_FOUNDATION_CHUNK_TEST = /src[\\/]common[\\/]editor[\\/](?:wavpack[\\/]|staffpad[\\/]|parametric-eq[\\/](?:parameters|design|wasm-runtime|wasm-loader)\.js$)/;
const EDITOR_EFFECT_CONTRACT_CHUNK_TEST = /(?:src[\\/]common[\\/](?:i18n[\\/]action-parity\.js|editor[\\/](?:audacity-effects[\\/](?:contracts|live-capabilities)\.js|nyquist[\\/]plugin-registry\.js|reviewed-effects[\\/](?:errors|manifest|selection-effect-contract|utility-gain-package)\.ts)))$/;
const framescaperProjectFoundationModule = String.raw`(?:editor-video-proxy-action-runtime-v20|editor-native-openfx-authoring-model-v28|editor-selected-v27-authoring-controller|editor-project-(?:v(?:28|32)|v(?:25|28|31|32)-foundation|feature-requirements-v(?:25|26|28|32)|feature-capability-profile-v(?:25|26|28|32)|storage-profile-v(?:25|26|28|32)|runtime-profile-v(?:25|26|28|32)(?:-prerequisite)?|v(?:25|28|32)-validation|v28-openfx-validation))`;
const FRAMESCAPER_PROJECT_FOUNDATION_CHUNK_TEST = new RegExp(
	`src[\\\\/]framescaper[\\\\/]${framescaperProjectFoundationModule}\\.ts$`,
);
const FRAMESCAPER_SESSION_CLIPBOARD_CHUNK_TEST = /src[\\/]framescaper[\\/]editor-session-clipboard-v(?:8|11(?:-(?:controller|selection))?)\.ts$/;


/** Flat editor modules and `assistance/` domain modules shared by the shell and dialogs. */
export const EDITOR_DOMAIN_CHUNK_TEST = new RegExp(
	`${editorPath}(?!${editorOptionalArchiveModule}\\.(?:[cm]?[jt]s)$)(?!${editorOptionalExecutionModule}\\.(?:[cm]?[jt]s)$)(?:[^\\\\/]+|assistance[\\\\/][^\\\\/]+)\\.(?:[cm]?[jt]s)$`,
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
		name: 'editor-optional-execution',
		test: EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST,
		priority: 93,
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
		name: 'editor-optional-assistance',
		test: EDITOR_OPTIONAL_ASSISTANCE_CHUNK_TEST,
		priority: 93,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'vendor-optional-effects',
		test: DESIGN_SYSTEM_OPTIONAL_EFFECTS_CHUNK_TEST,
		priority: 93,
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
		name: 'framescaper-project-foundations',
		test: FRAMESCAPER_PROJECT_FOUNDATION_CHUNK_TEST,
		priority: 98,
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
		test: new RegExp(`${editorPath}(?:ui[\\\\/](?:AudioEditorTimeline|AudioEditorSampleTools)|video-timeline\\.js|audacity-waveform-renderer\\.js)`),
		priority: 80,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-controller-core',
		test: new RegExp(`${editorPath}(?!controller[\\\\/](?:${editorOptionalControllerModule}|${editorOptionalAssistanceModule})\\.ts$)(?:app\\.js|controller[\\\\/]|commands(?:\\.js|[\\\\/])|facade\\.ts|index\\.js)`),
		priority: 75,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'editor-shell',
		test: new RegExp(`${editorPath}(?!${editorOptionalSurfaceModule}$)ui[\\\\/](?!(?:dialogs|inspector)[\\\\/])`),
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

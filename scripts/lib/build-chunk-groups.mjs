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
const editorOptionalArchiveModule = String.raw`(?:aup-legacy(?:-block-budget|-conversion|-xml)?|aup4-(?:client|opaque-persistence|profile|sanitization)|audacity-(?:annotation-interchange|tempo-import)|scape-(?:archive-(?:copy|layout(?:-witness)?|manifest|reader)|export-destination|import-transaction|project-source-remap)|scape-project(?:-canonical-inspection)?)`;
const editorOptionalExecutionModule = String.raw`(?:analysis|browser-(?:dedicated-audio-worker-client|webcodecs-aac)|pffft|selection-effects-runtime|spectral-edit(?:-admission)?|video-(?:keyframe-mediabunny-execution|mediabunny-muxer))`;
const editorOptionalExportControllerModule = String.raw`(?:audio-export-render-orchestration|audio-realtime-encoded-export|audio-rendered-fallback-export|delivery-conformance-action|desktop-audio-export-capability|direct-(?:aiff-export|audio-render-plan|broadcast-wave-export|bw64-export|bwf-export|compressed-export|compressed-plan|compressed-stem-archive-plan|export-dispatch|mp3-export|native-stem-archive-plan|offline-compressed-export|offline-pcm-export|pcm-export|stem-archive-export|video-export|video-plan-contract|wav-export)|export-render-project|export-service|realtime-export-pcm-transform|rendered-audio-encoding|video-export-service|video-rendered-fallback-export)`;
const editorOptionalControllerModule = String.raw`(?:analysis-service|cross-product-handoff-action|${editorOptionalExportControllerModule})`;
const editorOptionalAssistanceModule = String.raw`local-assistance-[^\\/]+`;
/**
 * Assistance domain modules the eagerly loaded shell and controller genuinely share.
 *
 * Everything else under `assistance/` belongs to the lazy assistance owner. The
 * default has to be lazy: an eagerly owned module that imports one lazy sibling
 * makes the whole optional assistance chunk a static dependency of the shell, and
 * the product-ready startup graph blows its byte budget for a feature the user
 * has not opened. Adding a name here is a deliberate claim that eager code reads it.
 */
const editorEagerAssistanceModule = String.raw`(?:assistance-asset-command-v1|assistance-asset-reference-v1|operation|shots|transcript|transcript-scape-asset-extension-v1)`;
const editorOptionalSurfaceModule = String.raw`ui[\\/](?:AudacityEffectLayout\.jsx|ParametricEqEditor\.jsx|SoundActivationPreferences\.tsx|VideoDeliveryFields\.jsx|desktop-export-codec-model\.ts|export-(?:dialog-audio-codec-options\.ts|dialog-model\.js|preset-model\.ts)|framescaper-(?:caption-file-interchange|finishing-dialog-model|native-services-dialog-model|visual-inspector-model)\.ts|local-assistance-(?!lazy-)(?!menu\.ts$)(?!review-authority\.ts$)[a-z\d-]+\.ts|local-model-manager-store\.ts|soundscaper-(?:production-dialog-model|routing-editor-model)\.ts|video-keyframe-(?:curve-transfer|dialog-model)\.ts|workspace[\\/](?:FramescaperCaptureSources|RecordingSetupPanel|WebVcrPanel|WebVcrPreview)\.tsx)`;
const EDITOR_ASSISTANCE_SEMANTIC_SEARCH_RUNTIME_CHUNK_TEST =
	/src[\\/]common[\\/]editor[\\/]ui[\\/]local-assistance-semantic-search-(?:bridge|source)\.ts$/;
const EDITOR_COPY_CHUNK_TEST =
	/src[\\/]common[\\/]i18n[\\/](?:catalogs|runtime|canonical-extras|(?!(?:site|site-sidebar)-copy\.js$)[^\\/]+-copy)\.js$/;

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

/** Shared session-only production metering used by the engine and product UI. */
export const EDITOR_PRODUCTION_METER_CHUNK_TEST = new RegExp(
	`${editorPath}production-audio[\\/](?:loudness-history-session|strip-analysis-scheduler|strip-meter-session)\\.ts$`,
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
	`${editorPath}(?:controller[\\/]${editorOptionalAssistanceModule}|assistance[\\/](?!${editorEagerAssistanceModule}\\.ts$)[^\\\\/]+|storage[\\/]assistance-derivative-repository)\\.ts$`,
);

/** Menu-opened UI implementations that remain behind existing React.lazy surfaces. */
export const EDITOR_OPTIONAL_SURFACE_CHUNK_TEST = new RegExp(
	`${editorPath}(?:${editorOptionalSurfaceModule}|ui[\\/]local-assistance-review-authority\\.ts)$`,
);

/** Shared parameter editor plus its Audacity and parametric-EQ surface implementations. */
export const EDITOR_EFFECT_PARAMETER_SURFACE_CHUNK_TEST = new RegExp(
	`${editorPath}ui[\\/](?:AudacityEffectLayout|ParametricEqEditor|inspector[\\/]EffectParameterEditor)\\.jsx$`,
);

/** Effect rack consumer and the design-system components it alone loads. */
export const EDITOR_EFFECT_DIALOG_SHELL_CHUNK_TEST = /(?:^|[\\/])(?:vendor[\\/]audacity-design-system[\\/]components[\\/]src[\\/](?:EffectsPanel[\\/].*|EffectDialog[\\/]EffectHeader\.tsx|SidePanel[\\/].*)|src[\\/]common[\\/]editor[\\/]ui[\\/]inspector[\\/](?:AudioEditorEffectsOverlay|AudacityEffectHeader)\.jsx)$/;
const DESIGN_SYSTEM_EDITOR_SHELL_COMPONENT_CHUNK_TEST = /(?:^|[\\/])vendor[\\/]audacity-design-system[\\/]components[\\/]src[\\/](?:AddTrackFlyout|ApplicationHeader|Button|Checkbox|Clip|ClipBody|ClipHeader|CloudProjectIndicator|ContextMenu|ContextMenuItem|DialogHeader|Dropdown|EnvelopeCurve|EnvelopeInteractionLayer|EnvelopeOverlay|EnvelopePoint|Flyout|GhostButton|Icon|Knob|LabelMarker|LabeledCheckbox|LabeledRadio|MidiClipBody|MixerChannel|MixerEffect|MixerFader|MixerFaderHandle|MixerPanel|NumberStepper|PanKnob|PanelHeader|PlayheadCursor|Radio|RulerFlyout|SelectionToolbar|Separator|Slider|TextInput|TimeCode|TimelineRuler|TimelineRulerContextMenu|ToggleButton|ToggleToolButton|ToolButton|Toolbar|Tooltip|Track|TrackControlPanel|TrackMeter|TransportButton|VerticalRuler)[\\/]/;
const EDITOR_CODEC_FOUNDATION_CHUNK_TEST = /src[\\/]common[\\/]editor[\\/](?:wavpack[\\/]|staffpad[\\/]|parametric-eq[\\/](?:parameters|design|wasm-runtime|wasm-loader)\.js$)/;
const EDITOR_EFFECT_CONTRACT_CHUNK_TEST = /(?:src[\\/]common[\\/](?:i18n[\\/]action-parity\.js|editor[\\/](?:audacity-effects[\\/](?:contracts|live-capabilities)\.js|nyquist[\\/]plugin-registry\.js|reviewed-effects[\\/](?:errors|manifest|selection-effect-contract|utility-gain-package)\.ts)))$/;
/**
 * Dependency-closed Framescaper project model used during product startup.
 *
 * Keep high-level runtime selection, render orchestration, and authoring
 * controllers with their consumers. Claiming those composition roots here made
 * this chunk import the selected bootstrap, while captured proxy preservation in
 * that bootstrap imported the project model back. Rolldown then evaluated the
 * preservation initializer before its imported foundation initializer existed.
 */
const framescaperProjectFoundationModules = Object.freeze([
	'editor-audio-dialogue-chain-finishing',
	'editor-audio-finishing-finishing',
	'editor-captured-video-proxy-preservation',
	'editor-domain-runtime-profile',
	'editor-native-openfx-authoring-model',
	'editor-native-project-action-requests',
	'editor-project-assistance-foundation',
	'editor-project-assistance-validation',
	'editor-project-assistance',
	'editor-project-companion-audio-scope',
	'editor-project-composition-validation',
	'editor-project-composition',
	'editor-project-feature-capabilities',
	'editor-project-feature-capability-profile-assistance',
	'editor-project-feature-capability-profile-composition',
	'editor-project-feature-capability-profile-finishing',
	'editor-project-feature-capability-profile-native-media',
	'editor-project-feature-capability-profile-openfx',
	'editor-project-feature-capability-profile-professional-media',
	'editor-project-feature-capability-profile-retime',
	'editor-project-feature-capability-profile-sequence',
	'editor-project-feature-capability-profile-timeline-image',
	'editor-project-feature-capability-profile-transitions',
	'editor-project-feature-capability-profile-visual',
	'editor-project-feature-requirements-assistance',
	'editor-project-feature-requirements-composition',
	'editor-project-feature-requirements-finishing',
	'editor-project-feature-requirements-native-media',
	'editor-project-feature-requirements-openfx',
	'editor-project-feature-requirements-professional-media',
	'editor-project-feature-requirements-retime',
	'editor-project-feature-requirements-sequence',
	'editor-project-feature-requirements-timeline-image',
	'editor-project-feature-requirements-transitions',
	'editor-project-feature-requirements-visual',
	'editor-project-feature-requirements',
	'editor-project-finishing-finishing-command',
	'editor-project-finishing-validation',
	'editor-project-finishing',
	'editor-project-native-media-foundation',
	'editor-project-native-media-openfx-validation',
	'editor-project-native-media-validation',
	'editor-project-native-media',
	'editor-project-professional-media-foundation',
	'editor-project-professional-media-source-command',
	'editor-project-professional-media-validation',
	'editor-project-retime-structural-admission',
	'editor-project-retime-validation',
	'editor-project-retime',
	'editor-project-runtime-profile',
	'editor-project-sequence-multicam',
	'editor-project-sequence-subsequence',
	'editor-project-sequence-validation',
	'editor-project-sequence',
	'editor-project-storage-profile',
	'editor-project-timeline-image-foundation',
	'editor-project-timeline-image-validation',
	'editor-project-timeline-image',
	'editor-project-transitions-validation',
	'editor-project-transitions',
	'editor-project-visual-validation',
	'editor-project-visual',
	'editor-project',
	'editor-video-proxy-action-runtime',
]);
const FRAMESCAPER_PROJECT_FOUNDATION_CHUNK_TEST = new RegExp(
	`src[\\\\/]framescaper[\\\\/](?:${framescaperProjectFoundationModules.join('|')})\\.ts$`,
);
/**
 * The layered Framescaper project-command authority, from base commands through
 * timeline images and assistance.
 *
 * Leaving these modules to reachability split the upper assistance command from
 * the timeline-image command it calls while the timeline-image chunk called back
 * into the native-media command placed beside assistance. The source graph was
 * acyclic, but the two emitted chunks were not and the peer editor could observe
 * an uninitialized command initializer during a cross-product handoff.
 */
const framescaperProjectCommandModules = Object.freeze([
	'editor-audio-finishing-reconciliation-finishing',
	'editor-project-assistance-commands',
	'editor-project-assistance-transition-allocation',
	'editor-project-composition-commands',
	'editor-project-finishing-command-inheritance',
	'editor-project-finishing-commands',
	'editor-project-finishing-inherited-state',
	'editor-project-finishing-transition-allocation',
	'editor-project-native-media-commands',
	'editor-project-native-media-transition-allocation',
	'editor-project-openfx-commands',
	'editor-project-openfx-validation',
	'editor-project-professional-media-command-inheritance',
	'editor-project-professional-media-commands',
	'editor-project-professional-media',
	'editor-project-retime-av-link-command-segmentation',
	'editor-project-retime-batch-command',
	'editor-project-retime-command-admission',
	'editor-project-retime-commands',
	'editor-project-retime-fresh-video-command',
	'editor-project-retime-retime-command',
	'editor-project-retime-retime-state',
	'editor-project-sequence-commands',
	'editor-project-sequence-sequence',
	'editor-project-timeline-image-commands',
	'editor-project-timeline-image-image-command',
	'editor-project-timeline-image-transition-allocation',
	'editor-project-transitions-commands',
	'editor-project-visual-command-inheritance',
	'editor-project-visual-commands',
	'editor-project-visual-visual-command',
	'editor-session-clipboard-v9',
	'editor-video-proxy-attachment-retention-sequence',
	'editor-video-proxy-command-retime',
]);
export const FRAMESCAPER_PROJECT_COMMAND_CHUNK_TEST = new RegExp(
	`src[\\\\/]framescaper[\\\\/](?:${framescaperProjectCommandModules.join('|')})\\.ts$`,
);
const FRAMESCAPER_SESSION_CLIPBOARD_CHUNK_TEST = /src[\\/]framescaper[\\/]editor-session-clipboard-v(?:8|11(?:-(?:controller|selection))?|12(?:-controller)?|13(?:-paste)?)\.ts$/;

/** Timeline-image feature modules plus the runtime projection chain they extend. */
export const FRAMESCAPER_TIMELINE_IMAGE_CHUNK_TEST =
	/src[\\/]framescaper[\\/](?:editor-project-(?:native-media|assistance)-runtime|editor-(?:image-(?:import-coordinator|placement)-timeline-image|project-[^\\/]*timeline-image[^\\/]*|scape-[^\\/]*timeline-image|selected-timeline-image|timeline-image)|video-export-(?:image|strategy-timeline-image)-)/;


/**
 * The project identity tuple reader and closed handoff intent, owned apart
 * from the editor domain they serve.
 *
 * A project is identified only by (schemaFamily, schemaVersion). The transfer
 * documents use the hardened reader to learn which product owns a stored row;
 * a bare schema number is deliberately never product authority. That shared
 * reader is the reason the identity module needs an owner of its own.
 *
 * `project-schema-identity.ts` has no imports, but chunks load whole. While the
 * editor domain group claimed it, the standalone transfer page's identity read
 * made it statically import an
 * `editor-domain` chunk, and through that chunk's own imports the transfer
 * documents carried 62 modulepreloads totalling 5.29 MiB of editor code onto a
 * page that mounts no editor. Owning the leaf here emits it as its own small
 * chunk that both worlds can import without dragging the other's graph.
 */
export const PROJECT_SCHEMA_IDENTITY_CHUNK_TEST = new RegExp(
	`(?:${editorPath}project-schema-identity|src[\\\\/]common[\\\\/]cross-product-handoff-intent)\\.ts$`,
);

/** Flat editor modules and `assistance/` domain modules shared by the shell and dialogs. */
export const EDITOR_DOMAIN_CHUNK_TEST = new RegExp(
	`${editorPath}(?!${editorOptionalArchiveModule}\\.(?:[cm]?[jt]s)$)(?!${editorOptionalExecutionModule}\\.(?:[cm]?[jt]s)$)(?:[^\\\\/]+|(?:assistance|platform)[\\\\/][^\\\\/]+)\\.(?:[cm]?[jt]s)$`,
);

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
		// Dependency-closed identity leaves both the editor and standalone transfer
		// pages read. Deliberately not named `editor-`: these are tuple and launch
		// intent contracts, not the editor.
		name: 'project-schema-identity',
		test: PROJECT_SCHEMA_IDENTITY_CHUNK_TEST,
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
		name: 'editor-optional-assistance',
		test: EDITOR_OPTIONAL_ASSISTANCE_CHUNK_TEST,
		priority: 93,
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
		test: new RegExp(`(?:${editorPath}(?!${editorOptionalSurfaceModule}$)ui[\\\\/](?!(?:dialogs[\\\\/](?!editor-dialog-model\\.js$)|inspector[\\\\/]))|src[\\\\/]common[\\\\/]url\\.ts$)`),
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

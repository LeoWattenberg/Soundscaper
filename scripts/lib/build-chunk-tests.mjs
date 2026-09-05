/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which source modules each built chunk claims.
 *
 * These patterns are the membership half of the chunking contract: they say what a chunk is
 * made of, while `build-chunk-groups.mjs` says how the chunks relate — their priorities,
 * size budgets and load order. The two are apart because they change for different reasons:
 * a pattern moves when a module is added, renamed or reclassified, and a group changes when
 * the shape of the build does.
 *
 * `tests/audio-editor-build-chunk-ownership.test.ts` keeps both honest.
 */

export const editorPath = String.raw`src[\\/]common[\\/]editor[\\/]`;
const editorOptionalArchiveModule = String.raw`(?:aup-legacy(?:-block-budget|-conversion|-xml)?|aup4-(?:client|opaque-merge|opaque-persistence|profile-values|profile|sanitization|time-signature|track-nodes)|audacity-(?:annotation-interchange|tempo-import)|dawproject-(?:archive|export(?:-context|-lanes)?|format|import(?:-maps|-project|-structure|-timeline)?|xml)|scape-(?:archive-(?:copy|layout(?:-witness)?|manifest|reader)|export-destination|import-capacity|import-transaction|project-admission|project-source-remap)|scape-project(?:-canonical-inspection|-timing-assets)?)`;
const editorOptionalExecutionModule = String.raw`(?:analysis|browser-(?:dedicated-audio-worker-client|webcodecs-aac)|loudness-measurement-report|pffft|selection-effects-runtime|spectral-edit(?:-admission)?|video-(?:keyframe-mediabunny-execution|mediabunny-muxer))`;
const editorOptionalExportControllerModule = String.raw`(?:audio-export-delivery-admission|audio-export-render-orchestration|audio-realtime-encoded-export|audio-rendered-fallback-export|bw64-render-project|delivery-conformance-action|desktop-audio-export-capability|direct-(?:aiff-export|audio-render-plan|broadcast-wave-export|bw64-export|bwf-export|compressed-export|compressed-plan|compressed-stem-archive-plan|export-dispatch|mp3-export|native-stem-archive-plan|offline-compressed-export|offline-pcm-export|pcm-export|stem-archive-export|video-export|video-plan-contract|wav-export)|export-service|mastering-sequence-export-render|persistent-audio-delivery-execution|persistent-export-progress|realtime-export-pcm-transform|rendered-audio-encoding|streaming-stem-archive-export|video-export-captions|video-export-original-loader|video-export-service|video-export-staged-audio|video-rendered-fallback-export)`;
/**
 * Flat editor modules the lazy export slice alone renders through.
 *
 * `loudness-normalization-render.ts` is the case that named this: its only
 * importer is `controller/rendered-audio-encoding.ts`, which the optional export
 * owner claims, so every byte of it sat in both products' startup graphs for an
 * export nobody had opened. A flat module is claimed by the domain group by
 * default, which is eager, so escaping that default takes a name here.
 *
 * The other four arrived the same way and were found the same way, by reading every
 * importer rather than every chunk: `controller/export-service.ts` and
 * `controller/delivery-conformance-action.ts` are the only value importers of
 * `delivery-conformance.ts`, and `controller/video-export-service.ts` is the only one of
 * the conversion inventory, the burn-in font loader and the encoder tier. Note that
 * `video-burn-in-font-subsets.ts` is a different module the caption pipeline reads
 * eagerly; the trailing `\.ts$` anchor is what keeps it out of this alternation.
 */
const editorOptionalExportFlatModule = String.raw`(?:delivery-conformance|delivery-video-conversion-inventory|loudness-normalization-render|video-burn-in-font|video-delivery-encoder-tier)`;
export const editorOptionalControllerModule = String.raw`(?:analysis-service|cross-product-handoff-action|dawproject-service|${editorOptionalExportControllerModule})`;
/**
 * The Framescaper capture and Web VCR implementation, loaded when a capture
 * gesture, a desktop bridge or durable recovery state asks for it.
 *
 * Named rather than wildcarded because four capture modules stay eager: the
 * admin interlock and the proxy ports are composed synchronously, the Web VCR
 * UI snapshot builds the idle snapshot the deferred facade shows, and the
 * session manifest is storage the eager repositories read.
 */
export const editorOptionalCaptureControllerModule = String.raw`(?:framescaper-browser-(?:audio-processor-recorder|audio-recorder|capture-preview|capture-source|recorder-factory|video-recorder)|framescaper-capture-(?!admin-interlock\.ts$|project-write-authority\.ts$|proxy-quiescence\.ts$)[a-z\d-]+|framescaper-web-vcr-(?!ui-snapshot\.ts$)[a-z\d-]+|web-vcr-(?:audio-monitor|recorder-factory|video-frame-crop))`;
export const editorOptionalCaptureFlatModule = String.raw`(?:framescaper-capture-domain|web-vcr-domain|web-vcr-geometry)`;
export const editorOptionalAssistanceModule = String.raw`local-assistance-[^\\/]+`;
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
export const editorOptionalSurfaceModule = String.raw`ui[\\/](?:AudacityEffectLayout\.jsx|ParametricEqEditor\.jsx|PrivacyPolicyRoute\.tsx|SoundActivationPreferences\.tsx|VideoDeliveryFields\.jsx|desktop-export-codec-model\.ts|export-(?:dialog-audio-codec-options\.ts|dialog-model\.js|preset-(?:actions\.js|model\.ts))|framescaper-(?:caption-file-interchange|finishing-dialog-model|native-services-dialog-model|visual-inspector-model)\.ts|local-assistance-(?!lazy-)(?!menu\.ts$)(?!review-authority\.ts$)[a-z\d-]+\.ts|local-model-manager-store\.ts|soundscaper-(?:production-dialog-model|routing-editor-model)\.ts|video-keyframe-(?:curve-transfer|dialog-model)\.ts|workspace[\\/](?:(?:FramescaperCaptureSources|RecordingSetupPanel|WebVcrPanel|WebVcrPreview|SoundscaperRoutingGraph(?:Inspector|View))\.tsx|soundscaper-routing-(?:folder-authority|graph-(?:candidates|gesture|layout))\.ts))`;
export const EDITOR_ASSISTANCE_SEMANTIC_SEARCH_RUNTIME_CHUNK_TEST =
	/src[\\/]common[\\/]editor[\\/]ui[\\/]local-assistance-semantic-search-(?:bridge|source)\.ts$/;
export const EDITOR_COPY_CHUNK_TEST =
	/(?:src[\\/]common[\\/]i18n[\\/](?:catalogs|runtime|canonical-extras|(?!(?:site|site-sidebar)-copy\.js$)[^\\/]+-copy)|src[\\/]soundscaper[\\/]framescaper-capture-copy)\.js$/;

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
	`${editorPath}(?:selection-effects-runtime|parametric-eq[\\\\/]destructive)\\.js$`,
);

/** Shared session-only production metering used by the engine and product UI. */
export const EDITOR_PRODUCTION_METER_CHUNK_TEST = new RegExp(
	`${editorPath}production-audio[\\\\/](?:loudness-history-session|strip-analysis-scheduler|strip-meter-session)\\.ts$`,
);

/** Effect and Analyze implementations reached only after their eager action facade runs. */
export const EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST = new RegExp(
	`${editorPath}(?:${editorOptionalExecutionModule}\\.(?:[cm]?[jt]s)|controller[\\\\/]analysis-service\\.ts)$`,
);

/** Audio and video delivery execution isolated from the effect-runtime graph. */
export const EDITOR_OPTIONAL_EXPORT_CHUNK_TEST = new RegExp(
	`${editorPath}(?:controller[\\\\/]${editorOptionalExportControllerModule}|${editorOptionalExportFlatModule})\\.ts$`,
);

/** Capture and Web VCR implementation behind the deferred Framescaper capture runtime. */
export const EDITOR_OPTIONAL_CAPTURE_CHUNK_TEST = new RegExp(
	`${editorPath}(?:controller[\\\\/]${editorOptionalCaptureControllerModule}|${editorOptionalCaptureFlatModule})\\.ts$`,
);

/** Stateful assistance workflows loaded only after their menu-owned dialog is invoked. */
export const EDITOR_OPTIONAL_ASSISTANCE_CHUNK_TEST = new RegExp(
	`(?:${editorPath}(?:controller[\\\\/]${editorOptionalAssistanceModule}|assistance[\\\\/](?!${editorEagerAssistanceModule}\\.ts$)[^\\\\/]+|storage[\\\\/]assistance-derivative-(?:codec|key-value-port|repository))|src[\\\\/]soundscaper[\\\\/]local-assistance-deferred-publication)\\.ts$`,
);

/** Menu-opened UI implementations that remain behind existing React.lazy surfaces. */
export const EDITOR_OPTIONAL_SURFACE_CHUNK_TEST = new RegExp(
	`${editorPath}(?:${editorOptionalSurfaceModule}|ui[\\\\/]local-assistance-review-authority\\.ts)$`,
);

/** Split Tool interaction runtimes kept out of the product-ready startup graph. */
export const EDITOR_OPTIONAL_SPLIT_TOOL_CHUNK_TEST =
	/src[\\/]common[\\/]editor[\\/]ui[\\/]timeline[\\/]split-tool-(?:guideline|shortcut)\.ts$/;

/** Shared parameter editor plus its Audacity and parametric-EQ surface implementations. */
export const EDITOR_EFFECT_PARAMETER_SURFACE_CHUNK_TEST = new RegExp(
	`${editorPath}ui[\\/](?:AudacityEffectLayout|ParametricEqEditor|inspector[\\/]EffectParameter(?:Editor|Number))\\.jsx$`,
);

/**
 * Effect rack consumer and the design-system components it alone loads.
 *
 * The rack's realtime-effect shortcut handler belongs here too. Left to its own
 * chunk it lands with the overlay's lazy facade, which re-exports the overlay,
 * so this chunk imports the facade while the facade imports this chunk: on the
 * facade-first order the rack renders against an uninitialised module and the
 * editor dies with "init_AudioEditorEffectsOverlay is not a function".
 */
export const EDITOR_EFFECT_DIALOG_SHELL_CHUNK_TEST = /(?:^|[\\/])(?:vendor[\\/]audacity-design-system[\\/]components[\\/]src[\\/](?:EffectsPanel[\\/].*|EffectDialog[\\/]EffectHeader\.tsx|SidePanel[\\/].*)|src[\\/]common[\\/]editor[\\/]ui[\\/]inspector[\\/](?:(?:AudioEditorEffectsOverlay|AudacityEffectHeader)\.jsx|audacity-realtime-effect-shortcut\.ts))$/;
export const DESIGN_SYSTEM_EDITOR_SHELL_COMPONENT_CHUNK_TEST = /(?:^|[\\/])vendor[\\/]audacity-design-system[\\/]components[\\/]src[\\/](?:AddTrackFlyout|ApplicationHeader|Button|Checkbox|Clip|ClipBody|ClipHeader|CloudProjectIndicator|ContextMenu|ContextMenuItem|DialogHeader|Dropdown|EnvelopeCurve|EnvelopeInteractionLayer|EnvelopeOverlay|EnvelopePoint|Flyout|Footer|GhostButton|Icon|Knob|LabelMarker|LabeledCheckbox|LabeledRadio|MidiClipBody|MixerChannel|MixerEffect|MixerFader|MixerFaderHandle|MixerPanel|NumberStepper|PanKnob|PanelHeader|PlayheadCursor|Radio|RulerFlyout|SelectionToolbar|Separator|Slider|TextInput|TimeCode|TimelineRuler|TimelineRulerContextMenu|ToggleButton|ToggleToolButton|ToolButton|Toolbar|Tooltip|Track|TrackControlPanel|TrackMeter|TransportButton|VerticalRuler)[\\/]/;
// The renderer/main video contract is a shared codec leaf. Reachability places
// it in the Framescaper bootstrap and makes the desktop codec runtime import
// that bootstrap back, so it needs the same non-recursive owner as codec leaves.
export const EDITOR_CODEC_FOUNDATION_CHUNK_TEST = /(?:src[\\/]common[\\/]editor[\\/](?:wavpack[\\/]|staffpad[\\/]|parametric-eq[\\/](?:parameters|design|wasm-runtime|wasm-loader)\.js$)|desktop[\\/]desktop-(?:video-codec-operation|audio-codec-(?:capability|operation))-contract\.ts$)/;
export const EDITOR_EFFECT_CONTRACT_CHUNK_TEST = /(?:src[\\/]common[\\/](?:i18n[\\/]action-parity\.js|editor[\\/](?:audacity-effects[\\/](?:contracts|factory-preset-tables|factory-presets|live-capabilities|live-capability-policy|manifest)\.js|first-party-effects[\\/](?:bitcrusher|parametric-eq)[\\/]definition\.js|nyquist[\\/](?:plugin-parser|plugin-registry|plugins[\\/]catalog)\.js|reviewed-effects[\\/](?:errors|manifest|selection-effect-contract|utility-gain-package)\.ts)))$/;
/**
 * Soundscaper family-v1 project and archive authority shared with transfer pages.
 *
 * Without an owner these modules follow the editor composition root into the
 * selected product bootstrap. The standalone transfer runtime then imports that
 * UI bootstrap to validate or archive a project, closing an emitted init cycle
 * through file-service and leaving its initializer undefined.
 */
const soundscaperProjectFoundationModules = Object.freeze([
	'editor-native-plugin-playback',
	'editor-native-plugin-state-scape',
	'editor-native-plugin-state',
	'editor-project-feature-capability-profile',
	'editor-project-feature-compatibility',
	'editor-project-feature-requirements',
	'editor-project-production-validation',
	'editor-project-validation',
	'editor-project',
	'editor-scape-assets',
	'editor-scape-native',
]);
export const SOUNDSCAPER_PROJECT_FOUNDATION_CHUNK_TEST = new RegExp(
	`src[\\\\/]soundscaper[\\\\/](?:${soundscaperProjectFoundationModules.join('|')})\\.ts$`,
);
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
	'editor-project-finishing-runtime',
	'editor-project-finishing-validation',
	'editor-project-finishing',
	'editor-project-identity',
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
export const FRAMESCAPER_PROJECT_FOUNDATION_CHUNK_TEST = new RegExp(
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
export const FRAMESCAPER_SESSION_CLIPBOARD_CHUNK_TEST = /src[\\/]framescaper[\\/]editor-session-clipboard-v(?:8|11(?:-(?:controller|selection))?|12(?:-controller)?|13(?:-paste)?)\.ts$/;

/** Timeline-image feature modules plus the runtime projection chain they extend. */
export const FRAMESCAPER_TIMELINE_IMAGE_CHUNK_TEST =
	/src[\\/]framescaper[\\/](?:editor-project-(?:native-media|assistance)-runtime|editor-(?:image-(?:import-coordinator|placement)-timeline-image|project-[^\\/]*timeline-image[^\\/]*|scape-[^\\/]*timeline-image|selected-timeline-image|timeline-image)|video-export-(?:image|strategy-timeline-image)-)/;


/**
 * Dependency-free interchange facades shared by transfer pages and editors.
 *
 * A project is identified only by (schemaFamily, schemaVersion). The transfer
 * documents use the hardened reader to learn which product owns a stored row;
 * a bare schema number is deliberately never product authority. That shared
 * reader is the reason these modules need an owner apart from editor domains.
 *
 * `project-schema-identity.ts` has no imports, but chunks load whole. While the
 * editor domain group claimed it, the standalone transfer page's identity read
 * made it statically import an
 * `editor-domain` chunk, and through that chunk's own imports the transfer
 * documents carried 62 modulepreloads totalling 5.29 MiB of editor code onto a
 * page that mounts no editor. Owning the leaf here emits it as its own small
 * chunk that both worlds can import without dragging the other's graph. The
 * archive facade adds only erased type imports and dynamic implementation
 * imports, so sharing this owner does not grow the mounted transfer graph.
 */
export const PROJECT_INTERCHANGE_FOUNDATION_CHUNK_TEST = new RegExp(
	`(?:${editorPath}(?:project-schema-identity|controller[\\\\/]deferred-archive-runtime)|src[\\\\/]common[\\\\/]cross-product-handoff-intent)\\.ts$`,
);

/** Flat editor modules and `assistance/` domain modules shared by the shell and dialogs. */
export const EDITOR_DOMAIN_CHUNK_TEST = new RegExp(
	`${editorPath}(?!${editorOptionalArchiveModule}\\.(?:[cm]?[jt]s)$)(?!${editorOptionalExecutionModule}\\.(?:[cm]?[jt]s)$)(?!${editorOptionalCaptureFlatModule}\\.ts$)(?:[^\\\\/]+|(?:assistance|design-system-adapters|platform)[\\\\/][^\\\\/]+)\\.(?:[cm]?[jt]s)$`,
);

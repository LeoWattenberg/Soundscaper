/* SPDX-License-Identifier: AGPL-3.0-only */

export type FoundationRuntimeConsumerSurface =
	| 'playback'
	| 'preview'
	| 'composition'
	| 'transition'
	| 'audio-export'
	| 'video-export'
	| 'interchange'
	| 'navigation'
	| 'timeline'
	| 'waveform';

export interface FoundationRuntimeProjectionBoundary {
	readonly boundary: string;
	readonly file: string;
	readonly root: boolean;
	readonly delegate: string | null;
	readonly guardsBrand: boolean;
}

export interface FoundationRuntimeConsumerEvidence {
	readonly id: string;
	readonly surface: FoundationRuntimeConsumerSurface;
	readonly file: string;
	readonly entryPoint: string;
	readonly inputIdentifier: string;
	readonly projectedIdentifier: string | null;
	readonly boundary: string;
	readonly evidence: string;
}

export interface FoundationRuntimeShieldedOwner {
	readonly file: string;
	readonly surfaces: readonly FoundationRuntimeConsumerSurface[];
}

export interface FoundationRuntimeTimingReaderExclusion {
	readonly file: string;
	readonly entryPoint: string;
	readonly reason: string;
}

export interface FoundationRuntimeProjectionImporterExclusion {
	readonly file: string;
	readonly reason: string;
}

/** Projection adapters admitted by the WP-0.2 shield audit. */
export const FOUNDATION_RUNTIME_PROJECTION_BOUNDARIES: readonly FoundationRuntimeProjectionBoundary[] = deepFreeze([
	{
		boundary: 'resolveRuntimeProjectProjection',
		file: 'src/common/editor/runtime-clip-projection.ts',
		root: true,
		delegate: null,
		guardsBrand: false,
	},
	{
		boundary: 'projectForRuntimeConsumers',
		file: 'src/common/editor/project-current-runtime.ts',
		root: false,
		delegate: 'resolveRuntimeProjectProjection',
		guardsBrand: true,
	},
	{
		boundary: 'runtimeProject',
		file: 'src/common/editor/video-timeline.js',
		root: false,
		delegate: 'resolveRuntimeProjectProjection',
		guardsBrand: true,
	},
	{
		boundary: 'ensureRuntimeProject',
		file: 'src/common/editor/video-export.js',
		root: false,
		delegate: 'resolveRuntimeProjectProjection',
		guardsBrand: true,
	},
	{
		boundary: 'loadProject',
		file: 'src/common/editor/engine/lifecycle.ts',
		root: false,
		delegate: 'resolveRuntimeProjectProjection',
		guardsBrand: false,
	},
	{
		boundary: 'projectDurationFrames',
		file: 'src/common/editor/project.js',
		root: false,
		delegate: 'projectForRuntimeConsumers',
		guardsBrand: false,
	},
]);

/** Files that own the raw-project boundary for every WP-0.2 consumer surface. */
export const FOUNDATION_RUNTIME_SHIELDED_OWNERS: readonly FoundationRuntimeShieldedOwner[] = deepFreeze([
	{ file: 'src/common/editor/engine/lifecycle.ts', surfaces: ['playback'] },
	{ file: 'src/common/editor/export.js', surfaces: ['audio-export'] },
	{ file: 'src/common/editor/aup4-export.js', surfaces: ['interchange'] },
	{ file: 'src/common/editor/controller/nyquist-host-service.ts', surfaces: ['interchange'] },
	{ file: 'src/common/editor/video-export.js', surfaces: ['video-export'] },
	{ file: 'src/common/editor/video-timeline.js', surfaces: ['preview', 'composition', 'transition', 'navigation'] },
	{ file: 'src/common/editor/project.js', surfaces: ['navigation'] },
	{ file: 'src/common/editor/ui/timeline/useTimelineViewportModel.js', surfaces: ['timeline'] },
	{ file: 'src/common/editor/controller/project-visual-service.ts', surfaces: ['waveform'] },
]);

/** Exact non-consumer readers co-located with a shield owner. No wildcard exclusions are admitted. */
export const FOUNDATION_RUNTIME_TIMING_READER_EXCLUSIONS: readonly FoundationRuntimeTimingReaderExclusion[] = deepFreeze([
	{
		file: 'src/common/editor/video-export.js',
		entryPoint: 'firstVisibleTimelineVideo',
		reason: 'Private downstream helper; every call passes the runtimeProject captured by a registered video-export boundary.',
	},
	{
		file: 'src/common/editor/project.js',
		entryPoint: 'validateAudioEditorProject',
		reason: 'Persisted-document validation intentionally inspects authoritative wire fields and is not a runtime consumer.',
	},
	{
		file: 'src/common/editor/project.js',
		entryPoint: 'validateProjectV2Shape',
		reason: 'Retained legacy persisted-shape validation is authoritative schema work rather than runtime timing consumption.',
	},
	{
		file: 'src/common/editor/project.js',
		entryPoint: 'validateProjectV3Shape',
		reason: 'Retained legacy persisted-shape validation is authoritative schema work rather than runtime timing consumption.',
	},
]);

/** Non-shield importers discovered beside the owned consumer and boundary files. */
export const FOUNDATION_RUNTIME_PROJECTION_IMPORTER_EXCLUSIONS: readonly FoundationRuntimeProjectionImporterExclusion[] = deepFreeze([
	{
		file: 'src/common/editor/app.js',
		reason: 'Command acquisition projects the editable draft before mutation; command reconciliation restores persisted authority.',
	},
	{
		file: 'src/common/editor/commands.js',
		reason: 'The command transaction brands a verified transient draft and is an edit adapter rather than a runtime consumer.',
	},
	{
		file: 'src/common/editor/commands/range-runtime.js',
		reason: 'Range commands preserve and rebrand transient command projections before persisted-authority reconciliation.',
	},
	{
		file: 'src/common/editor/commands/shared-runtime.js',
		reason: 'Shared command helpers resolve individual clips while converting command results between runtime and wire domains.',
	},
	{
		file: 'src/common/editor/project-feature-requirements.ts',
		reason: 'Owned feature-declaration reconciliation resolves a fallback target duration while validating persisted requirements.',
	},
	{
		file: 'src/common/editor/project-feature-video-clip-render-v1.ts',
		reason: 'Fallback relationship admission resolves canonical target geometry before creating its separate transient playback projection.',
	},
	{
		file: 'src/common/editor/project-v10-command-projection.ts',
		reason: 'The command projection adapter explicitly converts between persisted authority and the runtime command surface.',
	},
	{
		file: 'src/common/editor/project-v10-foundation-validation.ts',
		reason: 'Foundation validation intentionally resolves authoritative wire coordinates to prove bounds and derived equality.',
	},
]);

/**
 * Maintained WP-0.2 inventory of the shielded runtime consumer entry points.
 * The paired AST audit proves each entry point crosses its named projection
 * boundary before reading any persisted/resolved clip timing field.
 */
export const FOUNDATION_RUNTIME_CONSUMER_SURFACES: readonly FoundationRuntimeConsumerEvidence[] = deepFreeze([
	{
		id: 'aup4-export-plan',
		surface: 'interchange',
		file: 'src/common/editor/aup4-export.js',
		entryPoint: 'createAup4ExportPlan',
		inputIdentifier: 'project',
		projectedIdentifier: 'project',
		boundary: 'projectForRuntimeConsumers',
		evidence: 'AUP4 planning projects current documents before overlap, clip placement, label serialization, and tempo-map flattening read resolved timing.',
	},
	{
		id: 'nyquist-host-properties',
		surface: 'interchange',
		file: 'src/common/editor/controller/nyquist-host-service.ts',
		entryPoint: 'nyquistHostProperties',
		inputIdentifier: 'persistedProject',
		projectedIdentifier: 'project',
		boundary: 'projectForRuntimeConsumers',
		evidence: 'Nyquist host properties project the current document before exposing clip ranges and resolve PROJECT TEMPO from the map event active at evaluation start.',
	},
	{
		id: 'engine-project-load',
		surface: 'playback',
		file: 'src/common/editor/engine/lifecycle.ts',
		entryPoint: 'loadProject',
		inputIdentifier: 'project',
		projectedIdentifier: 'runtimeProject',
		boundary: 'resolveRuntimeProjectProjection',
		evidence: 'The engine stores, sizes, seeks, and schedules only the transient resolved project created at loadProject entry.',
	},
	{
		id: 'engine-project-apply',
		surface: 'playback',
		file: 'src/common/editor/engine/lifecycle.ts',
		entryPoint: 'applyProject',
		inputIdentifier: 'project',
		projectedIdentifier: null,
		boundary: 'loadProject',
		evidence: 'Playback reapply delegates the raw project to loadProject before any clip timing is consumed or retained by the engine.',
	},
	{
		id: 'single-picture-preview',
		surface: 'preview',
		file: 'src/common/editor/video-timeline.js',
		entryPoint: 'resolveActiveVideoClip',
		inputIdentifier: 'project',
		projectedIdentifier: 'project',
		boundary: 'runtimeProject',
		evidence: 'Single-picture preview replaces its project argument with the branded projection before resolving active layers.',
	},
	{
		id: 'video-composition-intervals',
		surface: 'composition',
		file: 'src/common/editor/video-timeline.js',
		entryPoint: 'resolveVideoCompositionIntervals',
		inputIdentifier: 'project',
		projectedIdentifier: 'project',
		boundary: 'runtimeProject',
		evidence: 'Composition interval boundaries and source maps are derived only after replacing the persisted project with its projection.',
	},
	{
		id: 'video-layer-transitions',
		surface: 'transition',
		file: 'src/common/editor/video-timeline.js',
		entryPoint: 'resolveActiveVideoLayers',
		inputIdentifier: 'project',
		projectedIdentifier: 'project',
		boundary: 'runtimeProject',
		evidence: 'Layer overlap and transition opacity receive projected clip endpoints because projection is the entry operation.',
	},
	{
		id: 'legacy-video-segments',
		surface: 'composition',
		file: 'src/common/editor/video-timeline.js',
		entryPoint: 'resolveVideoTimelineSegments',
		inputIdentifier: 'project',
		projectedIdentifier: 'project',
		boundary: 'runtimeProject',
		evidence: 'The compatibility segment API replaces its project before deriving clip boundaries and delegates active frames to projection-backed preview.',
	},
	{
		id: 'video-timeline-duration',
		surface: 'navigation',
		file: 'src/common/editor/video-timeline.js',
		entryPoint: 'videoTimelineDurationFrames',
		inputIdentifier: 'project',
		projectedIdentifier: 'project',
		boundary: 'runtimeProject',
		evidence: 'Video timeline end navigation replaces the document with its projection before comparing resolved clip endpoints.',
	},
	{
		id: 'audio-export-plan',
		surface: 'audio-export',
		file: 'src/common/editor/export.js',
		entryPoint: 'createExportPlan',
		inputIdentifier: 'project',
		projectedIdentifier: 'runtimeProject',
		boundary: 'projectForRuntimeConsumers',
		evidence: 'Audio range, marker, tail, render-admission, and stem planning share one projection captured at export-plan entry.',
	},
	{
		id: 'audio-export-markers',
		surface: 'audio-export',
		file: 'src/common/editor/export.js',
		entryPoint: 'createExportMarkers',
		inputIdentifier: 'project',
		projectedIdentifier: 'runtimeProject',
		boundary: 'projectForRuntimeConsumers',
		evidence: 'Marker extraction independently projects its input so callers outside the main export plan cannot read persisted musical labels.',
	},
	{
		id: 'audio-export-range',
		surface: 'audio-export',
		file: 'src/common/editor/export.js',
		entryPoint: 'resolveExportRange',
		inputIdentifier: 'project',
		projectedIdentifier: null,
		boundary: 'projectDurationFrames',
		evidence: 'Whole-project audio ranges delegate their endpoint to the projection-backed duration boundary; selection and loop remain sample-authoritative.',
	},
	{
		id: 'video-export-plan',
		surface: 'video-export',
		file: 'src/common/editor/video-export.js',
		entryPoint: 'createVideoExportPlan',
		inputIdentifier: 'project',
		projectedIdentifier: 'runtimeProject',
		boundary: 'ensureRuntimeProject',
		evidence: 'Video range and composition planning use one branded project projection created before the first timing field read.',
	},
	{
		id: 'video-export-canvas',
		surface: 'video-export',
		file: 'src/common/editor/video-export.js',
		entryPoint: 'resolveVideoExportCanvas',
		inputIdentifier: 'project',
		projectedIdentifier: 'runtimeProject',
		boundary: 'ensureRuntimeProject',
		evidence: 'Automatic export canvas and nominal-rate selection inspect the earliest visible clip only after runtime projection.',
	},
	{
		id: 'project-duration-navigation',
		surface: 'navigation',
		file: 'src/common/editor/project.js',
		entryPoint: 'projectDurationFrames',
		inputIdentifier: 'project',
		projectedIdentifier: 'runtimeProject',
		boundary: 'projectForRuntimeConsumers',
		evidence: 'Project and label duration navigation derives its maximum endpoint from resolved clips and projected musical labels.',
	},
	{
		id: 'editor-timeline-duration-navigation',
		surface: 'navigation',
		file: 'src/common/editor/project.js',
		entryPoint: 'editorTimelineDurationFrames',
		inputIdentifier: 'project',
		projectedIdentifier: null,
		boundary: 'projectDurationFrames',
		evidence: 'Editor navigation delegates document duration to the projection-backed project duration boundary before applying viewport headroom.',
	},
	{
		id: 'timeline-viewport',
		surface: 'timeline',
		file: 'src/common/editor/ui/timeline/useTimelineViewportModel.js',
		entryPoint: 'useTimelineViewportModel',
		inputIdentifier: 'persistedProject',
		projectedIdentifier: 'project',
		boundary: 'resolveRuntimeProjectProjection',
		evidence: 'The viewport memoizes a projection from the snapshot document before layout, hit-testing, or track rendering consumes clips.',
	},
	{
		id: 'waveform-visible-clips',
		surface: 'waveform',
		file: 'src/common/editor/controller/project-visual-service.ts',
		entryPoint: 'getVisibleClips',
		inputIdentifier: 'project',
		projectedIdentifier: 'runtimeProject',
		boundary: 'resolveRuntimeProjectProjection',
		evidence: 'Waveform visual preparation filters and maps the resolved clip array, so musical and frame-backed placement never leak through.',
	},
]);

function deepFreeze<Value>(value: Value): Readonly<Value> {
	if (!value || typeof value !== 'object') return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}

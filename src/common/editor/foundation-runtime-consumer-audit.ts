/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FoundationRuntimeConsumerSurface } from './foundation-runtime-consumer-evidence.ts';
export { FOUNDATION_RUNTIME_CONSUMER_SURFACES } from './foundation-runtime-consumer-evidence.ts';
export type { FoundationRuntimeConsumerSurface, FoundationRuntimeConsumerEvidence } from './foundation-runtime-consumer-evidence.ts';

export interface FoundationRuntimeProjectionBoundary {
	readonly boundary: string;
	readonly file: string;
	readonly root: boolean;
	readonly delegate: string | null;
	readonly guardsBrand: boolean;
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
	{ boundary: 'resolveRuntimeClipProjection', file: 'src/common/editor/runtime-clip-projection.ts', root: true, delegate: null, guardsBrand: false },
	{ boundary: 'resolveProjectBinAudioPreviewClip', file: 'src/common/editor/controller/import/internal/project-bin/project-bin-runtime.ts', root: false, delegate: 'resolveRuntimeClipProjection', guardsBrand: false },
	{ boundary: 'projectBinReplacementShortensClip', file: 'src/common/editor/controller/import/internal/project-bin/project-bin-runtime.ts', root: false, delegate: 'resolveRuntimeClipProjection', guardsBrand: false },
	{
		boundary: 'projectForAudioGeneratorCommands',
		file: 'src/common/editor/controller/edit/internal/generator-project-view.ts',
		root: false, delegate: 'projectForRuntimeConsumers', guardsBrand: false,
	},
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
		boundary: 'ensureRuntimeProject',
		file: 'src/common/editor/video-caption-cues.ts',
		root: false,
		delegate: 'resolveRuntimeProjectProjection',
		guardsBrand: true,
	},
	{
		boundary: 'createVideoKeyframeExportInventory',
		file: 'src/common/editor/video-keyframe-export-inventory.ts',
		root: false,
		delegate: 'exportRuntimeProject',
		guardsBrand: false,
	},
	{
		boundary: 'exportRuntimeProject',
		file: 'src/common/editor/video-keyframe-export-inventory.ts',
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
	{ file: 'src/common/editor/controller/import/internal/project-bin/project-bin-runtime.ts', surfaces: ['preview', 'composition'] },
	{ file: 'src/common/editor/controller/import/internal/project-bin/project-bin-preview-service.ts', surfaces: ['preview'] },
	{ file: 'src/common/editor/controller/import/internal/project-bin/project-bin-replacement-service.ts', surfaces: ['composition'] },
	{ file: 'src/common/editor/engine/lifecycle.ts', surfaces: ['playback'] },
	{ file: 'src/common/editor/export.js', surfaces: ['audio-export'] },
	{ file: 'src/common/editor/aup4-export.js', surfaces: ['interchange'] },
	{ file: 'src/common/editor/aup4-annotation-interchange.ts', surfaces: ['interchange'] },
	{ file: 'src/common/editor/timeline-annotation-riff-interchange.ts', surfaces: ['interchange'] },
	{ file: 'src/common/editor/controller/export/interchange-export-action.ts', surfaces: ['interchange'] },
	{ file: 'src/common/editor/controller/effects/internal/nyquist/nyquist-host-service.ts', surfaces: ['interchange'] },
	{ file: 'src/common/editor/controller/edit/generator-service.ts', surfaces: ['composition'] },
	{ file: 'src/common/editor/controller/edit/internal/labeled-audio-silence.ts', surfaces: ['composition'] },
	{ file: 'src/common/editor/controller/composition/controller-project-queries.ts', surfaces: ['composition'] },
	{ file: 'src/common/editor/controller/effects/internal/effect-audio-service.ts', surfaces: ['audio-export'] },
	{ file: 'src/common/editor/controller/effects/internal/nyquist/nyquist-generated-audio-service.ts', surfaces: ['composition'] },
	{ file: 'src/common/editor/video-export.js', surfaces: ['video-export'] },
	{ file: 'src/common/editor/video-caption-cues.ts', surfaces: ['video-export'] },
	{ file: 'src/common/editor/video-keyframe-export-inventory.ts', surfaces: ['video-export'] },
	{ file: 'src/common/editor/ui/video-keyframe-offline-video-export.ts', surfaces: ['video-export'] },
	{ file: 'src/common/editor/video-timeline.js', surfaces: ['preview', 'composition', 'transition', 'navigation'] },
	{ file: 'src/common/editor/project.js', surfaces: ['navigation'] },
	{ file: 'src/common/editor/controller/track-audio/internal/clip-selection-navigation-service.ts', surfaces: ['navigation'] },
	{ file: 'src/common/editor/ui/timeline/useTimelineViewportModel.js', surfaces: ['timeline'] },
	{ file: 'src/common/editor/ui/framescaper-edit-control-menu-model.ts', surfaces: ['timeline'] },
	{ file: 'src/common/editor/controller/document/project-visual-service.ts', surfaces: ['waveform'] },
]);

/** Exact non-consumer readers co-located with a shield owner. No wildcard exclusions are admitted. */
export const FOUNDATION_RUNTIME_TIMING_READER_EXCLUSIONS: readonly FoundationRuntimeTimingReaderExclusion[] = deepFreeze([
	{
		file: 'src/common/editor/controller/edit/internal/labeled-audio-silence.ts', entryPoint: 'coveredSpans',
		reason: 'Private downstream helper receives the resolved AudioGeneratorProject from generateLabeledSilence; its caller crosses projectForAudioGeneratorCommands before planning spans.',
	},
	{
		file: 'src/common/editor/video-export.js',
		entryPoint: 'firstVisibleTimelineVideo',
		reason: 'Private downstream helper; every call passes the runtimeProject captured by a registered video-export boundary.',
	},
	{
		file: 'src/common/editor/timeline-annotation-riff-interchange.ts',
		entryPoint: 'createRiffAnnotationImport',
		reason: 'RIFF import creates new persisted sample-authoritative coordinates and does not consume resolved runtime timing.',
	},
]);

/** Non-shield importers discovered beside the owned consumer and boundary files. */
export const FOUNDATION_RUNTIME_PROJECTION_IMPORTER_EXCLUSIONS: readonly FoundationRuntimeProjectionImporterExclusion[] = deepFreeze([
	{
		file: 'src/common/editor/video-keyframe-export-frame-source.ts',
		reason: 'The immutable export snapshot preserves an existing runtime-projection brand after inheriting exact folder media state; projection and timing consumption remain owned by the upstream keyed-export inventory.',
	},
	{ file: 'src/common/editor/controller/composition/controller-options.ts', reason: 'Controller options use type-only projection imports to declare selected product consumer ports; this module executes no timing reads.' },
	{ file: 'src/common/editor/controller/import/project-bin-types.ts', reason: 'The bin declares authored clip and project input ports through type-only imports; it does not read transient clip coordinates.' },
	{
		file: 'src/common/editor/audio-warp-clip-authority.ts',
		reason: 'Warp authoring snapshots resolved clip geometry into immutable stale-edit authority; it is a persisted edit adapter rather than a runtime media consumer.',
	},
	{
		file: 'src/common/editor/audio-warp-clip-edit.ts',
		reason: 'Warp trim and split authoring resolve persisted clip boundaries before deriving exact child maps; they do not create a playback projection.',
	},
	{
		file: 'src/common/editor/controller/document/project-runtime.ts',
		reason: 'The default controller runtime binds command and presentation projections as edit adapters; selected product authority supplies the same closed surface.',
	},
	{
		file: 'src/common/editor/commands.js',
		reason: 'The command transaction brands a verified transient draft and is an edit adapter rather than a runtime consumer.',
	},
	{
		file: 'src/common/editor/commands/mutation-transaction.ts',
		reason: 'The shared mutation transaction verifies and brands a caller-owned command draft before applying registered edit handlers; it is not a runtime media consumer.',
	},
	{
		file: 'src/common/editor/commands/track-lock-admission.ts',
		reason: 'The command invariant compares protected resolved timing across transient and persisted authority domains; it does not serve runtime media consumers.',
	},
	{
		file: 'src/common/editor/commands/video-retime-preservation-admission.ts',
		reason: 'The command invariant compares protected curve geometry across transient and persisted authority domains; it does not serve runtime media consumers.',
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
		file: 'src/common/editor/commands/video-keyframes-runtime.ts',
		reason: 'Keyframe command mutation checks the transient command-projection brand only to mark ordered carrier ownership; it is an edit adapter rather than a runtime media consumer.',
	},
	{
		file: 'src/common/editor/commands/video-keyframe-segment-carrier.ts',
		reason: 'Keyframe segment preservation checks the transient command-projection brand and converts edit boundaries without becoming a playback or media consumer.',
	},
	{
		file: 'src/common/editor/commands/timeline-annotation-runtime.ts',
		reason: 'Timeline annotation command reconciliation restores authoritative wire coordinates from a branded command projection; it is an edit adapter rather than a runtime consumer.',
	},
	{
		file: 'src/common/editor/commands/timeline-annotation-ripple.ts',
		reason: 'Timeline annotation ripple verifies a branded command draft before staging authoritative-domain contraction; it is an edit adapter rather than a runtime consumer.',
	},
	{
		file: 'src/common/editor/commands/timeline-annotation-clipboard.ts',
		reason: 'Timeline annotation clipboard copy and paste restore authoritative coordinates and stage a complete projected command result; they are edit adapters rather than runtime consumers.',
	},
	{
		file: 'src/common/editor/frame-canonical-edge-trim-planner.ts',
		reason: 'The edge-trim command adapter requires an already-branded projection while planning authoritative frame-grid mutations; it does not create or consume a runtime playback projection.',
	},
	{
		file: 'src/common/editor/frame-canonical-clip-focus-step-request.ts',
		reason: 'The clip-focus step command adapter requires an already-branded projection while deriving one absolute adjacent-frame request from immutable linked video authority; it does not create or consume a runtime playback projection.',
	},
	{
		file: 'src/common/editor/frame-canonical-roll-ripple-trim-planner.ts',
		reason: 'The roll/ripple command adapter requires an already-branded projection while planning authoritative frame-grid mutations; it does not create or consume a runtime playback projection.',
	},
	{
		file: 'src/common/editor/frame-canonical-rate-stretch-planner.ts',
		reason: 'The rate-stretch command adapter requires an already-branded projection plus verified source timing while planning authoritative frame-grid mutations; it does not create or consume a runtime playback projection.',
	},
	{
		file: 'src/common/editor/frame-canonical-slip-slide-planner.ts',
		reason: 'The slip/slide command adapter requires an already-branded projection plus verified source timing while planning authoritative frame-grid mutations; it does not create or consume a runtime playback projection.',
	},
	{
		file: 'src/common/editor/frame-canonical-slip-slide-step-request.ts',
		reason: 'The slip/slide step command adapter requires an already-branded projection while deriving one absolute planner request from immutable frame authority; it does not create or consume a runtime playback projection.',
	},
	{
		file: 'src/common/editor/frame-canonical-slip-slide-pointer-request.ts',
		reason: 'The slip/slide pointer adapter requires an already-branded request-start projection plus verified source timing while capturing immutable gesture authority; it does not create or consume a runtime playback projection.',
	},
	{
		file: 'src/common/editor/controller/track-audio/internal/track-structural-operation-planner.ts',
		reason: 'The structural edit planner resolves clip placement while deriving one atomic alignment or sort command; it does not create or consume a runtime playback projection.',
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
		file: 'src/common/editor/project-command-projection.ts',
		reason: 'The command projection adapter explicitly converts between persisted authority and the runtime command surface.',
	},
	{
		file: 'src/common/editor/command-project-view.ts',
		reason: 'The command view owner constructs resolved timing and video sample-count aliases while preserving the remaining authored fields; persistence reconciliation belongs to project-command-projection.',
	},
	{
		file: 'src/common/editor/project-foundation-validation.ts',
		reason: 'Foundation validation intentionally resolves authoritative wire coordinates to prove bounds and derived equality.',
	},
	{
		file: 'src/common/editor/quality/m3-longform-editorial-workload.ts',
		reason: 'The deterministic qualification oracle resolves final clip positions only to compare persisted edit results against independently tracked expected coordinates; it is test workload construction rather than a runtime media consumer.',
	},
]);

function deepFreeze<Value>(value: Value): Readonly<Value> {
	if (!value || typeof value !== 'object') return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}

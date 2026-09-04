/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimeRoundingPolicy } from './timeline-time.ts';
import { FOUNDATION_RATE_CONVERSION_AUDIT_SITES } from './foundation-rate-conversion-audit-sites.ts';
import { deepFreezeAuditSites } from './foundation-audit-site-freeze.ts';
import { FOUNDATION_TIME_CONVERSION_ASSISTANCE_SITES } from './foundation-time-conversion-audit-assistance.ts';
import { FOUNDATION_TIME_CONVERSION_COMMAND_SITES } from './foundation-time-conversion-audit-commands.ts';

export type FoundationTimeConversionPolicy = TimeRoundingPolicy | 'exact';

export const FOUNDATION_TIME_CONVERSION_HELPERS: readonly string[] = Object.freeze([
	'roundRational',
	'secondsToSampleFrame',
	'sampleFrameToSeconds',
	'scaleSampleFrame',
	'videoFrameToSampleFrame',
	'sampleFrameToVideoFrame',
	'videoFrameRangeToSampleRange',
	'beatToSampleFrame',
	'countInSampleFrames',
	'sampleFrameToBeat',
]);

export interface FoundationTimeConversionClassification {
	readonly helper: string;
	readonly policies: readonly FoundationTimeConversionPolicy[];
}

export interface FoundationTimeConversionSite {
	readonly id: string;
	readonly file: string;
	readonly behavior: string;
	readonly conversions: readonly FoundationTimeConversionClassification[];
}

/**
 * Maintained WP-0.1 inventory of semantic timeline/timebase conversions.
 *
 * The paired audit test discovers calls through imports from the shared time
 * modules, including aliased imports, and requires an exact file/helper/policy
 * match here. Pixel, FFT, byte-size, and PCM-quantization rounding is outside
 * this deliberately narrow inventory.
 */
const FOUNDATION_TIME_CONVERSION_EDITOR_SITES: readonly FoundationTimeConversionSite[] = deepFreezeAuditSites([
	{
		id: 'audacity-live-capability-windows',
		file: 'src/common/editor/audacity-effects/live-capabilities.js',
		behavior: 'Declared fade and pause windows resolve their seconds as nearest sample instants, matching the live effect graph that consumes them.',
		conversions: [{ helper: 'secondsToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'audacity-annotation-import',
		file: 'src/common/editor/audacity-annotation-interchange.ts',
		behavior: 'Audacity label points and regions become nearest sample-authoritative V11 annotation coordinates at the imported project rate.',
		conversions: [{ helper: 'secondsToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'audacity-live-effect-windows',
		file: 'src/common/editor/audacity-effects/live-dynamics-processors.js',
		behavior: 'Compressor and limiter attack, release and lookahead windows resolve seconds as nearest sample instants, preserving Audacity block behavior.',
		conversions: [{ helper: 'secondsToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'audio-warp-quantization',
		file: 'src/common/editor/audio-warp-domain.ts',
		behavior: 'Transient quantization resolves each rational grid position once with the shared nearest-point policy before authoring one strictly increasing sample map.',
		conversions: [{ helper: 'roundRational', policies: ['point'] }],
	},
	{
		id: 'audio-warp-clip-editing',
		file: 'src/common/editor/audio-warp-clip-edit.ts',
		behavior: 'Musical warp trims and splits exactly invert their resolved sample boundary to one clip-local beat coordinate before slicing the persisted map.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }],
	},
	{
		id: 'audio-warp-runtime-authority',
		file: 'src/common/editor/audio-warp-runtime-authority.ts',
		behavior: 'Persisted and runtime musical warp authority exactly inverts resolved sample endpoints to verify that the authored beat domain matches the clip extent.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }],
	},
	{
		id: 'audio-warp-runtime-mapping',
		file: 'src/common/editor/audio-warp-runtime.ts',
		behavior: 'Runtime warp mapping encloses fractional beat and warp boundaries at both adjacent sample frames, and retains rational source positions between boundaries.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['enclosingStart', 'enclosingEnd'] },
			{ helper: 'roundRational', policies: ['enclosingStart', 'enclosingEnd'] },
		],
	},
	{
		id: 'automation-lane-frame-evaluation',
		file: 'src/common/editor/automation-lane-v21.ts',
		behavior: 'Musical automation evaluation exactly inverts the authoritative sample frame into its tempo-map beat before evaluating the persisted beat-domain curve.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }],
	},
	{
		id: 'automation-lane-timebase-conversion',
		file: 'src/common/editor/automation-lane-timebase-v21.ts',
		behavior: 'Switching a lane timebase projects each authored position through the tempo map once, exactly inverting a sample frame into its beat and resolving a beat back through the indexed projector that owns its rounding.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }],
	},
	{
		id: 'automation-lane-interval-editing',
		file: 'src/common/editor/automation-lane-interval-edit-v21.ts',
		behavior: 'Musical automation interval edits exactly invert each conformed sample boundary once before applying the requested edit in the lane-owned beat domain.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }],
	},
	{
		id: 'automation-lane-inline-editing',
		file: 'src/common/editor/automation-lane-inline-edit-v21.ts',
		behavior: 'Inline musical automation edits exactly invert each requested sample frame before placing a point or Bézier control in the lane-owned beat domain.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }],
	},
	{
		id: 'scheduled-parameter-context-offset',
		file: 'src/common/editor/engine/scheduled-parameter-registry.ts',
		behavior: 'Scheduled worklet events convert one exact project-frame delta and transport-rate ratio to the nearest context frame with later-frame ownership at exact half ties.',
		conversions: [{ helper: 'roundRational', policies: ['point'] }],
	},
	{
		id: 'legacy-aup-timeline-import',
		file: 'src/common/editor/aup-legacy-conversion.js',
		behavior: 'Legacy label, selection, source, clip, and envelope timestamps become nearest sample instants during interchange import.',
		conversions: [{ helper: 'secondsToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'aup4-clip-trim-profile',
		file: 'src/common/editor/aup4-clip-timing.ts',
		behavior: 'Audacity clip offset, trim, and extent values retain the historical nearest-sample wire behavior used by exact fixtures.',
		conversions: [{ helper: 'secondsToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'aup4-project-conversion',
		file: 'src/common/editor/aup4-conversion.js',
		behavior: 'AUP4 label and selection instants resolve as point coordinates without cumulative conversion drift.',
		conversions: [{ helper: 'secondsToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'aup4-conversion-settings',
		file: 'src/common/editor/aup4-conversion-settings.js',
		behavior: 'AUP4 view and envelope settings resolve their second-valued instants relative to the visible start as nearest sample frames.',
		conversions: [{ helper: 'secondsToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'aup4-conversion-wave-clips',
		file: 'src/common/editor/aup4-conversion-wave-clips.js',
		behavior: 'AUP4 wave clips derive their resampled destination length from the source extent and the two rates under point rounding.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'aup4-track-node-seconds',
		file: 'src/common/editor/aup4-track-nodes.js',
		behavior: 'AUP4 track nodes write clip, envelope and label instants as exact seconds, so a re-read recovers the sample frame they came from.',
		conversions: [{ helper: 'sampleFrameToSeconds', policies: ['exact'] }],
	},
	{
		id: 'aup4-profile-wire-values',
		file: 'src/common/editor/aup4-profile.js',
		behavior: 'AUP4 serialization preserves exact sample-to-second values and restores second-valued instants with nearest-sample rounding.',
		conversions: [
			{ helper: 'sampleFrameToSeconds', policies: ['exact'] },
			{ helper: 'secondsToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'riff-annotation-interchange',
		file: 'src/common/editor/timeline-annotation-riff-interchange.ts',
		behavior: 'RIFF cue import and export scale absolute range-relative sample boundaries once with nearest-point semantics at the source and destination rates.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'dawproject-arrangement-timing',
		file: 'src/common/editor/dawproject-import-timeline.ts',
		behavior: 'DAWproject beat-timed arrangement positions resolve to nearest sample instants, and sample positions invert to exact beats so a re-read of an imported clip lands where it was written.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'sampleFrameToBeat', policies: ['exact'] },
		],
	},
	{
		id: 'design-system-time-controls',
		file: 'src/common/editor/design-system-adapters/control-values.ts',
		behavior: 'Time controls expose exact seconds for display and commit edited seconds as clamped nearest sample instants.',
		conversions: [
			{ helper: 'sampleFrameToSeconds', policies: ['exact'] },
			{ helper: 'secondsToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'indexed-tempo-projection',
		file: 'src/common/editor/indexed-tempo-projector.ts',
		behavior: 'One validated held tempo map is preindexed at exact event positions, then arbitrary beat coordinates binary-search that index and point-round only their absolute result.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'roundRational', policies: ['point'] },
		],
	},
	{
		id: 'interpolation-inverse-cells',
		file: 'src/common/editor/interpolation-curve.ts',
		behavior: 'Interpolation inversion encloses a non-exact root in its authoritative whole-coordinate cell while retaining rational anchors until a consumer deliberately chooses that bracket.',
		conversions: [{ helper: 'roundRational', policies: ['enclosingEnd'] }],
	},
	{
		id: 'monotonic-tempo-projection',
		file: 'src/common/editor/monotonic-tempo-projector.ts',
		behavior: 'A nondecreasing beat stream validates the held map once, accumulates exact segment positions, and point-rounds each absolute result without rescanning prior events.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'roundRational', policies: ['point'] },
		],
	},
	{
		id: 'musical-signature-grid',
		file: 'src/common/editor/musical-grid.ts',
		behavior: 'Signature-map lookup floors an exact beat to its preceding bar while preserving every bar boundary as a rational beat.',
		conversions: [{ helper: 'roundRational', policies: ['directional'] }],
	},
	{
		id: 'musical-timeline-ruler',
		file: 'src/common/editor/ui/timeline/musical-ruler-model.ts',
		behavior: 'The viewport ruler exactly inverts sample bounds to beats and delegates its monotonic tick projection to the owned origin-exact projector.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }],
	},
	{
		id: 'rendered-fallback-video-extent',
		file: 'src/common/editor/project-feature-video-rendered-fallback.ts',
		behavior: 'A whole-project rendered fallback encloses every audio sample when deriving its minimum sequence-frame extent.',
		conversions: [{ helper: 'sampleFrameToVideoFrame', policies: ['enclosingEnd'] }],
	},
	{
		id: 'command-authority-reconciliation',
		file: 'src/common/editor/project-command-projection.ts',
		behavior: 'Command results conform frame-backed endpoints as points and invert resolved sample edits to exact musical coordinates.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'sampleFrameToBeat', policies: ['exact'] },
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
		],
	},
	{
		id: 'foundation-coordinate-validation',
		file: 'src/common/editor/project-foundation-validation.ts',
		behavior: 'Foundation validation resolves tempo events and musical extents as absolute point samples to prove ordering and safe ranges.',
		conversions: [{ helper: 'beatToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'foundation-media-factory',
		file: 'src/common/editor/project-media-factory.ts',
		behavior: 'Media factories enclose imported duration claims, resolve sample anchors as points, and derive video extents from absolute endpoints.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'sampleFrameToVideoFrame', policies: ['enclosingEnd', 'point'] },
			{ helper: 'videoFrameRangeToSampleRange', policies: ['point'] },
		],
	},
	{
		id: 'frame-canonical-edge-trim-planning',
		file: 'src/common/editor/frame-canonical-edge-trim-planner.ts',
		behavior: 'A video-bearing edge trim conforms one absolute requested boundary to the sequence grid and resolves its applied diagnostics from the absolute sequence origin.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'frame-canonical-clip-focus-step-request',
		file: 'src/common/editor/frame-canonical-clip-focus-step-request.ts',
		behavior: 'A focused linked-audio callback resolves its unique video edge plus one signed sequence-frame step directly to one absolute nearest-point sample request.',
		conversions: [{ helper: 'videoFrameToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'frame-canonical-roll-ripple-trim-planning',
		file: 'src/common/editor/frame-canonical-roll-ripple-trim-planner.ts',
		behavior: 'Roll and lane-ripple trims conform one requested edit point, then resolve every source cut, anchored program join, and shifted canonical video endpoint from absolute sequence frames.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'frame-canonical-slide-planning',
		file: 'src/common/editor/frame-canonical-slide-planning.ts',
		behavior: 'Slide planning substitutes one sequence-frame delta, maps immutable neighbor ratios once, and resolves every changed video endpoint from its absolute sequence frame.',
		conversions: [
			{ helper: 'roundRational', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'frame-canonical-slip-slide-planning',
		file: 'src/common/editor/frame-canonical-slip-slide-planner.ts',
		behavior: 'Slip and slide conform an absolute source or program request once and report their applied authority from absolute frame boundaries.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'frame-canonical-slip-slide-step-request',
		file: 'src/common/editor/frame-canonical-slip-slide-step-request.ts',
		behavior: 'One-frame slide actions resolve the immutable authority sequence start plus a signed frame step directly to one absolute nearest-point sample request.',
		conversions: [{ helper: 'videoFrameToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'verified-video-source-timing',
		file: 'src/common/editor/video-source-timing-view.ts',
		behavior: 'Verified CFR and VFR source evidence maps exact absolute source times to nearest source-grid points without timeline-domain accumulation.',
		conversions: [{ helper: 'roundRational', policies: ['point'] }],
	},
	{
		id: 'frame-canonical-rate-stretch-planning',
		file: 'src/common/editor/frame-canonical-rate-stretch-planner.ts',
		behavior: 'Uniform rate stretch conforms one absolute requested sequence edge, point-scales every immutable extent once, and resolves applied program endpoints from absolute sequence frames.',
		conversions: [
			{ helper: 'roundRational', policies: ['point'] },
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'frame-canonical-trim-participant-planning',
		file: 'src/common/editor/frame-canonical-trim-planning.ts',
		behavior: 'Shared trim participants validate canonical video endpoints, map immutable timeline/source ratios once, and resolve linked companion boundaries from absolute sequence frames.',
		conversions: [
			{ helper: 'roundRational', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'runtime-clip-projection',
		file: 'src/common/editor/runtime-clip-projection.ts',
		behavior: 'Single clips resolve musical points directly, while whole-project musical coordinates share the same exact point semantics through one indexed map; sequence-frame boundaries remain nearest sample points.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'm3-longform-position-oracle',
		file: 'src/common/editor/quality/m3-longform-editorial-workload.ts',
		behavior: 'The independent long-form position oracle converts each final projected video clip start to its nearest absolute sequence-frame point without accumulating edit deltas.',
		conversions: [{ helper: 'sampleFrameToVideoFrame', policies: ['point'] }],
	},
	{
		id: 'sequence-frame-navigation',
		file: 'src/common/editor/sequence-frame-navigation.ts',
		behavior: 'Sequence-frame navigation floors a sample onto its containing frame, then resolves every boundary it reports from the absolute origin as a nearest sample point, so snapping and stepping cannot accumulate error.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['enclosingStart'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'timeline-snap-grid',
		file: 'src/common/editor/snap-grid.js',
		behavior: 'Grid selection inverts the absolute sample to an exact beat, uses explicit previous/next intent, then resolves the chosen boundary once as a point sample.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'roundRational', policies: ['directional', 'point'] },
			{ helper: 'sampleFrameToBeat', policies: ['exact'] },
		],
	},
	{
		id: 'timeline-annotation-validation',
		file: 'src/common/editor/timeline-annotation.ts',
		behavior: 'Annotation validation resolves persisted musical marker points and region endpoints against the authoritative tempo map as point samples to enforce non-negative positions and positive spans.',
		conversions: [{ helper: 'beatToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'source-monitor-program-frame',
		file: 'src/common/editor/source-monitor-model.ts',
		behavior: 'The frame under the program playhead resolves the matched clip\'s sequence range to absolute samples from the sequence origin as point coordinates; the monitor\'s own playhead stays in source frames and is never converted.',
		conversions: [{ helper: 'videoFrameToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'three-point-edit-resolution',
		file: 'src/common/editor/three-point-edit.ts',
		behavior: 'Three-point editing converts the duration of the fully specified pair once as an exact integer change of basis, point-rounded, then resolves the sequence range to absolute samples from the sequence origin.',
		conversions: [
			{ helper: 'roundRational', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'video-source-upgrade-conform',
		file: 'src/common/editor/video-source-upgrade.ts',
		behavior: 'Re-reading a source conforms each persisted clip boundary onto the corrected nominal grid as an exact integer change of basis, point-rounded, so both endpoints move independently rather than a duration being scaled.',
		conversions: [{ helper: 'roundRational', policies: ['point'] }],
	},
	{
		id: 'trim-media-rewritten-source-length',
		file: 'src/common/editor/trim-media-project-edit.ts',
		behavior: 'A trimmed video source states its length in pictures, and the sample-frame length the document also holds is derived from that count with the enclosing-end policy, so the audio side is never shorter than the pictures it accompanies.',
		conversions: [{ helper: 'videoFrameToSampleFrame', policies: ['enclosingEnd'] }],
	},
	...FOUNDATION_RATE_CONVERSION_AUDIT_SITES,
	{
		id: 'tempo-map-sample-inverse',
		file: 'src/common/editor/timeline-tempo-inverse.ts',
		behavior: 'Tempo inversion accumulates exact event spans, point-rounds each event boundary, and returns the edited sample position as an exact rational beat.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'roundRational', policies: ['point'] },
		],
	},
]);

/** Every maintained conversion site: the editor foundation plus the assistance slices. */
export const FOUNDATION_TIME_CONVERSION_SITES: readonly FoundationTimeConversionSite[] = Object.freeze([
	...FOUNDATION_TIME_CONVERSION_EDITOR_SITES,
	...FOUNDATION_TIME_CONVERSION_COMMAND_SITES,
	...FOUNDATION_TIME_CONVERSION_ASSISTANCE_SITES,
]);


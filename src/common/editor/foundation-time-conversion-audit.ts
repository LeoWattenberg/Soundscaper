/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimeRoundingPolicy } from './timeline-time.ts';

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
export const FOUNDATION_TIME_CONVERSION_SITES: readonly FoundationTimeConversionSite[] = deepFreeze([
	{
		id: 'audacity-annotation-import',
		file: 'src/common/editor/audacity-annotation-interchange.ts',
		behavior: 'Audacity label points and regions become nearest sample-authoritative V11 annotation coordinates at the imported project rate.',
		conversions: [{ helper: 'secondsToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'audacity-live-effect-windows',
		file: 'src/common/editor/audacity-effects/live.js',
		behavior: 'Effect durations and analysis windows resolve seconds as nearest sample instants, preserving Audacity block behavior.',
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
		behavior: 'Runtime warp mapping point-resolves beat and warp boundaries once, and retains rational source positions between boundaries.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'roundRational', policies: ['point'] },
		],
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
		behavior: 'AUP4 labels, selections, envelopes, and resampled lengths resolve as point coordinates without cumulative conversion drift.',
		conversions: [
			{ helper: 'scaleSampleFrame', policies: ['point'] },
			{ helper: 'secondsToSampleFrame', policies: ['point'] },
		],
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
		id: 'canonical-video-transform-placement',
		file: 'src/common/editor/commands/canonical-video-transform-placement.ts',
		behavior: 'A frame-canonical transform verifies its absolute sequence-frame placement against the resolved sample aliases serialized beside it before command reconciliation preserves that authority.',
		conversions: [{ helper: 'videoFrameToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'clipboard-video-conformance',
		file: 'src/common/editor/commands/clipboard-time-runtime.js',
		behavior: 'Clipboard placement, insert space, and overlap removal share destination-anchored nearest sequence-frame endpoints.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'clipboard-annotation-authority',
		file: 'src/common/editor/commands/timeline-annotation-clipboard.ts',
		behavior: 'Clipboard annotation copy and paste exactly preserve musical offsets while sample offsets use the shared nearest-point sample-rate policy.',
		conversions: [
			{ helper: 'sampleFrameToBeat', policies: ['exact'] },
			{ helper: 'scaleSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'split-video-conformance',
		file: 'src/common/editor/commands/clip-link-runtime.js',
		behavior: 'Linked and video-only splits conform one absolute sample boundary to a nearest sequence frame and resolve it back once.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'overwrite-video-collision-conformance',
		file: 'src/common/editor/commands/clip-transform-runtime.js',
		behavior: 'Video overwrite collision cuts conform the active clip endpoints to nearest sequence frames before segmenting inactive material.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'range-video-conformance',
		file: 'src/common/editor/commands/range-sequence-geometry.ts',
		behavior: 'Range operations conform both absolute boundaries once to nearest sequence frames and derive the resolved sample extent.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'sequence-timing-rate-change',
		file: 'src/common/editor/commands/sequence-timing-runtime.ts',
		behavior: 'A sequence rate change conforms each video placement by point-rounding both of its resolved absolute boundaries onto the new grid, then reports the resolved duration those conformed boundaries carry.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'timeline-annotation-ripple-authority',
		file: 'src/common/editor/commands/timeline-annotation-ripple.ts',
		behavior: 'A whole-sequence ripple exactly inverts its single conformed sample span to one musical span before applying both authoritative-domain deltas.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }],
	},
	{
		id: 'riff-annotation-interchange',
		file: 'src/common/editor/timeline-annotation-riff-interchange.ts',
		behavior: 'RIFF cue import and export scale absolute range-relative sample boundaries once with nearest-point semantics at the source and destination rates.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'tempo-command-map-authority',
		file: 'src/common/editor/commands/tempo-signature-runtime.ts',
		behavior: 'Tempo mode conversion resolves exact musical event beats once to nearest authoritative sample positions before re-deriving continuous exact beats.',
		conversions: [{ helper: 'beatToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'legacy-recording-count-in',
		file: 'src/common/editor/controller/legacy-recording-capture-service.ts',
		behavior: 'Legacy capture delegates current projects to the authoritative map schedule and retains one point-rounded default-map fallback for map-absent callers.',
		conversions: [{ helper: 'countInSampleFrames', policies: ['point'] }],
	},
	{
		id: 'nyquist-active-map-tempo',
		file: 'src/common/editor/controller/nyquist-host-service.ts',
		behavior: 'Nyquist interchange exactly inverts the evaluation-start sample once, then selects the last authoritative event at or before that beat.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }],
	},
	{
		id: 'routed-recording-count-in',
		file: 'src/common/editor/controller/routed-recording-capture-service.ts',
		behavior: 'Routed capture shares the authoritative map schedule and retains the same point-rounded default-map fallback for map-absent callers.',
		conversions: [{ helper: 'countInSampleFrames', policies: ['point'] }],
	},
	{
		id: 'timeline-annotation-controller-conversion',
		file: 'src/common/editor/controller/timeline-annotation-conversion.ts',
		behavior: 'Annotation kind and anchor conversion preserves musical authority when present and otherwise exactly inverts its resolved sample endpoints.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }],
	},
	{
		id: 'timeline-annotation-controller-editing',
		file: 'src/common/editor/controller/timeline-annotation-service.ts',
		behavior: 'Annotation creation, movement, and resizing exactly invert user-selected sample positions into the matching musical-authority coordinates.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }],
	},
	{
		id: 'video-source-import-placement',
		file: 'src/common/editor/controller/source-import.ts',
		behavior: 'Imported video duration encloses the probed source while timeline placement resolves absolute endpoints as point coordinates.',
		conversions: [{ helper: 'sampleFrameToVideoFrame', policies: ['enclosingEnd', 'point'] }],
	},
	{
		id: 'transport-metronome-schedule',
		file: 'src/common/editor/controller/transport-model.ts',
		behavior: 'Transport inverts the absolute sample through the tempo map, selects the next signature-denominator pulse directionally, and point-resolves count-in and click endpoints from the map origin.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'roundRational', policies: ['directional', 'point'] },
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
		file: 'src/common/editor/project-v10-command-projection.ts',
		behavior: 'Command results conform frame-backed endpoints as points and invert resolved sample edits to exact musical coordinates.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'sampleFrameToBeat', policies: ['exact'] },
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
		],
	},
	{
		id: 'foundation-coordinate-validation',
		file: 'src/common/editor/project-v10-foundation-validation.ts',
		behavior: 'Foundation validation resolves tempo events and musical extents as absolute point samples to prove ordering and safe ranges.',
		conversions: [{ helper: 'beatToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'foundation-factory-compatibility',
		file: 'src/common/editor/project-v10.ts',
		behavior: 'Factories enclose legacy duration claims, resolve legacy anchors as points, and derive video extents from absolute endpoints.',
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
		id: 'video-edit-service-points',
		file: 'src/common/editor/controller/video-edit-service.ts',
		behavior: 'The edit service resolves the time selection onto the sequence grid as point coordinates and maps the resolved source range once into source samples for the linked audio member.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
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
		id: 'tempo-map-sample-inverse',
		file: 'src/common/editor/timeline-tempo-inverse.ts',
		behavior: 'Tempo inversion accumulates exact event spans, point-rounds each event boundary, and returns the edited sample position as an exact rational beat.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'roundRational', policies: ['point'] },
		],
	},
]);

function deepFreeze<Value>(value: Value): Readonly<Value> {
	if (!value || typeof value !== 'object') return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}

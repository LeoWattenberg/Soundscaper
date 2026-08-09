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
		id: 'audacity-live-effect-windows',
		file: 'src/common/editor/audacity-effects/live.js',
		behavior: 'Effect durations and analysis windows resolve seconds as nearest sample instants, preserving Audacity block behavior.',
		conversions: [{ helper: 'secondsToSampleFrame', policies: ['point'] }],
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
		id: 'clipboard-video-conformance',
		file: 'src/common/editor/commands/clipboard-time-runtime.js',
		behavior: 'Clipboard placement, insert space, and overlap removal share destination-anchored nearest sequence-frame endpoints.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
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
		file: 'src/common/editor/commands/range-runtime.js',
		behavior: 'Range operations conform both absolute boundaries once to nearest sequence frames and derive the resolved sample extent.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'legacy-recording-count-in',
		file: 'src/common/editor/controller/legacy-recording-capture-service.ts',
		behavior: 'Legacy recording resolves the whole musical count-in once to a nearest sample boundary, including compound meters.',
		conversions: [{ helper: 'countInSampleFrames', policies: ['point'] }],
	},
	{
		id: 'routed-recording-count-in',
		file: 'src/common/editor/controller/routed-recording-capture-service.ts',
		behavior: 'Routed recording shares the same origin-based nearest-sample count-in conversion as the legacy capture route.',
		conversions: [{ helper: 'countInSampleFrames', policies: ['point'] }],
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
		behavior: 'Transport selects the next enclosing beat and then resolves that beat from the absolute tempo-map origin to a point sample.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'roundRational', policies: ['enclosingEnd'] },
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
		id: 'runtime-clip-projection',
		file: 'src/common/editor/runtime-clip-projection.ts',
		behavior: 'The consumer-facing projection resolves musical and sequence-frame absolute boundaries as nearest sample points.',
		conversions: [
			{ helper: 'beatToSampleFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'timeline-snap-grid',
		file: 'src/common/editor/snap-grid.js',
		behavior: 'Grid selection uses explicit previous or next directional intent while materialized snapped positions use point rounding.',
		conversions: [{ helper: 'roundRational', policies: ['directional', 'point'] }],
	},
	{
		id: 'tempo-map-sample-inverse',
		file: 'src/common/editor/timeline-tempo-inverse.ts',
		behavior: 'Tempo inversion finds point-rounded event boundaries and returns the edited sample position as an exact rational beat.',
		conversions: [{ helper: 'beatToSampleFrame', policies: ['point'] }],
	},
]);

function deepFreeze<Value>(value: Value): Readonly<Value> {
	if (!value || typeof value !== 'object') return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { deepFreezeAuditSites } from './foundation-audit-site-freeze.ts';
import type { FoundationTimeConversionSite } from './foundation-time-conversion-audit.ts';

/**
 * Conversion sites owned by the editor's controller services and command runtimes.
 *
 * They sit beside the foundation inventory for the same reason the assistance sites do:
 * these two directories account for a third of the maintained sites and grow with almost
 * every command or service slice. The paired audit test reads them through the combined
 * export, so a site is no less checked for living here.
 */
export const FOUNDATION_TIME_CONVERSION_COMMAND_SITES: readonly FoundationTimeConversionSite[] = deepFreezeAuditSites([
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
		id: 'video-keyframe-carrier-boundaries',
		file: 'src/common/editor/commands/video-keyframe-carrier.ts',
		behavior: 'Keyframe segment boundaries convert resolved absolute sample instants to nearest sequence-frame points before exact authored-view trimming.',
		conversions: [{ helper: 'sampleFrameToVideoFrame', policies: ['point'] }],
	},
	{
		id: 'overwrite-video-collision-conformance',
		file: 'src/common/editor/commands/clip-overwrite-ranges.js',
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
		id: 'tempo-command-map-authority',
		file: 'src/common/editor/commands/tempo-signature-runtime.ts',
		behavior: 'Tempo mode conversion resolves exact musical event beats once to nearest authoritative sample positions before re-deriving continuous exact beats.',
		conversions: [{ helper: 'beatToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'framescaper-capture-canonical-duration',
		file: 'src/common/editor/controller/framescaper-capture-canonical-assets.ts',
		behavior: 'Canonical capture publication point-resolves an exact sealed PCM or probed video duration once onto the project sample grid before planning its source and clip extent.',
		conversions: [{ helper: 'roundRational', policies: ['point'] }],
	},
	{
		id: 'framescaper-capture-origin-placement',
		file: 'src/common/editor/controller/framescaper-capture-app-binding.ts',
		behavior: 'Capture admission freezes the active playhead as nearest-point microseconds, and publication resolves that same origin once onto the exact project sample grid.',
		conversions: [{ helper: 'roundRational', policies: ['point'] }],
	},
	{
		id: 'framescaper-capture-stream-presentation-range',
		file: 'src/common/editor/controller/framescaper-capture-stream-timing.ts',
		behavior: 'Each manifest-acknowledged presentation start and end resolves once to nearest project-frame boundaries while retaining the exact microsecond range beside it.',
		conversions: [{ helper: 'roundRational', policies: ['point'] }],
	},
	{
		id: 'framescaper-capture-sequence-conformance',
		file: 'src/common/editor/controller/framescaper-capture-publication-plan.ts',
		behavior: 'Captured video placement point-conforms both resolved sample endpoints to the destination sequence grid, then owns the enclosing sample range represented by those sequence frames.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameRangeToSampleRange', policies: ['point'] },
		],
	},
	{
		id: 'legacy-recording-count-in',
		file: 'src/common/editor/controller/legacy-recording-capture-service.ts',
		behavior: 'Legacy capture delegates count-in to the authoritative map, encloses the recorder start after its context-time projection, and encloses any finite selected stop after changing sample-rate basis.',
		conversions: [
			{ helper: 'countInSampleFrames', policies: ['point'] },
			{ helper: 'secondsToSampleFrame', policies: ['enclosingEnd'] },
			{ helper: 'scaleSampleFrame', policies: ['enclosingEnd'] },
		],
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
		behavior: 'Routed capture shares the authoritative count-in map, encloses its recorder context start, and independently encloses each routed source stop after changing sample-rate basis.',
		conversions: [
			{ helper: 'countInSampleFrames', policies: ['point'] },
			{ helper: 'secondsToSampleFrame', policies: ['enclosingEnd'] },
			{ helper: 'scaleSampleFrame', policies: ['enclosingEnd'] },
		],
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
		id: 'clip-resample-output-extent',
		file: 'src/common/editor/controller/clip-resample-service.ts',
		behavior: 'Resampling point-rounds the source frame count once into the requested rate so the rendered extent and its storage preflight agree on one output length.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'clip-time-pitch-render-extent',
		file: 'src/common/editor/controller/clip-time-pitch-render-service.ts',
		behavior: 'A rendered time-and-pitch clip point-rounds its output frame count out of the source rate into the project rate once, so the timeline extent it commits spans the same time the render produced.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'video-source-import-placement',
		file: 'src/common/editor/controller/source-import.ts',
		behavior: 'Metadata-only imported video duration encloses the probed source; exact timing-sidecar placement is delegated to its separately registered authority helper.',
		conversions: [{ helper: 'sampleFrameToVideoFrame', policies: ['enclosingEnd'] }],
	},
	{
		id: 'video-import-exact-timing-authority',
		file: 'src/common/editor/controller/video-import-timing.ts',
		behavior: 'Exact timing-sidecar duration is point-rounded once into sample authority before both placement endpoints are point-conformed through the destination sequence grid.',
		conversions: [
			{ helper: 'roundRational', policies: ['point'] },
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
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
		id: 'video-edit-service-points',
		file: 'src/common/editor/controller/video-edit-service.ts',
		behavior: 'The edit service resolves the time selection onto the sequence grid as point coordinates and maps the resolved source range once into source samples for the linked audio member.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
]);

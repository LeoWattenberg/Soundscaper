/* SPDX-License-Identifier: AGPL-3.0-only */

import { deepFreezeAuditSites } from './foundation-audit-site-freeze.ts';
import type { FoundationTimeConversionSite } from './foundation-time-conversion-audit.ts';

/**
 * Conversion sites owned by the local assistance slices.
 *
 * They live beside the editor foundation inventory rather than inside it: assistance adds
 * a site with almost every slice, and the combined list had grown past the maintainability
 * ceiling. The paired audit test reads both through the combined export.
 */
const ASSISTANCE_SITES: readonly FoundationTimeConversionSite[] = [
	{
		id: 'assistance-owned-audio-workflow-transforms',
		file: 'src/common/editor/assistance/owned-audio-workflow-transforms-v1.ts',
		behavior: 'Owned diarization turns and word alignments cross from their model rate to the source rate by outward-enclosing each start and end, so an accepted span never trims the audio it was recognised from.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point', 'enclosingStart', 'enclosingEnd'] }],
	},
	{
		id: 'assistance-owned-highlight-workflow-transforms',
		file: 'src/common/editor/assistance/owned-highlight-workflow-transforms-v1.ts',
		behavior: 'Owned highlight spans carry transcript and audio-tag sample positions onto the video timeline by outward-enclosing both edges before the nearest authority frame is chosen.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['enclosingStart', 'enclosingEnd'] }],
	},
	{
		id: 'local-assistance-audio-geometry-conversion',
		file: 'src/common/editor/controller/local-assistance-audio-geometry.ts',
		behavior: 'Prepared assistance audio resolves its complete project-rate frame count once to the nearest model-rate output length before bounded streaming resampling.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'local-assistance-beat-conversion',
		file: 'src/common/editor/controller/local-assistance-beat-acceptance.ts',
		behavior: 'Reviewed beats point-resolve the selected source extent at the model rate and place each accepted downbeat on the nearest project frame, because a beat marks an instant rather than a span.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'local-assistance-guided-highlight-preparation',
		file: 'src/common/editor/controller/local-assistance-guided-highlight-preparation.ts',
		behavior: 'Guided highlight preparation point-resolves the prepared audio duration at the video rate to prove a linked pair describes the same extent before either is staged.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'local-assistance-guided-highlight-signals',
		file: 'src/common/editor/controller/local-assistance-guided-highlight-signals.ts',
		behavior: 'Guided highlight signals point-resolve the analysed duration at the fixed audio rate and outward-enclose each scanned window, so an energy block is never sampled short of the range it covers.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point', 'enclosingStart', 'enclosingEnd'] }],
	},
	{
		id: 'local-assistance-guided-highlight-transcript',
		file: 'src/common/editor/controller/local-assistance-guided-highlight-transcript.ts',
		behavior: 'Guided highlight transcript segments point-resolve the analysed duration and outward-enclose each segment onto the selected video timeline, so a spoken segment keeps the frames it started and ended within.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point', 'enclosingStart', 'enclosingEnd'] }],
	},
	{
		id: 'local-assistance-reaction-conversion',
		file: 'src/common/editor/controller/local-assistance-reaction-acceptance.ts',
		behavior: 'Reviewed reactions point-resolve the selected source extent at the tagging rate, then outward-enclose each accepted reaction span before it is clamped to the timeline duration.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point', 'enclosingStart', 'enclosingEnd'] }],
	},
	{
		id: 'local-assistance-selected-video-timing',
		file: 'src/common/editor/controller/local-assistance-selected-video-timing.ts',
		behavior: 'Selected video timing projects an elapsed rational position onto the sequence frame count with the shared nearest-point policy, so a probe instant resolves to one frame.',
		conversions: [{ helper: 'roundRational', policies: ['point'] }],
	},
	{
		id: 'local-assistance-cleanup-range-conversion',
		file: 'src/common/editor/controller/local-assistance-cleanup-acceptance.ts',
		behavior: 'Reviewed voice activity point-resolves the selected source extent at the model rate, then encloses accepted silence strictly inside the speech-free source range before authoring one ripple edit.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point', 'enclosingStart', 'enclosingEnd'] }],
	},
	{
		id: 'local-assistance-range-label-conversion',
		file: 'src/common/editor/controller/local-assistance-range-label-acceptance.ts',
		behavior: 'Reviewed voice and speaker ranges point-resolve the selected source extent at the model rate, then outward-enclose each accepted label on the project timeline.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point', 'enclosingStart', 'enclosingEnd'] }],
	},
];

export const FOUNDATION_TIME_CONVERSION_ASSISTANCE_SITES = deepFreezeAuditSites(ASSISTANCE_SITES);


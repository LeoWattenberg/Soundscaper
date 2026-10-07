/* SPDX-License-Identifier: AGPL-3.0-only */

import { deepFreezeAuditSites } from './foundation-audit-site-freeze.ts';
import type { FoundationTimeConversionSite } from './foundation-time-conversion-audit.ts';

/** Exact native visual editing boundaries, with sample aliases owned only by the live preview. */
export const FOUNDATION_TIME_CONVERSION_VISUAL_EDIT_SITES: readonly FoundationTimeConversionSite[] = deepFreezeAuditSites([
	{
		id: 'timeline-image-trim-sequence-boundaries',
		file: 'src/common/editor/timeline-image-trim.ts',
		behavior: 'Image trims resolve requested sample boundaries to nearest authored sequence frames, then convert the clamped absolute start back to a nearest sample point before resolving the requested end; image duration and animated source phase remain on their native clocks.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'timeline-image-trim-pointer-preview',
		file: 'src/common/editor/ui/timeline/image-trim-pointer-preview.ts',
		behavior: 'Image trim previews use the same sequence-boundary trim planner as commit and convert its absolute start and end once to nearest project sample positions for the live timeline, deriving duration from their difference without publishing history.',
		conversions: [{ helper: 'videoFrameToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'timeline-generator-trim-sequence-boundaries',
		file: 'src/common/editor/timeline-generator-trim.ts',
		behavior: 'Generated visual trims resolve requested sample positions to nearest sequence boundaries, carry the native source window with the authored sequence change, and resolve the requested right edge from the clamped absolute start sample point.',
		conversions: [
			{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
			{ helper: 'videoFrameToSampleFrame', policies: ['point'] },
		],
	},
	{
		id: 'timeline-generator-trim-pointer-preview',
		file: 'src/common/editor/ui/timeline/generator-trim-pointer-preview.ts',
		behavior: 'Generator trim previews use the owning sequence/source trim planner and convert the resulting absolute sequence start and end once to nearest project samples, preserving exact source phase and keeping the preview out of history.',
		conversions: [{ helper: 'videoFrameToSampleFrame', policies: ['point'] }],
	},
	{
		id: 'timeline-generator-split-boundary',
		file: 'src/framescaper/editor-timeline-generator-split-command.ts',
		behavior: 'The generated visual split consumer resolves the requested project sample to the nearest authored sequence boundary before partitioning its exact sequence extent and native source window; compound cuts observe earlier generated visual mutations.',
		conversions: [{ helper: 'sampleFrameToVideoFrame', policies: ['point'] }],
	},
]);

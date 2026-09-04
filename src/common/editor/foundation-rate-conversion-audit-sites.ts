/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FoundationTimeConversionSite } from './foundation-time-conversion-audit.ts';

/** Focused WP-0.1 inventory for integer sample-rate changes of basis. */
export const FOUNDATION_RATE_CONVERSION_AUDIT_SITES: readonly FoundationTimeConversionSite[] = [
	{
		id: 'export-output-frame-sizing',
		file: 'src/common/editor/export.js',
		behavior: 'Programme and effect-tail extents are independently scaled into the output rate with enclosing-end rounding so neither requested range can be shortened by conversion.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['enclosingEnd'] }],
	},
	{
		id: 'aup4-export-resample-length',
		file: 'src/common/editor/aup4-export-variants.js',
		behavior: 'AUP4 export derives the destination PCM extent from the admitted source length and source/output rates under point rounding before the bounded resampler runs.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'project-bin-source-rate-conform',
		file: 'src/common/editor/commands/project-source-bin-runtime.js',
		behavior: 'Project Bin source replacement changes clip source starts and extents from the prior source rate into the replacement source rate under point rounding.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'incremental-wav-import-duration',
		file: 'src/common/editor/controller/incremental-wav-import-service.ts',
		behavior: 'Incremental WAV import changes the decoded source length into project-rate timeline frames once under point rounding.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'linked-wav-import-duration',
		file: 'src/common/editor/controller/linked-wav-import-service.ts',
		behavior: 'Linked WAV import changes the verified descriptor length into project-rate timeline frames once under point rounding.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'decoded-project-import-duration',
		file: 'src/common/editor/controller/project-import-service.ts',
		behavior: 'Decoded audio import changes canonical buffer length into project-rate clip duration once under point rounding.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'source-audio-resample-length',
		file: 'src/common/editor/controller/source-audio.ts',
		behavior: 'Source materialization derives the destination buffer length from the source and requested rates under point rounding before resampling.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'track-resample-derived-length',
		file: 'src/common/editor/controller/track-transform-service.ts',
		behavior: 'Track resampling uses the same point-rounded source-to-project rate conversion for storage preflight and the actual derived output extent.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'offline-context-rate-projection',
		file: 'src/common/editor/engine/rendering.ts',
		behavior: 'Offline rendering changes requested and warmup project extents into the actual audio-context rate under point rounding before scheduling capture.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'mastering-sequence-output-rate',
		file: 'src/common/editor/mastering-sequence-delivery.ts',
		behavior: 'Each authored gap, region extent, and fade changes sample-rate basis independently under point rounding before accumulation, preserving the sequence part boundaries.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'recording-preview-rate-conform',
		file: 'src/common/editor/controller/recording-model.ts',
		behavior: 'Captured frame counts change from the input device rate to the project output rate once under point rounding without unsafe floating multiplication.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'project-bin-replacement-rate-conform',
		file: 'src/common/editor/controller/project-bin-replacement-service.ts',
		behavior: 'Replacement admission maps source starts and extents from the prior media rate into the candidate rate under point rounding before checking for shortened clips.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
];

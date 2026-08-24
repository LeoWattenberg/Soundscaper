/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectEffectTailFrames } from '../effects.js';
import type { ScheduledChunkStreamUnderrun } from './clip-scheduler.ts';
import { clamp, DEFAULT_SAMPLE_RATE, MAX_EFFECT_TAIL_SECONDS } from './buffer-math.ts';
import type { EngineProject } from './types.ts';

const tailFrames = projectEffectTailFrames as (
	project: EngineProject,
	options?: Readonly<{
		trackId?: unknown;
		includeMaster?: boolean;
		maximumSeconds?: number;
	}>,
) => number;

export function resolveRenderTailSeconds(
	project: EngineProject,
	includeTail: boolean | number,
	{ trackId = null, includeMaster = true }: Readonly<{
		trackId?: unknown;
		includeMaster?: boolean;
	}> = {},
): number {
	if (!includeTail) return 0;
	if (typeof includeTail === 'number' && Number.isFinite(includeTail)) {
		return clamp(includeTail, 0, MAX_EFFECT_TAIL_SECONDS);
	}
	return tailFrames(project, {
		trackId: trackId == null ? null : String(trackId),
		includeMaster,
		maximumSeconds: MAX_EFFECT_TAIL_SECONDS,
	}) / (project.sampleRate || DEFAULT_SAMPLE_RATE);
}

export function realtimeRenderUnderrunError(details: ScheduledChunkStreamUnderrun): Error {
	const error = Object.assign(new Error('A streamed source underrun made the realtime render incomplete.'), {
		code: 'REALTIME_RENDER_UNDERRUN', details: Object.freeze({ ...details }),
	});
	error.name = 'RealtimeRenderUnderrunError';
	return error;
}

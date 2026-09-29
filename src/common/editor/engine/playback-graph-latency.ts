/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EngineRuntimeHost, EngineRuntimeMethodMap } from './runtime-types.ts';

export const enginePlaybackGraphLatencyMethods = {
	getPlaybackGraphLatencyFrames(this: EngineRuntimeHost): number {
		const frames = this.graph?.latencyFrames;
		return typeof frames === 'number' && Number.isSafeInteger(frames) && frames > 0 ? frames : 0;
	},
} satisfies EngineRuntimeMethodMap<'getPlaybackGraphLatencyFrames'>;

/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EffectAudioProject } from './effect-audio-service-types.ts';
import type { SourceLifecycleLoadOptions, SourceLifecycleProject } from '../../source/source-lifecycle-service.ts';
import type { EngineSourceBufferInput } from '../../../engine/public-api.ts';

interface Runtime {
	readonly sourceBuffers: EngineSourceBufferInput;
	loadProjectSources(project: SourceLifecycleProject, options: SourceLifecycleLoadOptions): Promise<ReadonlyMap<string, AudioBuffer>>;
}

/** An isolated effect may read media that ordinary playback has not admitted. */
export function createEffectRenderSourcePreparation(runtime: Runtime) {
	return async (project: EffectAudioProject, signal: AbortSignal | null): Promise<EngineSourceBufferInput> => {
		const clipIds = new Set(project.tracks.flatMap(track => track.clipIds ?? []));
		const requiredAudioSourceIds = [...new Set(project.clips.filter(clip => clipIds.has(clip.id)
			&& clip.kind !== 'video').map(clip => clip.sourceId))];
		const transient = await runtime.loadProjectSources(project as unknown as SourceLifecycleProject, {
			onlyRequiredAudioSources: true, requiredAudioSourceIds, signal: signal ?? undefined,
		});
		if (!transient.size) return runtime.sourceBuffers;
		const buffers = runtime.sourceBuffers as ReadonlyMap<unknown, AudioBuffer>;
		const entries = typeof buffers.entries === 'function' ? buffers.entries() : Object.entries(runtime.sourceBuffers);
		return new Map<unknown, AudioBuffer>([...entries, ...transient]);
	};
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { registerParallelStackPlayback, parallelStackWorkerCount, type ParallelStackPlaybackRequest } from '../../../engine/parallel-stack-playback.ts';
import { publishParallelStackStatus, readParallelStackPreferences, parallelStackConfigurationRevision, type ParallelStackPreferences } from '../../../engine/parallel-stack-preferences.ts';
import type { ProjectGraph } from '../../../engine/project-graph.ts';
import { getParametricEqWasmModule } from '../../../engine/effect-worklets.ts';

export interface ParallelStackRegistrationResources {
	readonly preferences: () => ParallelStackPreferences;
	readonly supported: () => boolean;
	readonly prepare: (request: ParallelStackPlaybackRequest, preferences: ParallelStackPreferences, signal: AbortSignal) => Promise<ProjectGraph>;
}

const resources: ParallelStackRegistrationResources = {
	preferences: () => readParallelStackPreferences(),
	supported: () => globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function'
		&& typeof Worker === 'function' && typeof AudioWorkletNode === 'function',
	prepare: async (request, preferences, signal) => {
		const [{ compileParallelStackPlan }, { createParallelStackSession }] = await Promise.all([
			import('../../../engine/parallel-stack-plan.ts'), import('./parallel-stack-session.ts'),
		]);
		const hardwareLimit = Math.max(1, Math.min(8, (globalThis.navigator?.hardwareConcurrency || 4) - 2));
		const workerCount = preferences.workerLimit === 'auto' ? hardwareLimit : Math.min(hardwareLimit, preferences.workerLimit);
		const plan = compileParallelStackPlan(request.project, {
			sampleRate: request.context.sampleRate, workerCount,
			parametricEqWasmModule: getParametricEqWasmModule(request.context),
		});
		const graph = await createParallelStackSession(request, plan, preferences.pipelineFrames, signal);
		return graph;
	},
};

/** Called only for the Soundscaper playback engine, never a renderer/export engine. */
export function installParallelStackPlayback(engine: object, ports: ParallelStackRegistrationResources = resources): void {
	let failedConfiguration: string | null = null;
	registerParallelStackPlayback(engine, async (request, signal) => {
		const preferences = ports.preferences();
		if (!preferences.enabled) {
			failedConfiguration = null;
			publishParallelStackStatus(engine, { state: 'off' });
			return null;
		}
		const signature = `${JSON.stringify(preferences)}:${String(parallelStackConfigurationRevision())}`;
		if (failedConfiguration === signature) return null;
		let refusal = '';
		if (!ports.supported()) refusal = 'Shared-memory audio workers are unavailable in this session.';
		else if (request.playbackMode !== 'normal' || request.playbackRate !== 1) refusal = 'Parallel effect stacks currently support normal-speed playback.';
		if (refusal) {
			publishParallelStackStatus(engine, { state: 'unsupported', reason: refusal });
			return null;
		}
		try {
			const graph = await ports.prepare({
				...request,
				onFailure: (error) => {
					failedConfiguration = signature;
					publishParallelStackStatus(engine, { state: 'failed', reason: error.message });
					request.onFailure(error);
				},
			}, preferences, signal);
			if (signal.aborted) { graph.abortController.abort(); return null; }
			publishParallelStackStatus(engine, { state: 'active', sampleRate: request.context.sampleRate, workerCount: parallelStackWorkerCount(graph) });
			graph.abortController.signal.addEventListener('abort', () => {
				if (failedConfiguration !== signature) publishParallelStackStatus(engine, { state: 'ready', sampleRate: request.context.sampleRate });
			}, { once: true });
			return graph;
		} catch (error) {
			if (signal.aborted) throw error;
			publishParallelStackStatus(engine, { state: 'unsupported', reason: error instanceof Error ? error.message : 'Parallel stack preparation failed.' });
			return null;
		}
	}, () => {
		const enabled = ports.preferences().enabled;
		if (!enabled) failedConfiguration = null;
		return enabled;
	});
}

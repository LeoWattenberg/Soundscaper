/* SPDX-License-Identifier: AGPL-3.0-only */

import { getParametricEqWasmModule } from './effect-worklets.ts';
import { buildProjectGraph, type ProjectGraph } from './project-graph.ts';
import { prepareParallelStackPlayback, parallelStackPlaybackEnabled } from './parallel-stack-playback.ts';
import { disposeGraph } from './dispose-project-graph.ts';
import { ENGINE_EMIT_PARAMETRIC_EQ_ERROR, ENGINE_HANDLE_SCHEDULING_ERROR } from './runtime-symbols.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';

/** Prepare one generation without letting an asynchronous worker startup resurrect stopped playback. */
export function buildPlaybackGraph(
	engine: EngineRuntimeHost,
	destination: AudioNode,
	fromFrame: number,
): ProjectGraph | null | Promise<ProjectGraph | null> {
	const { context, project, scrubGeneration } = engine;
	if (!context || !project) return null;
	const conventional = () => buildProjectGraph(context, destination, project, {
		metering: engine.meterListeners.size > 0,
		respectMuteSolo: true, effectAnalysis: true, monitoring: true,
		graph: engine.projectGraphSelection ?? undefined,
		parametricEqWasmModule: getParametricEqWasmModule(context),
		onParametricEqError: (error: unknown) => engine[ENGINE_EMIT_PARAMETRIC_EQ_ERROR](error),
	});
	// Seek and the conventional scheduler have synchronous graph construction semantics.
	if (!parallelStackPlaybackEnabled(engine)) return conventional();
	return (async () => {
		let prepared: ProjectGraph | null = null;
		const current = () => !engine.disposed && engine.context === context
			&& engine.project === project && engine.scrubGeneration === scrubGeneration;
		try { prepared = await prepareParallelStackPlayback(engine, {
			context, destination, project, fromFrame,
			metering: engine.meterListeners.size > 0,
			playbackMode: engine.playbackMode,
			playbackRate: engine.playbackRate,
			onFailure: (error) => {
				if (current() && prepared && engine.graph === prepared) engine[ENGINE_HANDLE_SCHEDULING_ERROR](error);
			},
		}); } catch (error) {
			if (error instanceof Error && error.name === 'AbortError') return null;
			throw error;
		}
		if (!current()) {
			if (prepared) disposeGraph(prepared, true);
			return null;
		}
		return prepared ?? conventional();
	})();
}

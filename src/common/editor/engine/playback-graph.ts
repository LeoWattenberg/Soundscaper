/* SPDX-License-Identifier: AGPL-3.0-only */

import { getParametricEqWasmModule } from './effect-worklets.ts';
import { buildProjectGraph, type ProjectGraph } from './project-graph.ts';
import { prepareParallelStackPlayback, parallelStackPlaybackEnabled } from './parallel-stack-playback.ts';
import { publishParallelStackStatus } from './parallel-stack-preferences.ts';
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
	if (engine.projectGraphSelection !== 'v21') {
		publishParallelStackStatus(engine, {
			state: 'unsupported', reason: 'Parallel stacks require the production V21 mixer graph selected for playback.',
		});
		return conventional();
	}
	return (async () => {
		let prepared: ProjectGraph | null = null;
		let failure: Error | null = null;
		const sameSession = () => !engine.disposed && engine.context === context
			&& engine.scrubGeneration === scrubGeneration;
		const current = () => sameSession() && engine.project === project;
		const currentFailure = () => sameSession() && (
			// An accepted live parameter preview replaces the project object while
			// the same graph keeps playing. Its worker faults still belong to it.
			(prepared !== null && engine.graph === prepared && !prepared.abortController.signal.aborted)
			|| (engine.graph === null && engine.project === project)
		);
		try { prepared = await prepareParallelStackPlayback(engine, {
			context, destination, project, fromFrame,
			metering: engine.meterListeners.size > 0,
			playbackMode: engine.playbackMode,
			playbackRate: engine.playbackRate,
			onFailure: (error) => {
				if (!currentFailure() || failure) return;
				failure = error;
				// A fault can arrive between worker readiness and transport assigning
				// the graph. Retire it now so the pending scheduler cannot play it.
				if (prepared) {
					prepared.abortController.abort(error);
					if (engine.graph !== prepared) disposeGraph(prepared, true);
				}
				engine[ENGINE_HANDLE_SCHEDULING_ERROR](error);
			},
		}); } catch (error) {
			if (failure) throw failure;
			if (error instanceof Error && error.name === 'AbortError') return null;
			throw error;
		}
		if (!current()) {
			if (prepared) disposeGraph(prepared, true);
			return null;
		}
		if (failure) {
			if (prepared) disposeGraph(prepared, true);
			throw failure;
		}
		return prepared ?? conventional();
	})();
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ENGINE_HANDLE_SCHEDULING_ERROR,
	ENGINE_HALT_GRAPH,
	ENGINE_SET_STATE,
} from './runtime-symbols.ts';
import type { EngineRuntimeHost, EngineRuntimeMethodMap } from './runtime-types.ts';

/** A retired graph must never report or stop a newer playback request. */
export function observeActiveStreamCompletion(
	engine: EngineRuntimeHost,
	graph: NonNullable<EngineRuntimeHost['graph']>,
	waitForStreamedClips: () => Promise<void>,
): void {
	void waitForStreamedClips().catch((error: unknown) => {
		if (engine.graph !== graph || graph.abortController.signal.aborted) return;
		engine[ENGINE_HANDLE_SCHEDULING_ERROR](unexpectedActiveStreamAbort(error));
	});
}

/** A stream abort in an active graph is a failed source, not transport cancellation. */
export function unexpectedActiveStreamAbort(error: unknown): unknown {
	return error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
		? new Error('A streamed audio source stopped unexpectedly.', { cause: error })
		: error;
}

export const enginePlaybackFailureMethods = {
	subscribePlaybackErrors(listener) {
		if (typeof listener !== 'function') return () => {};
		this.playbackErrorListeners.add(listener);
		return () => this.playbackErrorListeners.delete(listener);
	},

	[ENGINE_HANDLE_SCHEDULING_ERROR](error) {
		if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return;
		this[ENGINE_HALT_GRAPH]();
		this.masterLoudnessMeter?.setRunning(false);
		// Let automation discard its active capture before the final stopped state,
		// which otherwise looks like a user-requested stop and commits a partial lane.
		this[ENGINE_SET_STATE]('failed');
		this[ENGINE_SET_STATE](this.project ? 'stopped' : 'empty');
		for (const listener of this.playbackErrorListeners) {
			try { listener(error); }
			catch (listenerError) { globalThis.console?.error?.(listenerError); }
		}
		globalThis.console?.error?.(error);
	},
} satisfies EngineRuntimeMethodMap<'subscribePlaybackErrors' | typeof ENGINE_HANDLE_SCHEDULING_ERROR>;

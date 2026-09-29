/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioNodeArray } from './audio-node-utils.ts';
import { disposeEffectNodeBindings } from './effect-rack.ts';

interface DisposableAudioGraph {
	readonly abortController?: AbortController;
	readonly sources?: Iterable<{ stop(): void }> & { clear(): void };
	readonly nodes?: AudioNodeArray;
	readonly effectNodes?: { clear(): void };
	readonly effectAnalysers?: { clear(): void };
	readonly effectMessageSequences?: { clear(): void };
	readonly parameterRegistry?: { clear(): void };
}

export function disposeGraph(graph: DisposableAudioGraph, stopSources: boolean): void {
	graph.abortController?.abort?.();
	if (stopSources) {
		for (const source of graph.sources || []) {
			try { source.stop(); } catch { /* It may already have ended. */ }
		}
	}
	const transientNodes = graph.nodes?.transientNodes;
	for (const node of [
		...(graph.nodes || []),
		...(transientNodes || []),
	].reverse()) {
		disposeEffectNodeBindings(node);
		try { node.disconnect(); } catch { /* It may already be disconnected. */ }
	}
	transientNodes?.clear();
	graph.sources?.clear?.();
	graph.effectNodes?.clear?.();
	graph.effectAnalysers?.clear?.();
	graph.effectMessageSequences?.clear?.();
	graph.parameterRegistry?.clear?.();
}

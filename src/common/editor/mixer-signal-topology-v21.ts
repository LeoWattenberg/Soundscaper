/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	mixerEdgeCarriesSignalV21,
	mixerEndpointKeyV21,
} from './mixer-signal-edge-v21.ts';
import type {
	MixerEndpointV21,
	MixerGraphV21,
} from './mixer-graph-v21.ts';

export {
	mixerChannelMapCarriesSignalV21,
	mixerEdgeCarriesSignalV21,
	mixerEndpointKeyV21 as mixerSignalEndpointKeyV21,
} from './mixer-signal-edge-v21.ts';

export type MixerSignalEndpointV21 = MixerEndpointV21;

export interface MixerSignalTopologyOptionsV21 {
	/** Programme reachability includes outputs; solo relationships stop before them. */
	readonly includeOutputs: boolean;
}

export interface MixerSignalTopologyV21 {
	readonly reaches: (from: string, to: string) => boolean;
	readonly successors: (endpoint: string) => readonly string[];
}

const EMPTY_ENDPOINTS = Object.freeze([]) as readonly string[];

/** Build the directed graph of edges that can carry programme samples. */
export function createMixerSignalTopologyV21(
	graph: Pick<MixerGraphV21, 'edges'>,
	options: MixerSignalTopologyOptionsV21,
): MixerSignalTopologyV21 {
	const adjacency = new Map<string, Set<string>>();
	for (const edge of graph.edges) {
		if (!mixerEdgeCarriesSignalV21(edge)) continue;
		if (edge.destination.kind === 'effect-sidechain') continue;
		if (!options.includeOutputs && (
			edge.destination.kind === 'output'
			|| (edge.source as MixerEndpointV21).kind === 'output'
		)) continue;
		const source = mixerEndpointKeyV21(edge.source);
		const destination = mixerEndpointKeyV21(edge.destination);
		const targets = adjacency.get(source) ?? new Set<string>();
		targets.add(destination);
		adjacency.set(source, targets);
	}
	const successors = new Map([...adjacency].map(([endpoint, targets]) => (
		[endpoint, Object.freeze([...targets])] as const
	)));
	return Object.freeze({
		reaches: (from: string, to: string): boolean => reaches(successors, from, to),
		successors: (endpoint: string): readonly string[] => successors.get(endpoint) ?? EMPTY_ENDPOINTS,
	});
}

function reaches(
	adjacency: ReadonlyMap<string, readonly string[]>,
	from: string,
	to: string,
): boolean {
	const pending = [from];
	const seen = new Set<string>();
	while (pending.length) {
		const current = pending.pop()!;
		if (current === to) return true;
		if (seen.has(current)) continue;
		seen.add(current);
		pending.push(...(adjacency.get(current) ?? EMPTY_ENDPOINTS));
	}
	return false;
}

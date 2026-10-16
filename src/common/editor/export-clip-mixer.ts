/* SPDX-License-Identifier: AGPL-3.0-only */

import { mixerEndpointKeyV21, type MixerGraphV21 } from './mixer-graph-v21.ts';
import { mixerDetectorInputClosure } from './mixer-detector-input-closure.ts';

/** Retain programme routing and its detector feeds without admitting detector outputs. */
export function exportClipMixer(graph: MixerGraphV21, trackId: string): Readonly<{
	graph: MixerGraphV21;
	detectorStrips: ReadonlySet<string>;
	retainedEdges: ReadonlySet<string>;
}> {
	const programme = new Set([mixerEndpointKeyV21({ kind: 'track', id: trackId })]);
	const retainedEdges = new Set<string>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of graph.edges) {
			if (edge.destination.kind === 'effect-sidechain' || !programme.has(mixerEndpointKeyV21(edge.source))) continue;
			retainedEdges.add(edge.id);
			if (edge.destination.kind === 'output') continue;
			const destination = mixerEndpointKeyV21(edge.destination);
			if (!programme.has(destination)) { programme.add(destination); changed = true; }
		}
	}
	const detectorStrips = new Set<string>();
	for (const edge of graph.edges) {
		if (edge.destination.kind !== 'effect-sidechain'
			|| !programme.has(mixerEndpointKeyV21(edge.destination.strip))) continue;
		retainedEdges.add(edge.id);
		const incoming = mixerDetectorInputClosure(graph, edge.source);
		for (const id of incoming.edgeIds) retainedEdges.add(id);
		for (const strip of incoming.strips) detectorStrips.add(strip);
	}
	// Admission requires an output path even for a detector-only strip. Its zero
	// output anchor retains that path; the caller retires its edge gain lane too.
	return { detectorStrips, retainedEdges, graph: { ...graph, edges: graph.edges.map(edge => retainedEdges.has(edge.id)
		? edge : { ...edge, level: 0 }) } };
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AdmTerminalStripKind } from '../adm-project-metadata.ts';
import type { MixerEdgeV21, MixerGraphV21 } from '../mixer-graph-v21.ts';
import { clamp, positiveInteger } from './buffer-math.ts';

interface ProjectEdgeGeometryV21 {
	destinationWidth(edge: MixerEdgeV21): number;
	isGroup(id: string): boolean;
	admTerminal(source: MixerEdgeV21['source']): Readonly<{ kind: AdmTerminalStripKind; id: string }> | null;
}

/** One detached geometry snapshot belongs to one graph build; no authored identity is retained globally. */
export function prepareProjectEdgeGeometryV21(
	graph: MixerGraphV21,
	tracks: readonly Readonly<{ id: string }>[],
	trackWidths: ReadonlyMap<string, number>,
	masterChannels: unknown,
): ProjectEdgeGeometryV21 {
	const masterWidth = clamp(positiveInteger(masterChannels, 2), 1, 32);
	const fallbackTrackWidth = trackWidths.get('') ?? 2;
	const widths = new Map<string, number>();
	for (const track of tracks) {
		const id = track.id;
		if (!widths.has(id)) widths.set(id, trackWidths.get(id) ?? 2);
	}
	const mixerWidths = new Map<string, number>();
	const groupIds = new Set<string>();
	for (const group of graph.groups) groupIds.add(group.id);
	for (const strips of [graph.groups, graph.sends, graph.cues]) {
		for (const strip of strips) if (!mixerWidths.has(strip.id)) mixerWidths.set(strip.id, strip.channelCount);
	}
	const outputs = new Map<string, Readonly<{ channelCount: number }>>();
	for (const output of graph.outputs) {
		if (!outputs.has(output.id)) outputs.set(output.id, Object.freeze({ channelCount: output.channelCount }));
	}
	const mixerWidth = (id: string): number => {
		const width = mixerWidths.get(id);
		if (width === undefined) throw new TypeError(`Unknown V21 mixer node: ${id}.`);
		return width;
	};
	return Object.freeze({
		destinationWidth(edge: MixerEdgeV21): number {
			const destination = edge.destination;
			if (destination.kind === 'master') return masterWidth;
			if (destination.kind === 'mixer-node') return mixerWidth(destination.id);
			if (destination.kind === 'output') return outputs.get(destination.id)!.channelCount;
			if (destination.strip.kind === 'master') return masterWidth;
			if (destination.strip.kind === 'mixer-node') return mixerWidth(destination.strip.id);
			return widths.get(destination.strip.id) ?? fallbackTrackWidth;
		},
		isGroup(id: string): boolean { return groupIds.has(id); },
		admTerminal(source: MixerEdgeV21['source']): Readonly<{ kind: AdmTerminalStripKind; id: string }> | null {
			if (source.kind === 'track') return Object.freeze({ kind: 'track', id: source.id });
			if (source.kind !== 'mixer-node') return null;
			return Object.freeze({ kind: groupIds.has(source.id) ? 'group' : 'send', id: source.id });
		},
	});
}

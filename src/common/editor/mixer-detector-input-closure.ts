/* SPDX-License-Identifier: AGPL-3.0-only */

import { mixerEndpointKeyV21, type MixerGraphV21 } from './mixer-graph-v21.ts';
import type { StripRef } from './parameter-address.ts';

export interface MixerDetectorInputClosure {
	readonly strips: ReadonlySet<string>;
	readonly edgeIds: ReadonlySet<string>;
}

/** The selected rack's incoming detector graph, including upstream bus/rack inputs. */
export function mixerDetectorInputClosure(graph: MixerGraphV21, selected: StripRef): MixerDetectorInputClosure {
	const strips = new Set([mixerEndpointKeyV21(selected)]);
	const edgeIds = new Set<string>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of graph.edges) {
			const destination = edge.destination;
			const key = destination.kind === 'effect-sidechain' ? mixerEndpointKeyV21(destination.strip)
				: destination.kind === 'output' ? null : mixerEndpointKeyV21(destination);
			// Track inputs are clip-owned; only sidechains can enter the selected rack.
			if (key === null || !strips.has(key) || edgeIds.has(edge.id)) continue;
			edgeIds.add(edge.id);
			const source = mixerEndpointKeyV21(edge.source);
			if (!strips.has(source)) { strips.add(source); changed = true; }
		}
	}
	return { strips, edgeIds };
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { defaultMixerChannelMapV21, mixerEndpointKeyV21, type MixerEdgeV21 } from '../../mixer-graph-v21.ts';
import { normalizeAutomationLaneV21 } from '../../automation-lane-v21.ts';
import type { StripRef } from '../../parameter-address.ts';
import type { IsolatedTrackRenderProjectV21, IsolatedTrackRenderRequestV21 } from './isolated-track-render-project-v21.ts';

/** Keep the selected rack's transitive detector inputs, with one pre-master capture. */
export function createAuthoredTrackSidechainRender(
	project: IsolatedTrackRenderProjectV21,
	request: IsolatedTrackRenderRequestV21,
	widths: ReadonlyMap<string, number>,
): IsolatedTrackRenderProjectV21 {
	const selectedKey = mixerEndpointKeyV21({ kind: 'track', id: request.trackId });
	const strips = new Set([selectedKey]);
	const edgeIds = new Set<string>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of project.mixer.edges) {
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
	const requested = request.clipIds?.length ? new Set(request.clipIds) : null;
	const tracks = project.tracks.filter(track => strips.has(mixerEndpointKeyV21({ kind: 'track', id: track.id })))
		.map(track => track.id === request.trackId ? { ...track, pan: 0,
			clipIds: requested ? track.clipIds.filter(id => requested.has(id)) : [...track.clipIds] } : track);
	const main = project.mixer.outputs.find(output => output.role === 'main');
	if (!main) throw new TypeError('The authored mixer has no main output.');
	const usedIds = new Set(project.mixer.edges.map(edge => edge.id));
	const captureEdges = tracks.map((track): MixerEdgeV21 => {
		let id = `authored-capture:${track.id}`;
		while (usedIds.has(id)) id += ':';
		usedIds.add(id);
		// Zero-level output anchors retain exact graph admission for control tracks;
		// their authored signal reaches only detector terminals, never this output.
		return { id, kind: 'assignment', source: { kind: 'track', id: track.id },
			destination: { kind: 'output', id: main.id }, position: 'post-fader', enabled: true,
			level: track.id === request.trackId ? 1 : 0,
			channelMap: defaultMixerChannelMapV21(widths.get(track.id) ?? project.masterChannels, main.channelCount) };
	});
	const retainStrip = (strip: StripRef) => strips.has(mixerEndpointKeyV21(strip));
	return { ...project, tracks,
		mixer: { ...project.mixer,
			groups: project.mixer.groups.filter(strip => retainStrip({ kind: 'mixer-node', id: strip.id })),
			sends: project.mixer.sends.filter(strip => retainStrip({ kind: 'mixer-node', id: strip.id })),
			cues: project.mixer.cues.filter(strip => retainStrip({ kind: 'mixer-node', id: strip.id })),
			outputs: [main],
			vcas: project.mixer.vcas.map(vca => ({ ...vca, members: vca.members.filter(member =>
				retainStrip(member) && mixerEndpointKeyV21(member) !== selectedKey) })).filter(vca => vca.members.length > 0),
			edges: [...project.mixer.edges.filter(edge => edgeIds.has(edge.id)), ...captureEdges],
		},
		automationLanes: project.automationLanes.filter(value => {
			const { address } = normalizeAutomationLaneV21(value);
			if (address.kind === 'edge') return edgeIds.has(address.edgeId);
			if (!retainStrip(address.strip)) return false;
			return !(address.kind === 'strip' && address.parameterId === 'pan'
				&& mixerEndpointKeyV21(address.strip) === selectedKey);
		}),
	};
}

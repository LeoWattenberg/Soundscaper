/* SPDX-License-Identifier: AGPL-3.0-only */

import { defaultMixerChannelMapV21, mixerEndpointKeyV21, type MixerEdgeV21 } from '../../mixer-graph-v21.ts';
import { normalizeAutomationLaneV21 } from '../../automation-lane-v21.ts';
import { mixerDetectorInputClosure } from '../../mixer-detector-input-closure.ts';
import type { StripRef } from '../../parameter-address.ts';
import type { IsolatedTrackRenderProjectV21, IsolatedTrackRenderRequestV21 } from './isolated-track-render-project-v21.ts';

/** Keep the selected rack's transitive detector inputs, with one pre-master capture. */
export function createAuthoredTrackSidechainRender(
	project: IsolatedTrackRenderProjectV21,
	request: IsolatedTrackRenderRequestV21,
	widths: ReadonlyMap<string, number>,
): IsolatedTrackRenderProjectV21 {
	const selectedKey = mixerEndpointKeyV21({ kind: 'track', id: request.trackId });
	const { strips, edgeIds } = mixerDetectorInputClosure(project.mixer, { kind: 'track', id: request.trackId });
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
			destination: { kind: 'output', id: main.id },
			position: track.id === request.trackId ? 'pre-fader' : 'post-fader', enabled: true,
			level: track.id === request.trackId ? Number(track.gain ?? 1) : 0,
			channelMap: defaultMixerChannelMapV21(widths.get(track.id) ?? project.masterChannels, main.channelCount) };
	});
	const programmeCapture = captureEdges.find(edge => edge.source.kind === 'track' && edge.source.id === request.trackId)!;
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
		automationLanes: project.automationLanes.flatMap(value => {
			const lane = normalizeAutomationLaneV21(value);
			const { address } = lane;
			if (address.kind === 'edge') return edgeIds.has(address.edgeId) ? [lane] : [];
			if (!retainStrip(address.strip)) return [];
			if (address.kind === 'strip' && mixerEndpointKeyV21(address.strip) === selectedKey) {
				if (address.parameterId === 'pan') return [];
				// The pre-pan tap precedes the programme fader too; carry that one
				// authored gain onto its capture edge, without scaling or baking it twice.
				if (address.parameterId === 'gain') return [normalizeAutomationLaneV21({ ...lane,
					address: { kind: 'edge', edgeId: programmeCapture.id, parameterId: 'level' } })];
			}
			return [lane];
		}),
	};
}

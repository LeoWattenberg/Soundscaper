/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerGraphV21, MixerEdgeV21 } from '../../../mixer-graph-v21.ts';
import { hasProductionMixerProjectAuthority } from '../../../project-schema-version.ts';
import type { EffectAudioEffect, EffectAudioProject } from './effect-audio-service-types.ts';

/** Capture the bus rack input without its fader, downstream racks, or other output paths. */
export function createBusNoiseProfileRenderProject(
	project: EffectAudioProject, effect: EffectAudioEffect, scope: 'group' | 'send', busId: string,
): EffectAudioProject {
	if (!hasProductionMixerProjectAuthority(project)) throw new TypeError('Bus profiling requires the production mixer graph.');
	const mixer = project.mixer as unknown as MixerGraphV21;
	const field = scope === 'group' ? 'groups' : 'sends';
	const bus = mixer[field].find(candidate => candidate.id === busId);
	const effectIndex = bus?.effects.findIndex(candidate => candidate.id === effect.id) ?? -1;
	if (!bus || effectIndex < 0) throw new ReferenceError('The bus noise-profile effect does not exist.');
	const prefix = bus.effects.slice(0, effectIndex);
	const prefixIds = new Set(prefix.map(candidate => candidate.id));
	const masterChannels = Math.max(project.masterChannels, bus.channelCount);
	const masterMap = Array.from({ length: masterChannels }, (_, index) => index);
	const mainOutputIds = new Set(mixer.outputs.filter(output => output.role === 'main').map(output => output.id));
	const suppressedIds = new Set<string>();
	const edges = mixer.edges.filter(edge => !(edge.destination.kind === 'effect-sidechain'
		&& (edge.destination.strip.kind === 'master'
			|| (edge.destination.strip.kind === 'mixer-node' && edge.destination.strip.id === busId
				&& !prefixIds.has(edge.destination.effectId))))).map(edge => {
		if (edge.source.kind === 'master' && edge.destination.kind === 'output'
			&& mainOutputIds.has(edge.destination.id)) {
			suppressedIds.add(edge.id);
			return { ...edge, level: 1, enabled: true, channelMap: masterMap };
		}
		if ((edge.source.kind === 'mixer-node' && edge.source.id === busId)
			|| edge.destination.kind === 'master'
			|| (edge.destination.kind === 'output' && edge.source.kind !== 'master')) {
			suppressedIds.add(edge.id);
			return { ...edge, level: 0 };
		}
		return edge;
	});
	let id = `noise-profile:${busId}:master`;
	while (mixer.edges.some(edge => edge.id === id)) id += ':';
	const capture: MixerEdgeV21 = { id, kind: 'assignment', source: { kind: 'mixer-node', id: busId },
		destination: { kind: 'master' }, position: 'post-fader', level: 1, enabled: true,
		channelMap: masterMap.map(index => index < bus.channelCount ? index : -1) };
	const captureMixer: MixerGraphV21 = { ...mixer, [field]: mixer[field].map(candidate => candidate.id === busId
		? { ...candidate, effects: prefix, gain: 1, pan: 0, mute: false, solo: false } : candidate),
		vcas: mixer.vcas.map(vca => ({ ...vca, members: vca.members.filter(member =>
			member.kind !== 'mixer-node' || member.id !== busId) })),
		outputs: mixer.outputs.map(output => output.role === 'main' ? { ...output, channelCount: masterChannels } : output),
		edges: [...edges, capture] };
	const retainedEdgeIds = new Set(captureMixer.edges.map(edge => edge.id));
	return { ...project, masterChannels,
		master: { ...project.master, gain: 1, mute: false, effects: [] },
		automationLanes: Array.isArray(project.automationLanes) ? project.automationLanes.filter(lane => {
			const address = (lane as { address?: { kind?: string; edgeId?: string; effectId?: string;
				strip?: { kind?: string; id?: string } } }).address;
			if (address?.kind === 'edge' && (suppressedIds.has(address.edgeId ?? '') || !retainedEdgeIds.has(address.edgeId ?? ''))) return false;
			if (address?.strip?.kind === 'master') return false;
			if (address?.strip?.kind !== 'mixer-node' || address.strip.id !== busId) return true;
			return address.kind === 'effect' && prefixIds.has(address.effectId);
		}) : [],
		mixer: captureMixer,
	};
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerGraphV21, MixerEndpointV21 } from './mixer-graph-v21.ts';
import { mixerEndpointKeyV21 } from './mixer-signal-edge-v21.ts';
import { createProjectSoloGainResolverV21, createProjectVcaGainResolverV21 } from './engine/project-strip-control-index-v21.ts';

export interface EffectTailGateOwner {
	readonly id?: unknown;
	readonly type?: unknown;
	readonly gain?: unknown;
	readonly mute?: unknown;
	readonly solo?: unknown;
}
export interface EffectTailGateProject {
	readonly tracks?: readonly EffectTailGateOwner[];
	readonly master?: EffectTailGateOwner;
	readonly automationLanes?: readonly unknown[];
}

/** Static gates exclude silent post-fader paths; pre-fader taps and automation
 * retain release time because their programme can still charge the insert.
 */
export function audibleEffectTailGraphV21(project: EffectTailGateProject, graph: MixerGraphV21,
	{ includeMaster, respectMuteSolo }: Readonly<{ includeMaster: boolean; respectMuteSolo: boolean }>): MixerGraphV21 {
	const tracks = (project.tracks ?? []).flatMap(track => track.type === 'audio' && typeof track.id === 'string'
		? [{ ...track, id: track.id, solo: track.solo === true }] : []);
	const owners = new Map<string, EffectTailGateOwner>([['master', project.master ?? {}]]);
	for (const track of tracks) owners.set(`track:${track.id}`, track);
	for (const strip of [...graph.groups, ...graph.sends, ...graph.cues]) owners.set(`mixer-node:${strip.id}`, strip);
	const soloOpen = createProjectSoloGainResolverV21(graph, tracks, respectMuteSolo);
	const vcaGain = createProjectVcaGainResolverV21(graph.vcas);
	const automated = new Map<string, Set<string>>();
	for (const value of project.automationLanes ?? []) {
		const lane = record(value), address = record(lane.address);
		if (!Array.isArray(lane.points) || lane.points.length === 0) continue;
		const strip = record(address.strip);
		const key = address.kind === 'edge' ? `edge:${String(address.edgeId)}`
			: address.kind === 'strip' ? strip.kind === 'master' ? 'master' : `${String(strip.kind)}:${String(strip.id)}` : null;
		if (key === null) continue;
		const parameters = automated.get(key) ?? new Set<string>();
		parameters.add(String(address.parameterId)); automated.set(key, parameters);
	}
	const postFaderOpen = (source: MixerEndpointV21): boolean => {
		if (source.kind === 'output' || (source.kind === 'master' && !includeMaster)) return true;
		const key = mixerEndpointKeyV21(source), owner = owners.get(key);
		if (!owner) return true;
		if (owner.gain === 0 && !automated.get(key)?.has('gain')) return false;
		if (vcaGain(source, includeMaster) === 0) return false;
		return !respectMuteSolo || (soloOpen(key) && (owner.mute !== true || automated.get(key)?.has('mute') === true));
	};
	return { ...graph, edges: graph.edges.filter(edge =>
		(edge.level !== 0 || automated.get(`edge:${edge.id}`)?.has('level') === true)
		&& (edge.position === 'pre-fader' || postFaderOpen(edge.source))) };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

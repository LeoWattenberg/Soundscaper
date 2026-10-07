/* SPDX-License-Identifier: AGPL-3.0-only */

import { mixerEndpointKeyV21, type MixerGraphV21, type MixerVcaV21 } from '../mixer-graph-v21.ts';
import { createMixerSignalTopologyV21 } from '../mixer-signal-topology-v21.ts';
import type { StripRef } from '../parameter-address.ts';

export function createProjectVcaGainResolverV21(vcas: readonly MixerVcaV21[]): (ref: StripRef, includeMaster: boolean) => number {
	if (!vcas.length) return () => 1;
	const gains = new Map<string, number>();
	for (const vca of vcas) {
		const members = new Set<string>();
		for (const member of vca.members) members.add(mixerEndpointKeyV21(member));
		const factor = vca.mute ? 0 : vca.gain;
		for (const key of members) gains.set(key, (gains.get(key) ?? 1) * factor);
	}
	return (ref, includeMaster): number => {
		if (!includeMaster && ref.kind === 'master') return 1;
		return gains.get(mixerEndpointKeyV21(ref)) ?? 1;
	};
}

/** Cache only the finite set of runtime strip keys; arbitrary queries cannot expand retention. */
export function createProjectSoloGainResolverV21(
	graph: MixerGraphV21,
	tracks: readonly Readonly<{ id: string; solo?: boolean }>[],
	respectMuteSolo: boolean,
): (key: string) => boolean {
	if (!respectMuteSolo) return () => true;
	const solos = new Set<string>();
	for (const track of tracks) if (track.solo) solos.add(`track:${track.id}`);
	for (const strips of [graph.groups, graph.sends, graph.cues]) {
		for (const strip of strips) if (strip.solo) solos.add(`mixer-node:${strip.id}`);
	}
	if (!solos.size) return () => true;
	const keys = new Set<string>(['master']);
	for (const track of tracks) keys.add(`track:${track.id}`);
	for (const strips of [graph.groups, graph.sends, graph.cues]) {
		for (const strip of strips) keys.add(`mixer-node:${strip.id}`);
	}
	const soloKeys = [...solos];
	const topology = createMixerSignalTopologyV21(graph, { includeOutputs: false });
	const audible = new Map<string, boolean>();
	return (key): boolean => {
		const current = audible.get(key);
		if (current !== undefined) return current;
		const value = soloKeys.some(solo => topology.reaches(key, solo) || topology.reaches(solo, key));
		if (keys.has(key)) audible.set(key, value);
		return value;
	};
}

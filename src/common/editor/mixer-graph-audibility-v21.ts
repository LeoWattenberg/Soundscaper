/* SPDX-License-Identifier: AGPL-3.0-only */

import { isMixerGraphV21Surface } from './mixer-graph-surface-v21.ts';

type DataRecord = Readonly<Record<string, unknown>>;

interface StripState {
	readonly muted: boolean;
	readonly soloed: boolean;
}

/**
 * Which audio tracks the V21 routing graph lets through.
 *
 * A track's own mute and solo are not the whole answer once a graph exists. Solo
 * is resolved over the routing: while anything is soloed, a strip is audible
 * only if it is soloed or connected to something that is. A group or send strip
 * carries its own mute, so a track that reaches the mix only through a muted bus
 * is silent. A VCA that is muted zeroes every strip in it. All of that decides
 * what plays, so it decides what an export describes too.
 *
 * The master's own mute is deliberately not part of this: it is the monitoring
 * decision at the end of the chain, and an edit list is a statement about the
 * programme's tracks rather than about whether the room is listening.
 */
export interface MixerGraphAudibilityV21 {
	readonly audibleTrack: (trackId: string) => boolean;
	/** Why a track is not in the programme, for a delivery report. */
	readonly reason: (trackId: string) => 'muted' | 'not-soloed' | 'routed-to-silence';
}

export function createMixerGraphAudibilityV21(project: unknown): MixerGraphAudibilityV21 | null {
	const document = (project && typeof project === 'object' ? project : {}) as DataRecord;
	const mixer = document.mixer;
	if (!isMixerGraphV21Surface(mixer)) return null;
	const graph = mixer as unknown as DataRecord;
	const tracks = records(document.tracks).filter((track) => track.type === 'audio');
	const strips = new Map<string, StripState>();
	for (const track of tracks) {
		strips.set(`track:${String(track.id)}`, {
			muted: track.mute === true,
			soloed: track.solo === true,
		});
	}
	for (const strip of [...records(graph.groups), ...records(graph.sends), ...records(graph.cues)]) {
		strips.set(`mixer-node:${String(strip.id)}`, {
			muted: strip.mute === true,
			soloed: strip.solo === true,
		});
	}
	const mutedByVca = new Set<string>();
	for (const vca of records(graph.vcas)) {
		if (vca.mute !== true) continue;
		for (const member of records(vca.members)) mutedByVca.add(endpointKey(member));
	}
	const adjacency = new Map<string, Set<string>>();
	for (const edge of records(graph.edges)) {
		if (edge.enabled === false) continue;
		const destination = edge.destination as DataRecord | undefined;
		if (destination?.kind === 'effect-sidechain') continue;
		const source = endpointKey(edge.source);
		const target = endpointKey(destination);
		if (!source || !target) continue;
		if (!adjacency.has(source)) adjacency.set(source, new Set());
		adjacency.get(source)!.add(target);
	}
	const soloed = [...strips].filter(([, state]) => state.soloed).map(([key]) => key);
	const open = (key: string): boolean => {
		const state = strips.get(key);
		if (state === undefined) return true;
		if (state.muted || mutedByVca.has(key)) return false;
		if (soloed.length === 0) return true;
		return soloed.some((solo) => reaches(adjacency, key, solo) || reaches(adjacency, solo, key));
	};
	const reachesProgramme = (key: string): boolean => {
		const pending = [key];
		const seen = new Set<string>();
		while (pending.length) {
			const current = pending.pop()!;
			if (seen.has(current)) continue;
			seen.add(current);
			// Master and the outputs are the end of the chain: reaching either is
			// reaching the programme.
			if (current.startsWith('master') || current.startsWith('output:')) return true;
			for (const next of adjacency.get(current) ?? []) {
				if (next.startsWith('mixer-node:') && !open(next)) continue;
				pending.push(next);
			}
		}
		return false;
	};

	return Object.freeze({
		audibleTrack: (trackId: string): boolean => {
			const key = `track:${trackId}`;
			if (!strips.has(key)) return true;
			return open(key) && reachesProgramme(key);
		},
		reason: (trackId: string): 'muted' | 'not-soloed' | 'routed-to-silence' => {
			const key = `track:${trackId}`;
			const state = strips.get(key);
			if (state?.muted === true || mutedByVca.has(key)) return 'muted';
			if (!open(key)) return 'not-soloed';
			return 'routed-to-silence';
		},
	});
}

function reaches(
	adjacency: ReadonlyMap<string, Set<string>>,
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
		pending.push(...(adjacency.get(current) ?? []));
	}
	return false;
}

function endpointKey(value: unknown): string {
	const endpoint = (value && typeof value === 'object' ? value : {}) as DataRecord;
	const kind = String(endpoint.kind ?? '');
	if (kind === 'master') return 'master';
	if (!endpoint.id) return kind;
	return `${kind}:${String(endpoint.id)}`;
}

function records(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value as readonly DataRecord[] : [];
}

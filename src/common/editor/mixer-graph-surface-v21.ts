/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeMixerGraphV21,
	type MixerEdgeV21,
	type MixerGraphV21,
} from './mixer-graph-v21.ts';

export interface MixerTrackSurfaceRouteV21 {
	readonly groupId: string | null;
	readonly sends: Readonly<Record<string, number>>;
	readonly groupEditable: boolean;
	readonly editableSendIds: readonly string[];
}

/** Read the exact subset of V21 routing representable by the compact mixer. */
export function mixerTrackSurfaceRouteV21(
	graphValue: MixerGraphV21 | unknown,
	trackId: string,
): MixerTrackSurfaceRouteV21 {
	const graph = normalizeMixerGraphV21(graphValue);
	const groupIds = new Set(graph.groups.map(({ id }) => id));
	const assignments = graph.edges.filter((edge) => (
		edge.kind === 'assignment' && edge.source.kind === 'track' && edge.source.id === trackId
	));
	const assignment = assignments.length === 1 && isCanonicalAssignment(assignments[0]!)
		? assignments[0]! : null;
	const groupId = assignment?.destination.kind === 'mixer-node'
		&& groupIds.has(assignment.destination.id)
		? assignment.destination.id : null;
	const sends: Record<string, number> = {};
	const editableSendIds: string[] = [];
	for (const send of graph.sends) {
		const matching = graph.edges.filter((edge) => (
			edge.kind === 'send'
			&& edge.source.kind === 'track' && edge.source.id === trackId
			&& edge.destination.kind === 'mixer-node' && edge.destination.id === send.id
		));
		if (matching.length === 0) {
			editableSendIds.push(send.id);
			continue;
		}
		if (matching.length !== 1 || matching[0]!.id !== sendEdgeId(trackId, send.id)) continue;
		sends[send.id] = matching[0]!.level;
		editableSendIds.push(send.id);
	}
	return Object.freeze({
		groupId,
		sends: Object.freeze(sends),
		groupEditable: assignment !== null,
		editableSendIds: Object.freeze(editableSendIds),
	});
}

export function isMixerGraphV21Surface(value: unknown): value is MixerGraphV21 {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& (value as Readonly<Record<string, unknown>>).schemaVersion === 1
		&& Array.isArray((value as Readonly<Record<string, unknown>>).edges));
}

function isCanonicalAssignment(edge: MixerEdgeV21): boolean {
	if (edge.source.kind !== 'track'
		|| (edge.destination.kind !== 'master' && edge.destination.kind !== 'mixer-node')) return false;
	const suffix = edge.destination.kind === 'master' ? 'master' : `mixer-node:${edge.destination.id}`;
	return edge.id === `assignment:track:${edge.source.id}:${suffix}`;
}

function sendEdgeId(trackId: string, sendId: string): string {
	return `send:track:${trackId}:mixer-node:${sendId}`;
}

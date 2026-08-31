/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defaultMixerChannelMapV21,
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

export interface MixerTrackSurfaceWidthsV21 {
	readonly sourceChannels: number;
	readonly masterChannels: number;
}

/** Read the exact subset of V21 routing representable by the compact mixer. */
export function mixerTrackSurfaceRouteV21(
	graphValue: MixerGraphV21 | unknown,
	trackId: string,
	widths?: MixerTrackSurfaceWidthsV21,
): MixerTrackSurfaceRouteV21 {
	const graph = normalizeMixerGraphV21(graphValue);
	const assignments = graph.edges.filter((edge) => (
		edge.kind === 'assignment' && edge.source.kind === 'track' && edge.source.id === trackId
	));
	const assignment = assignments.length === 1
		&& isMixerTrackSurfaceAssignmentV21(graph, assignments[0]!, trackId, widths)
		? assignments[0]! : null;
	const groupId = assignment?.destination.kind === 'mixer-node'
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
		if (matching.length !== 1
			|| !isMixerTrackSurfaceSendV21(graph, matching[0]!, trackId, send.id, widths)) continue;
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

export function isMixerTrackSurfaceAssignmentV21(
	graph: MixerGraphV21,
	edge: MixerEdgeV21,
	trackId: string,
	widths?: MixerTrackSurfaceWidthsV21,
): boolean {
	if (edge.kind !== 'assignment'
		|| edge.source.kind !== 'track' || edge.source.id !== trackId
		|| (edge.destination.kind !== 'master' && edge.destination.kind !== 'mixer-node')
		|| edge.position !== 'post-fader' || edge.level !== 1 || !edge.enabled) return false;
	const destination = edge.destination;
	const destinationChannels = destination.kind === 'master'
		? widths?.masterChannels
		: graph.groups.find(({ id }) => id === destination.id)?.channelCount;
	if (destination.kind === 'mixer-node' && destinationChannels === undefined) return false;
	const suffix = destination.kind === 'master' ? 'master' : `mixer-node:${destination.id}`;
	return edge.id === `assignment:track:${trackId}:${suffix}`
		&& hasSurfaceChannelMap(edge, widths?.sourceChannels, destinationChannels);
}

export function isMixerTrackSurfaceSendV21(
	graph: MixerGraphV21,
	edge: MixerEdgeV21,
	trackId: string,
	sendId: string,
	widths?: MixerTrackSurfaceWidthsV21,
): boolean {
	const destinationChannels = graph.sends.find(({ id }) => id === sendId)?.channelCount;
	return destinationChannels !== undefined
		&& edge.kind === 'send'
		&& edge.source.kind === 'track' && edge.source.id === trackId
		&& edge.destination.kind === 'mixer-node' && edge.destination.id === sendId
		&& edge.id === sendEdgeId(trackId, sendId)
		&& edge.position === 'post-fader' && edge.enabled
		&& hasSurfaceChannelMap(edge, widths?.sourceChannels, destinationChannels);
}

function sendEdgeId(trackId: string, sendId: string): string {
	return `send:track:${trackId}:mixer-node:${sendId}`;
}

function hasSurfaceChannelMap(
	edge: MixerEdgeV21,
	sourceChannels: number | undefined,
	destinationChannels: number | undefined,
): boolean {
	if (sourceChannels === undefined || destinationChannels === undefined) return true;
	const expected = defaultMixerChannelMapV21(sourceChannels, destinationChannels);
	return edge.channelMap.length === expected.length
		&& edge.channelMap.every((channel, index) => channel === expected[index]);
}

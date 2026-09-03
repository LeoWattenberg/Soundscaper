/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import {
	defaultMixerChannelMapV21,
	normalizeMixerGraphV21,
	type MixerEdgeV21,
	type MixerGraphV21,
} from '../mixer-graph-v21.ts';
import { isSoundscaperProductionProject } from '../project-schema-version.ts';
import { resolveTerminalChannelWidths } from '../terminal-channel-widths.ts';
import type { MixRenderOperationCommit } from './mix-render-commit.ts';
import type { ControllerProject } from './track-domain-types.ts';

export type MixRenderCommandPreview = (
	project: ControllerProject,
	command: AudioEditorCommand,
) => ControllerProject;

/** Restate production sibling routes after all new clips have established their exact widths. */
export function preserveProductionMixRenderRouting(
	project: ControllerProject,
	prepared: Readonly<MixRenderOperationCommit>,
	previewCommand: MixRenderCommandPreview,
	createId: (prefix: string) => string,
): Readonly<MixRenderOperationCommit> {
	if ((!prepared.routingCopies.length && !prepared.directRoutingTrackIds.length)
		|| !isSoundscaperProductionProject(project)) return prepared;
	const staged = previewCommand(project, prepared.command);
	const originalGraph = normalizeMixerGraphV21(project.mixer as never);
	const stagedGraph = normalizeMixerGraphV21(staged.mixer as never);
	const desired = restateRoutes(
		project,
		staged,
		stagedGraph,
		originalGraph,
		prepared.routingCopies,
		prepared.directRoutingTrackIds,
		createId,
	);
	const graphCommand: AudioEditorCommand = {
		type: 'mixer-graph/set',
		expected: stagedGraph as unknown as Readonly<Record<string, unknown>>,
		mixer: desired as unknown as Readonly<Record<string, unknown>>,
	};
	return Object.freeze({
		...prepared,
		command: Object.freeze({
			type: 'batch',
			commands: Object.freeze([...prepared.command.commands, graphCommand]),
		}),
	});
}

function restateRoutes(
	originalProject: ControllerProject,
	project: ControllerProject,
	staged: MixerGraphV21,
	original: MixerGraphV21,
	copies: readonly Readonly<{ readonly sourceTrackId: string; readonly targetTrackId: string }>[],
	directTrackIds: readonly string[],
	createId: (prefix: string) => string,
): MixerGraphV21 {
	const targetIds = new Set([
		...copies.map(({ targetTrackId }) => targetTrackId),
		...directTrackIds,
	]);
	const widths = resolveTerminalChannelWidths(project as never, Number(project.masterChannels));
	const originalWidths = resolveTerminalChannelWidths(
		originalProject as never,
		Number(originalProject.masterChannels),
	);
	const edges = staged.edges.filter((edge) => !(
		edge.source.kind === 'track' && targetIds.has(edge.source.id)
	));
	const occupiedIds = new Set(edges.map(({ id }) => id));
	for (const copy of copies) {
		for (const route of original.edges) {
			if (route.source.kind !== 'track' || route.source.id !== copy.sourceTrackId
				|| sidechainTargetsOwnRack(route, copy.sourceTrackId)) continue;
			const sourceWidth = widths.tracks.get(copy.targetTrackId) ?? Number(project.masterChannels);
			const originalSourceWidth = originalWidths.tracks.get(copy.sourceTrackId)
				?? Number(originalProject.masterChannels);
			const destinationWidth = edgeDestinationWidth(staged, route, widths.tracks);
			const originalDestinationWidth = edgeDestinationWidth(
				original, route, originalWidths.tracks,
			);
			const remainsValid = route.channelMap.length === destinationWidth
				&& route.channelMap.every((channel) => channel === -1
					|| (channel >= 0 && channel < sourceWidth));
			const wasDefault = sameChannelMap(
				route.channelMap,
				defaultMixerChannelMapV21(originalSourceWidth, originalDestinationWidth),
			);
			const channelMap = remainsValid && !wasDefault
				? route.channelMap
				: defaultMixerChannelMapV21(sourceWidth, destinationWidth);
			let id = copiedRouteId(route, copy.sourceTrackId, copy.targetTrackId)
				?? createId('mix-route');
			while (occupiedIds.has(id)) id = createId('mix-route');
			occupiedIds.add(id);
			edges.push({
				...structuredClone(route), id,
				source: { kind: 'track', id: copy.targetTrackId },
				channelMap,
			});
		}
	}
	for (const trackId of directTrackIds) {
		const sourceWidth = widths.tracks.get(trackId) ?? Number(project.masterChannels);
		const destinationWidth = Number(project.masterChannels);
		edges.push({
			id: `assignment:track:${trackId}:master`,
			kind: 'assignment',
			source: { kind: 'track', id: trackId },
			destination: { kind: 'master' },
			position: 'post-fader', level: 1, enabled: true,
			channelMap: defaultMixerChannelMapV21(sourceWidth, destinationWidth),
		});
	}
	return normalizeMixerGraphV21({ ...staged, edges });
}

function sameChannelMap(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((channel, index) => channel === right[index]);
}

function copiedRouteId(
	edge: MixerEdgeV21,
	sourceTrackId: string,
	targetTrackId: string,
): string | null {
	if (edge.destination.kind === 'effect-sidechain') return null;
	const destination = edge.destination.kind === 'master'
		? 'master' : `${edge.destination.kind}:${edge.destination.id}`;
	return edge.id === `${edge.kind}:track:${sourceTrackId}:${destination}`
		? `${edge.kind}:track:${targetTrackId}:${destination}` : null;
}

function edgeDestinationWidth(
	graph: MixerGraphV21,
	edge: MixerEdgeV21,
	trackWidths: ReadonlyMap<string, number>,
): number {
	const destination = edge.destination;
	if (destination.kind === 'effect-sidechain') {
		const strip = destination.strip;
		if (strip.kind === 'master') {
			return graph.outputs.find(({ role }) => role === 'main')?.channelCount ?? 2;
		}
		if (strip.kind === 'track') return trackWidths.get(strip.id) ?? 2;
		return [...graph.groups, ...graph.sends, ...graph.cues]
			.find(({ id }) => id === strip.id)?.channelCount ?? 2;
	}
	if (destination.kind === 'master') {
		return graph.outputs.find(({ role }) => role === 'main')?.channelCount ?? 2;
	}
	if (destination.kind === 'output') {
		return graph.outputs.find(({ id }) => id === destination.id)?.channelCount ?? 2;
	}
	if (destination.kind === 'mixer-node') {
		return [...graph.groups, ...graph.sends, ...graph.cues]
			.find(({ id }) => id === destination.id)?.channelCount ?? 2;
	}
	return 2;
}

function sidechainTargetsOwnRack(edge: MixerEdgeV21, sourceTrackId: string): boolean {
	return edge.destination.kind === 'effect-sidechain'
		&& edge.destination.strip.kind === 'track'
		&& edge.destination.strip.id === sourceTrackId;
}

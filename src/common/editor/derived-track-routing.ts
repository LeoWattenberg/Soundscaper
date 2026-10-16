/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from './commands/protocol.ts';
import { derivedTrackSidechainRoutes } from './derived-track-sidechains.ts';
import { copyDerivedTrackRouteAutomation, type DerivedTrackRouteCopy } from './derived-track-route-automation.ts';
import {
	defaultMixerChannelMapV21,
	normalizeMixerGraphV21,
	mixerEndpointKeyV21,
	type MixerEdgeV21,
	type MixerGraphV21,
} from './mixer-graph-v21.ts';
import { isSoundscaperProductionProject } from './project-schema-version.ts';
import { resolveTerminalChannelWidths } from './terminal-channel-widths.ts';

type RoutingProject = Readonly<Record<string, unknown>>;

/** Preserve an authored track's outgoing topology when deriving replacement tracks. */
export function preserveProductionTrackRouting<Project extends RoutingProject>(
	project: Project,
	command: Extract<AudioEditorCommand, { readonly type: 'batch' }>,
	routingCopies: readonly Readonly<{ readonly sourceTrackId: string; readonly targetTrackId: string }>[],
	previewCommand: ((project: Project, command: AudioEditorCommand) => RoutingProject) | undefined,
	createId: (prefix: string) => string,
	directRoutingTrackIds: readonly string[] = [],
): Extract<AudioEditorCommand, { readonly type: 'batch' }> {
	if ((!routingCopies.length && !directRoutingTrackIds.length)
		|| !isSoundscaperProductionProject(project) || !previewCommand) return command;
	const staged = previewCommand(project, command);
	const originalGraph = normalizeMixerGraphV21(project.mixer as never);
	const stagedGraph = normalizeMixerGraphV21(staged.mixer as never);
	const { graph: desired, edgeCopies } = restateRoutes(
		project,
		staged,
		stagedGraph,
		originalGraph,
		routingCopies,
		directRoutingTrackIds,
		createId,
	);
	const graphCommand: AudioEditorCommand = {
		type: 'mixer-graph/set',
		expected: stagedGraph as unknown as Readonly<Record<string, unknown>>,
		mixer: desired as unknown as Readonly<Record<string, unknown>>,
	};
	const automation = copyDerivedTrackRouteAutomation(project, staged, edgeCopies, createId);
	return Object.freeze({ type: 'batch', commands: Object.freeze([...command.commands, graphCommand, ...automation]) });
}

function restateRoutes(
	originalProject: RoutingProject,
	project: RoutingProject,
	staged: MixerGraphV21,
	original: MixerGraphV21,
	copies: readonly Readonly<{ readonly sourceTrackId: string; readonly targetTrackId: string }>[],
	directTrackIds: readonly string[],
	createId: (prefix: string) => string,
): Readonly<{ graph: MixerGraphV21; edgeCopies: readonly DerivedTrackRouteCopy[] }> {
	const edgeCopies: DerivedTrackRouteCopy[] = [];
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
				|| route.destination.kind === 'effect-sidechain') continue;
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
			let id = copy.sourceTrackId === copy.targetTrackId ? route.id
				: copiedRouteId(route, copy.sourceTrackId, copy.targetTrackId) ?? createId('mix-route');
			while (occupiedIds.has(id)) id = createId('mix-route');
			occupiedIds.add(id);
			edgeCopies.push({ sourceEdgeId: route.id, targetEdgeId: id });
			edges.push({
				...structuredClone(route), id,
				source: { kind: 'track', id: copy.targetTrackId },
				channelMap,
			});
		}
	}
	for (const { original: route, route: copied } of derivedTrackSidechainRoutes(originalProject, project, original.edges, copies)) {
		if (edges.some(edge => edge.kind === 'sidechain' && sameSidechainTerminals(edge, copied))) continue;
		const sourceWidth = copied.source.kind === 'track'
			? widths.tracks.get(copied.source.id) ?? Number(project.masterChannels)
			: edgeDestinationWidth(staged, { ...copied, destination: copied.source }, widths.tracks);
		const destinationWidth = edgeDestinationWidth(staged, copied, widths.tracks);
		const originalSourceWidth = route.source.kind === 'track'
			? originalWidths.tracks.get(route.source.id) ?? Number(originalProject.masterChannels)
			: edgeDestinationWidth(original, { ...route, destination: route.source }, originalWidths.tracks);
		const wasDefault = sameChannelMap(route.channelMap, defaultMixerChannelMapV21(
			originalSourceWidth, edgeDestinationWidth(original, route, originalWidths.tracks),
		));
		const remainsValid = route.channelMap.length === destinationWidth
			&& route.channelMap.every(channel => channel === -1 || (channel >= 0 && channel < sourceWidth));
		let id = sameSidechainTerminals(route, copied) && !occupiedIds.has(route.id)
			? route.id : createId('mix-route');
		while (occupiedIds.has(id)) id = createId('mix-route');
		occupiedIds.add(id);
		edgeCopies.push({ sourceEdgeId: route.id, targetEdgeId: id });
		edges.push({ ...structuredClone(copied), id, channelMap: remainsValid && !wasDefault
			? route.channelMap : defaultMixerChannelMapV21(sourceWidth, destinationWidth) });
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
	// Combined audio already includes these tracks' VCA controls. A retained
	// identity must leave those memberships before its printed source plays.
	const bakedTrackIds = new Set(directTrackIds);
	const vcas = staged.vcas.map(vca => {
		const members = vca.members.filter(member => member.kind !== 'track' || !bakedTrackIds.has(member.id));
		const originalMembers = original.vcas.find(candidate => candidate.id === vca.id)?.members ?? [];
		for (const copy of copies) {
			const sourceWasMember = originalMembers.some(member => member.kind === 'track' && member.id === copy.sourceTrackId);
			if (sourceWasMember && !members.some(member => member.kind === 'track' && member.id === copy.targetTrackId)) {
				members.push({ kind: 'track', id: copy.targetTrackId });
			}
		}
		return { ...vca, members };
	});
	return { graph: normalizeMixerGraphV21({ ...staged, edges, vcas }), edgeCopies };
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

function sameSidechainTerminals(left: MixerEdgeV21, right: MixerEdgeV21): boolean {
	return left.destination.kind === 'effect-sidechain' && right.destination.kind === 'effect-sidechain'
		&& mixerEndpointKeyV21(left.source) === mixerEndpointKeyV21(right.source)
		&& left.destination.effectId === right.destination.effectId
		&& left.destination.strip.kind === right.destination.strip.kind
		&& (left.destination.strip.kind === 'master' || (right.destination.strip.kind !== 'master'
			&& left.destination.strip.id === right.destination.strip.id));
}

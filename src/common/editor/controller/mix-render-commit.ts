/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
	createMoveTrackNodeCommand,
} from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import { isSoundscaperProductionProject } from '../project-schema-version.ts';
import { v21StripLaneRemovalCommands } from './mix-render-model.ts';
import type { NormalizedMixRenderOptions } from './mix-render-options.ts';
import type {
	ControllerProject,
	ControllerSource,
	ControllerTrack,
} from './track-domain-types.ts';

export interface MixRenderRenderedOutput {
	readonly targetTracks: readonly ControllerTrack[];
	readonly source: ControllerSource;
	readonly startFrame: number;
	readonly name: string;
}

export interface MixRenderResult {
	readonly trackId: string;
	readonly clipId: string;
	readonly sourceId: string;
}

export interface MixRenderRoutingCopy {
	readonly sourceTrackId: string;
	readonly targetTrackId: string;
}

export interface MixRenderOperationCommit {
	readonly type: 'mix-render';
	readonly command: Extract<AudioEditorCommand, { readonly type: 'batch' }>;
	readonly results: readonly Readonly<MixRenderResult>[];
	readonly routingCopies: readonly Readonly<MixRenderRoutingCopy>[];
	readonly directRoutingTrackIds: readonly string[];
}

interface MixRenderCommitOptions {
	readonly createId: (prefix: string) => string;
}

export function prepareMixRenderOperationCommit(
	project: ControllerProject,
	outputs: readonly Readonly<MixRenderRenderedOutput>[],
	options: Readonly<NormalizedMixRenderOptions>,
	runtime: Readonly<MixRenderCommitOptions>,
): Readonly<MixRenderOperationCommit> {
	if (!outputs.length) throw new TypeError('At least one rendered output is required.');
	if (options.mixDown && outputs.length !== 1) {
		throw new RangeError('A combined mix render requires exactly one output.');
	}
	const commands: AudioEditorCommand[] = [];
	const results: MixRenderResult[] = [];
	const routingCopies: MixRenderRoutingCopy[] = [];
	const directRoutingTrackIds: string[] = [];
	const placementOffsets = new Map<string, number>();
	if (options.mixDown) {
		prepareCombinedOutput(
			project, outputs[0]!, options, runtime, commands, results,
			placementOffsets, directRoutingTrackIds,
		);
	} else {
		for (const [index, output] of outputs.entries()) {
			prepareIndividualOutput(
				project, output, options, runtime, index, commands, results, routingCopies,
				placementOffsets,
			);
		}
	}
	commands.push(selectionCommand(project, results.map(({ trackId }) => trackId)));
	return Object.freeze({
		type: 'mix-render',
		command: Object.freeze({ type: 'batch', commands: Object.freeze(commands) }),
		results: Object.freeze(results.map((result) => Object.freeze(result))),
		routingCopies: Object.freeze(routingCopies.map((copy) => Object.freeze(copy))),
		directRoutingTrackIds: Object.freeze(directRoutingTrackIds),
	});
}

function prepareCombinedOutput(
	project: ControllerProject,
	output: Readonly<MixRenderRenderedOutput>,
	options: Readonly<NormalizedMixRenderOptions>,
	runtime: Readonly<MixRenderCommitOptions>,
	commands: AudioEditorCommand[],
	results: MixRenderResult[],
	placementOffsets: Map<string, number>,
	directRoutingTrackIds: string[],
): void {
	if (!output.targetTracks.length) throw new TypeError('A combined output requires target tracks.');
	const bottomTrack = output.targetTracks.at(-1)!;
	const targetIds = new Set(output.targetTracks.map(({ id }) => id));
	const bottomIndex = project.tracks.findIndex(({ id }) => id === bottomTrack.id);
	const defaultInsertIndex = options.replaceOriginals
		? project.tracks.slice(0, bottomIndex).filter(({ id }) => !targetIds.has(id)).length
		: bottomIndex + 1;
	const placement = combinedPlacement(project, bottomTrack.id, targetIds, options.replaceOriginals);
	const insertIndex = placement?.flatIndex ?? defaultInsertIndex;
	commands.push(createAddSourceCommand(output.source));
	if (options.replaceOriginals && output.targetTracks.length === 1) {
		const trackId = bottomTrack.id;
		const clipId = runtime.createId('mixed-clip');
		commands.push(
			...freezeRemovalCommands(project, bottomTrack),
			...v21StripLaneRemovalCommands(project, trackId),
			...bottomTrack.clipIds.map((clipIdToRemove): AudioEditorCommand => ({
				type: 'clip/remove', clipId: clipIdToRemove,
			})),
			...(bottomTrack.effects ?? []).map((effect): AudioEditorCommand => ({
				type: 'effect/remove', scope: 'track', trackId, effectId: effect.id,
			})),
			{ type: 'track/update', trackId, changes: neutralTrackChanges(project) },
		);
		if (placement?.moveToRoot) commands.push(createMoveTrackNodeCommand(
			placement.sequenceId,
			trackId,
			null,
			placement.parentIndex,
		));
		if (isSoundscaperProductionProject(project)) directRoutingTrackIds.push(trackId);
		else addDirectLegacyRouteCommand(project, trackId, commands);
		commands.push(renderedClipCommand(trackId, clipId, output));
		results.push({ trackId, clipId, sourceId: output.source.id });
		return;
	}
	const trackId = runtime.createId('mixed-track');
	const clipId = runtime.createId('mixed-clip');
	if (options.replaceOriginals) {
		commands.push(...output.targetTracks.map((track): AudioEditorCommand => ({
			type: 'track/remove', trackId: track.id,
		})));
	}
	commands.push({
		...createAddTrackCommand(renderedTrack(bottomTrack, trackId, output.name, project)),
		index: insertIndex,
		...(placement ? {
			sequenceId: placement.sequenceId,
			parentFolderId: placement.parentFolderId,
			parentIndex: placement.parentIndex,
		} : siblingPlacement(
			project, bottomTrack.id, placementOffsets,
			options.replaceOriginals ? targetIds : undefined,
		)),
	});
	commands.push(renderedClipCommand(trackId, clipId, output));
	if (isSoundscaperProductionProject(project)) directRoutingTrackIds.push(trackId);
	results.push({ trackId, clipId, sourceId: output.source.id });
}

function addDirectLegacyRouteCommand(
	project: ControllerProject,
	trackId: string,
	commands: AudioEditorCommand[],
): void {
	const route = project.mixer.routes[trackId];
	if (!route?.groupId && !Object.keys(route?.sends ?? {}).length) return;
	commands.push({
		type: 'mixer/route-update',
		trackId,
		changes: {
			groupId: null,
			sends: Object.fromEntries(Object.keys(route?.sends ?? {}).map((sendId) => [sendId, null])),
		},
	});
}

function prepareIndividualOutput(
	project: ControllerProject,
	output: Readonly<MixRenderRenderedOutput>,
	options: Readonly<NormalizedMixRenderOptions>,
	runtime: Readonly<MixRenderCommitOptions>,
	outputIndex: number,
	commands: AudioEditorCommand[],
	results: MixRenderResult[],
	routingCopies: MixRenderRoutingCopy[],
	placementOffsets: Map<string, number>,
): void {
	if (output.targetTracks.length !== 1) {
		throw new RangeError('An individual mix render output requires exactly one target track.');
	}
	const target = output.targetTracks[0]!;
	const trackId = options.replaceOriginals ? target.id : runtime.createId('rendered-track');
	const clipId = runtime.createId('rendered-clip');
	commands.push(createAddSourceCommand(output.source));
	if (options.replaceOriginals) {
		commands.push(
			...freezeRemovalCommands(project, target),
			...v21StripLaneRemovalCommands(project, target.id),
			...target.clipIds.map((clipIdToRemove): AudioEditorCommand => ({
				type: 'clip/remove', clipId: clipIdToRemove,
			})),
			...(target.effects ?? []).map((effect): AudioEditorCommand => ({
				type: 'effect/remove', scope: 'track', trackId: target.id, effectId: effect.id,
			})),
			{ type: 'track/update', trackId, changes: neutralTrackChanges(project) },
		);
	} else {
		const originalIndex = project.tracks.findIndex(({ id }) => id === target.id);
		commands.push({
			...createAddTrackCommand(renderedTrack(target, trackId, output.name, project)),
			index: originalIndex + outputIndex + 1,
			...siblingPlacement(project, target.id, placementOffsets),
		});
	}
	commands.push(renderedClipCommand(trackId, clipId, output));
	if (!options.replaceOriginals) {
		if (isSoundscaperProductionProject(project)) {
			routingCopies.push({ sourceTrackId: target.id, targetTrackId: trackId });
		} else {
			const route = project.mixer.routes[target.id] ?? { groupId: null, sends: {} };
			commands.push({
				type: 'mixer/route-update', trackId,
				changes: { groupId: route.groupId ?? null, sends: { ...(route.sends ?? {}) } },
			});
		}
	}
	results.push({ trackId, clipId, sourceId: output.source.id });
}

function freezeRemovalCommands(
	project: ControllerProject,
	track: ControllerTrack,
): AudioEditorCommand[] {
	if (!isSoundscaperProductionProject(project) || track.audioFreeze == null) return [];
	return [{
		type: 'audio-freeze/remove',
		trackId: track.id,
		expectedFreeze: track.audioFreeze,
	} as AudioEditorCommand];
}

function renderedTrack(
	template: ControllerTrack,
	id: string,
	name: string,
	project: ControllerProject,
): Record<string, unknown> {
	const rendered: Record<string, unknown> = {
		...template,
		id,
		name,
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
		armed: false,
		locked: false,
		laneGroupId: null,
		effectsActive: true,
		effects: [],
		clipIds: [],
		opaqueExtensions: {},
		...(isSoundscaperProductionProject(project) ? {} : { envelope: [] }),
	};
	delete rendered.audioFreeze;
	return rendered;
}

function neutralTrackChanges(project: ControllerProject): Record<string, unknown> {
	return {
		gain: 1, pan: 0, mute: false, solo: false, armed: false,
		...(isSoundscaperProductionProject(project) ? {} : { envelope: [] }),
	};
}

function renderedClipCommand(
	trackId: string,
	clipId: string,
	output: Readonly<MixRenderRenderedOutput>,
): AudioEditorCommand {
	return createAddClipCommand(trackId, {
		id: clipId,
		sourceId: output.source.id,
		title: output.name,
		timelineStartFrame: output.startFrame,
		sourceStartFrame: 0,
		sourceDurationFrames: output.source.frameCount,
		durationFrames: output.source.frameCount,
	});
}

function selectionCommand(project: ControllerProject, trackIds: readonly string[]): AudioEditorCommand {
	return {
		type: 'selection/set',
		startFrame: project.selection?.startFrame ?? 0,
		endFrame: project.selection?.endFrame ?? 0,
		trackIds,
		clipIds: [],
		frequencyRange: null,
	};
}

function siblingPlacement(
	project: ControllerProject,
	trackId: string,
	offsets: Map<string, number>,
	removedTrackIds?: ReadonlySet<string>,
): Record<string, unknown> {
	if (!Array.isArray(project.trackFolders) || !project.trackFolders.length) return {};
	for (const sequence of records(project.sequences)) {
		const nodes = records(sequence.trackNodes);
		const nodeIndex = nodes.findIndex(({ id }) => id === trackId);
		if (nodeIndex < 0) continue;
		const parentFolderId = typeof nodes[nodeIndex]!.parentFolderId === 'string'
			? nodes[nodeIndex]!.parentFolderId as string : null;
		const childIndex = nodes.slice(0, nodeIndex)
			.filter((node) => (node.parentFolderId ?? null) === parentFolderId).length;
		const removedBefore = nodes.slice(0, nodeIndex + 1).filter((node) => (
			(node.parentFolderId ?? null) === parentFolderId
			&& removedTrackIds?.has(String(node.id))
		)).length;
		const key = `${String(sequence.id)}\0${parentFolderId ?? ''}`;
		const offset = offsets.get(key) ?? 0;
		offsets.set(key, offset + 1);
		return {
			sequenceId: String(sequence.id), parentFolderId,
			parentIndex: childIndex + offset + 1 - removedBefore,
		};
	}
	return {};
}

interface CombinedPlacement {
	readonly sequenceId: string;
	readonly parentFolderId: null;
	readonly parentIndex: number;
	readonly flatIndex: number;
	readonly moveToRoot: true;
}

/** A baked combined bus path cannot remain inside the folder that owns that bus. */
function combinedPlacement(
	project: ControllerProject,
	trackId: string,
	removedTrackIds: ReadonlySet<string>,
	replaceOriginals: boolean,
): CombinedPlacement | null {
	if (!Array.isArray(project.trackFolders) || !project.trackFolders.length) return null;
	for (const sequence of records(project.sequences)) {
		const nodes = records(sequence.trackNodes);
		const nodeIndex = nodes.findIndex(({ id }) => id === trackId);
		if (nodeIndex < 0 || typeof nodes[nodeIndex]!.parentFolderId !== 'string') continue;
		const parentById = new Map(nodes.map((node) => [String(node.id), node.parentFolderId]));
		let topFolderId = String(nodes[nodeIndex]!.parentFolderId);
		while (typeof parentById.get(topFolderId) === 'string') {
			topFolderId = String(parentById.get(topFolderId));
		}
		const topIndex = nodes.findIndex(({ id }) => id === topFolderId);
		if (topIndex < 0) throw new ReferenceError(`Missing top-level track folder ${topFolderId}.`);
		const parentIndex = nodes.slice(0, topIndex + 1)
			.filter((node) => node.parentFolderId === null).length;
		const subtreeTrackIds = new Set(nodes.flatMap((node) => (
			node.kind === 'track' && topLevelFolderId(node, parentById) === topFolderId
				? [String(node.id)] : []
		)));
		const afterSubtree = Math.max(...project.tracks.map((track, index) => (
			subtreeTrackIds.has(track.id) ? index + 1 : 0
		)));
		const removedBefore = replaceOriginals
			? project.tracks.slice(0, afterSubtree).filter(({ id }) => removedTrackIds.has(id)).length
			: 0;
		return {
			sequenceId: String(sequence.id), parentFolderId: null, parentIndex,
			flatIndex: afterSubtree - removedBefore, moveToRoot: true,
		};
	}
	return null;
}

function topLevelFolderId(
	node: Record<string, unknown>,
	parentById: ReadonlyMap<string, unknown>,
): string | null {
	if (typeof node.parentFolderId !== 'string') return null;
	let parentId = node.parentFolderId;
	while (typeof parentById.get(parentId) === 'string') parentId = String(parentById.get(parentId));
	return parentId;
}

function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value)
		? value.filter((entry): entry is Record<string, unknown> => Boolean(entry)
			&& typeof entry === 'object' && !Array.isArray(entry))
		: [];
}

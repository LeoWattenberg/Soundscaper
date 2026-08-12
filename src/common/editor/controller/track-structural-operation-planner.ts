/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import {
	resolveTrackNodeSpanV12,
	trackNodeLaneGroupsV12,
} from '../track-hierarchy-mutation-v12.ts';
import type { TrackNodeV12 } from '../track-hierarchy-v12.ts';
import {
	resolveRuntimeClipProjection,
	type RuntimeClipProject,
} from '../runtime-clip-projection.ts';
import type {
	ControllerClip,
	ControllerProject,
	ControllerTrack,
} from './track-domain-types.ts';

export type TrackAlignmentMode =
	| 'end-to-end'
	| 'together'
	| 'start-zero'
	| 'start-playhead'
	| 'start-selection-end'
	| 'end-playhead'
	| 'end-selection-end';

export type TrackSortCriterion = 'time' | 'name';

export interface TrackAlignmentTransform {
	readonly clipId: string;
	readonly trackId: string;
	readonly changes: Readonly<{ timelineStartFrame: number }>;
}

export interface TrackAlignmentPlan {
	readonly transforms: readonly TrackAlignmentTransform[];
	readonly trackIds: readonly string[];
}

type StructuralCommand = Extract<AudioEditorCommand, {
	readonly type: 'track-node/move' | 'track/reorder';
}>;

interface StructuralSequence {
	readonly id: string;
	readonly trackNodes: readonly TrackNodeV12[];
}

interface StructuralFolder {
	readonly id: string;
	readonly name: string;
}

interface StructuralProject extends ControllerProject {
	readonly sequences?: readonly StructuralSequence[];
	readonly trackFolders?: readonly StructuralFolder[];
}

interface StructuralBlock {
	readonly sequenceId: string | null;
	readonly nodeId: string;
	readonly trackIds: readonly string[];
	readonly name: string;
	readonly ordinal: number;
}

interface TimedStructuralBlock extends StructuralBlock {
	readonly clips: readonly Readonly<{ clip: ControllerClip; trackId: string; start: number; end: number }>[];
	readonly start: number;
	readonly end: number;
}

/** Plan one atomic multi-clip alignment in resolved sample coordinates. */
export function planTrackAlignment(
	project: ControllerProject,
	requestedTrackIds: readonly string[],
	mode: TrackAlignmentMode,
	targetFrame?: number,
): Readonly<TrackAlignmentPlan> {
	const blocks = selectedTimedBlocks(project, requestedTrackIds);
	for (const block of blocks) assertBlockUnlocked(project, block);
	if (blocks.length === 0) return Object.freeze({ transforms: Object.freeze([]), trackIds: Object.freeze([]) });
	const starts = alignedBlockStarts(blocks, mode, targetFrame);
	const transforms: TrackAlignmentTransform[] = [];
	for (const [index, block] of blocks.entries()) {
		const delta = starts[index] - block.start;
		if (delta === 0) continue;
		for (const { clip, trackId, start } of block.clips) {
			const timelineStartFrame = safeFrame(start + delta, 'Aligned clip start');
			transforms.push(Object.freeze({
				clipId: clip.id,
				trackId,
				changes: Object.freeze({ timelineStartFrame }),
			}));
		}
	}
	return Object.freeze({
		transforms: Object.freeze(transforms),
		trackIds: Object.freeze(blocks.flatMap(({ trackIds }) => trackIds)),
	});
}

/** Plan one stable root-block sort; folder subtrees and linked lanes never split. */
export function planTrackSort(
	project: ControllerProject,
	criterion: TrackSortCriterion,
): readonly StructuralCommand[] {
	const blocks = structuralBlocks(project);
	const commands: StructuralCommand[] = [];
	const sequenceIds = [...new Set(blocks.map(({ sequenceId }) => sequenceId))];
	for (const sequenceId of sequenceIds) {
		const timed = blocks.filter((block) => block.sequenceId === sequenceId)
			.map((block) => timedBlock(project, block));
		const sorted = [...timed].sort((left, right) => {
			const comparison = criterion === 'time'
				? compareNumbers(left.start, right.start)
				: compareNames(left.name, right.name);
			return comparison || left.ordinal - right.ordinal;
		});
		if (sorted.every((block, index) => block.nodeId === timed[index]?.nodeId)) continue;
		for (const block of timed) assertBlockUnlocked(project, block);
		commands.push(...sorted.map((block, index): StructuralCommand => block.sequenceId === null
			? { type: 'track/reorder', trackId: block.nodeId, index: sorted
				.slice(0, index).reduce((total, preceding) => total + preceding.trackIds.length, 0) }
			: { type: 'track-node/move', sequenceId: block.sequenceId, nodeId: block.nodeId,
				parentFolderId: null, index }));
	}
	return Object.freeze(commands);
}

function selectedTimedBlocks(
	project: ControllerProject,
	requestedTrackIds: readonly string[],
): readonly TimedStructuralBlock[] {
	const requested = new Set(requestedTrackIds);
	return structuralBlocks(project)
		.filter((block) => block.trackIds.some((trackId) => requested.has(trackId)))
		.map((block) => timedBlock(project, block))
		.filter(({ clips }) => clips.length > 0);
}

function alignedBlockStarts(
	blocks: readonly TimedStructuralBlock[],
	mode: TrackAlignmentMode,
	targetFrame?: number,
): readonly number[] {
	if (mode === 'end-to-end') {
		let cursor = blocks[0].start;
		return blocks.map((block) => {
			const start = cursor;
			cursor = safeFrame(cursor + block.end - block.start, 'End-to-end alignment');
			return start;
		});
	}
	if (mode === 'together') {
		const divisor = BigInt(blocks.length);
		const total = blocks.reduce((sum, block) => sum + BigInt(block.start), 0n);
		const average = Number((total + divisor / 2n) / divisor);
		return blocks.map(() => average);
	}
	const target = mode === 'start-zero' ? 0 : safeFrame(targetFrame, 'Alignment target');
	return blocks.map((block) => {
		const start = mode.startsWith('start-') ? target : target - (block.end - block.start);
		if (start < 0) throw new RangeError('Alignment would make content precede frame zero.');
		return safeFrame(start, 'Aligned block start');
	});
}

function structuralBlocks(project: ControllerProject): readonly StructuralBlock[] {
	const candidate = project as StructuralProject;
	const sequences = candidate.sequences;
	if (project.schemaVersion < 12 || !sequences || sequences.length === 0) {
		return legacyStructuralBlocks(project.tracks);
	}
	if (!Array.isArray(candidate.trackFolders)) {
		throw new TypeError('Structural sorting requires canonical track folders.');
	}
	const folders = new Map((candidate.trackFolders ?? []).map((folder) => [folder.id, folder]));
	const trackById = new Map(project.tracks.map((track) => [track.id, track]));
	const laneGroups = trackNodeLaneGroupsV12(project.tracks);
	const blocks: StructuralBlock[] = [];
	const seenTrackIds = new Set<string>();
	let ordinal = 0;
	for (const sequence of sequences) {
		let index = 0;
		while (index < sequence.trackNodes.length) {
			const node = sequence.trackNodes[index];
			if (node.parentFolderId !== null) {
				index += 1;
				continue;
			}
			const span = resolveTrackNodeSpanV12(sequence.trackNodes, node.id, laneGroups);
			const trackIds = sequence.trackNodes.slice(span.start, span.end)
				.filter((entry) => entry.kind === 'track').map(({ id }) => id);
			for (const trackId of trackIds) {
				if (!trackById.has(trackId)) throw new ReferenceError(`Track hierarchy references missing track ${trackId}.`);
				if (seenTrackIds.has(trackId)) throw new RangeError(`Track hierarchy repeats track ${trackId}.`);
				seenTrackIds.add(trackId);
			}
			const name = node.kind === 'folder'
				? folders.get(node.id)?.name ?? node.id
				: trackById.get(node.id)?.name ?? node.id;
			blocks.push(Object.freeze({
				sequenceId: sequence.id, nodeId: node.id, trackIds: Object.freeze(trackIds),
				name, ordinal,
			}));
			ordinal += 1;
			index = span.end;
		}
	}
	if (seenTrackIds.size !== project.tracks.length) {
		throw new RangeError('Track hierarchy does not own every project track.');
	}
	return Object.freeze(blocks);
}

function legacyStructuralBlocks(tracks: readonly ControllerTrack[]): readonly StructuralBlock[] {
	const consumed = new Set<string>();
	const blocks: StructuralBlock[] = [];
	for (const track of tracks) {
		if (consumed.has(track.id)) continue;
		const members = track.laneGroupId
			? tracks.filter((candidate) => candidate.laneGroupId === track.laneGroupId)
			: [track];
		for (const member of members) consumed.add(member.id);
		blocks.push(Object.freeze({
			sequenceId: null, nodeId: track.id, trackIds: Object.freeze(members.map(({ id }) => id)),
			name: track.name, ordinal: blocks.length,
		}));
	}
	return Object.freeze(blocks);
}

function timedBlock(project: ControllerProject, block: StructuralBlock): TimedStructuralBlock {
	const clipById = new Map(project.clips.map((clip) => [clip.id, clip]));
	const trackById = new Map(project.tracks.map((track) => [track.id, track]));
	const clips = block.trackIds.flatMap((trackId) => {
		const track = trackById.get(trackId);
		const clipIds = Array.isArray(track?.clipIds) ? track.clipIds : [];
		return clipIds.flatMap((clipId) => {
			const clip = clipById.get(clipId);
			if (!clip) return [];
			const resolved = resolveRuntimeClipProjection(project as RuntimeClipProject, clip);
			return [{ clip, trackId, start: resolved.timelineStartFrame, end: resolved.timelineEndFrame }];
		});
	});
	return Object.freeze({
		...block,
		clips: Object.freeze(clips),
		start: clips.length ? Math.min(...clips.map(({ start }) => start)) : Number.POSITIVE_INFINITY,
		end: clips.length ? Math.max(...clips.map(({ end }) => end)) : Number.POSITIVE_INFINITY,
	});
}

function assertBlockUnlocked(project: ControllerProject, block: StructuralBlock): void {
	const trackById = new Map(project.tracks.map((track) => [track.id, track]));
	const locked = block.trackIds.find((trackId) => trackById.get(trackId)?.locked === true);
	if (locked) throw new RangeError(`Structural operation refused for locked track ${locked}.`);
}

function safeFrame(value: number | undefined, label: string): number {
	if (!Number.isSafeInteger(value) || (value ?? -1) < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer.`);
	}
	return value as number;
}

function compareNumbers(left: number, right: number): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareNames(left: string, right: string): number {
	const canonicalLeft = left.normalize('NFKC').toLocaleLowerCase('en-US');
	const canonicalRight = right.normalize('NFKC').toLocaleLowerCase('en-US');
	return canonicalLeft < canonicalRight ? -1 : canonicalLeft > canonicalRight ? 1 : 0;
}

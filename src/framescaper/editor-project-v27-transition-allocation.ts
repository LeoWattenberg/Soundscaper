/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoTransitionAllocationsV1,
	type VideoTransitionAllocationV1,
} from '../common/editor/video-transition-v1.ts';
import {
	applyFramescaperProjectCommandV20,
	snapshotFramescaperProjectCommandV20,
	type FramescaperProjectCommandV20,
} from './editor-project-v20-commands.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v20.ts';
import {
	framescaperProjectProperOverlapsV22,
} from './editor-project-v22-validation.ts';
import { isFramescaperOwnedVisualCommandTypeV24 } from './editor-project-v24-visual-command.ts';
import {
	snapshotFramescaperProjectCommandV27,
	type FramescaperProjectCommandBatchV27,
	type FramescaperProjectCommandV27,
} from './editor-project-v27-commands.ts';
import { isFramescaperOwnedFinishingCommandTypeV27 } from './editor-project-v27-finishing-command.ts';
import { framescaperProjectV20FoundationV27 } from './editor-project-v27-runtime.ts';
import {
	validateFramescaperProjectV27,
	type FramescaperProjectV27,
} from './editor-project-v27-validation.ts';

type CreateId = (prefix?: string) => string;

/** Add exact allocations to a selected-V27 command that creates proper video overlaps. */
export function prepareFramescaperVideoTransitionAllocationsV27(
	profile: unknown,
	projectValue: unknown,
	commandValue: unknown,
	createId: CreateId,
): FramescaperProjectCommandV27 {
	validateFramescaperProjectV27(profile, projectValue);
	if (typeof createId !== 'function') throw new TypeError('A transition ID factory is required.');
	const project = projectValue as FramescaperProjectV27;
	const command = snapshotFramescaperProjectCommandV27(commandValue);
	if (!isV20CommandTree(command)) return command;
	const visualClipIds = selectedVisualClipIds(project);
	const inherited = snapshotFramescaperProjectCommandV20(
		stripAllocations(command, visualClipIds) as FramescaperProjectCommandV20,
	);
	const applied = applyFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV20FoundationV27(profile, project),
		inherited,
		{ now: String(project.updatedAt) },
	);
	const priorPairs = transitionPairs(project);
	const supplied = collectAllocations(command);
	const suppliedPairs = new Set(supplied.map(allocationKey));
	const additions: VideoTransitionAllocationV1[] = [];
	for (const overlap of framescaperProjectProperOverlapsV22(applied)) {
		const key = pairKey(overlap.trackId, String(overlap.outgoing.id), String(overlap.incoming.id));
		if (priorPairs.has(key) || suppliedPairs.has(key)) continue;
		const allocation = normalizeVideoTransitionAllocationsV1([{
			trackId: overlap.trackId,
			outgoingClipId: String(overlap.outgoing.id),
			incomingClipId: String(overlap.incoming.id),
			transitionId: createId('transition'),
		}])[0]!;
		additions.push(allocation);
		suppliedPairs.add(key);
	}
	if (additions.length === 0) return command;
	return snapshotFramescaperProjectCommandV27(appendAllocations(command, additions));
}

function isV20CommandTree(command: FramescaperProjectCommandV27): boolean {
	if (isBatch(command)) return command.commands.every(isV20CommandTree);
	return command.type !== 'video-transition/set'
		&& !isFramescaperOwnedVisualCommandTypeV24(command.type)
		&& !isFramescaperOwnedFinishingCommandTypeV27(command.type);
}

function collectAllocations(command: FramescaperProjectCommandV27): readonly VideoTransitionAllocationV1[] {
	if (isBatch(command)) {
		return Object.freeze(command.commands.flatMap((child) => [...collectAllocations(child)]));
	}
	const descriptor = Object.getOwnPropertyDescriptor(command, 'videoTransitionAllocations');
	return descriptor === undefined
		? Object.freeze([])
		: normalizeVideoTransitionAllocationsV1(descriptor.value);
}

function stripAllocations(
	command: FramescaperProjectCommandV27,
	visualClipIds: ReadonlySet<string>,
): Record<string, unknown> {
	if (isBatch(command)) return {
		type: 'batch',
		commands: command.commands.map((child) => stripAllocations(child, visualClipIds)),
	};
	const result = structuredClone(command) as Record<string, unknown>;
	delete result.videoTransitionAllocations;
	if (result.type === 'selection/set' && Array.isArray(result.clipIds)) {
		result.clipIds = result.clipIds.filter((id) => !visualClipIds.has(String(id)));
	}
	return result;
}

function appendAllocations(
	command: FramescaperProjectCommandV27,
	additions: readonly VideoTransitionAllocationV1[],
): Record<string, unknown> {
	if (!isBatch(command)) {
		const current = Object.getOwnPropertyDescriptor(command, 'videoTransitionAllocations');
		return {
			...command,
			videoTransitionAllocations: [
				...(current === undefined ? [] : normalizeVideoTransitionAllocationsV1(current.value)),
				...additions,
			],
		};
	}
	const [first, ...rest] = command.commands;
	if (!first) throw new TypeError('A V27 command batch must not be empty.');
	return {
		type: 'batch',
		commands: [appendAllocations(first, additions), ...rest],
	};
}

function transitionPairs(project: FramescaperProjectV27): ReadonlySet<string> {
	const pairs = new Set<string>();
	const tracks = project.tracks as unknown as readonly Readonly<{
		readonly id: string;
		readonly type: string;
		readonly videoTransitions: readonly Readonly<{
			readonly outgoingClipId: string;
			readonly incomingClipId: string;
		}>[];
	}>[];
	for (const track of tracks) {
		if (track.type !== 'video') continue;
		for (const transition of track.videoTransitions) {
			pairs.add(pairKey(track.id, transition.outgoingClipId, transition.incomingClipId));
		}
	}
	return pairs;
}

function selectedVisualClipIds(project: FramescaperProjectV27): ReadonlySet<string> {
	const clips = project.clips as unknown as readonly Readonly<{
		readonly id: string;
		readonly kind: string;
	}>[];
	return new Set(clips.filter(({ kind }) => kind === 'still' || kind === 'generator')
		.map(({ id }) => id));
}

function isBatch(
	command: FramescaperProjectCommandV27,
): command is FramescaperProjectCommandBatchV27 {
	return command.type === 'batch' && Array.isArray(command.commands);
}

function allocationKey(allocation: VideoTransitionAllocationV1): string {
	return pairKey(allocation.trackId, allocation.outgoingClipId, allocation.incomingClipId);
}

function pairKey(trackId: string, outgoingClipId: string, incomingClipId: string): string {
	return JSON.stringify([trackId, outgoingClipId, incomingClipId]);
}

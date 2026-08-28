/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoTransitionAllocationsV1,
	type VideoTransitionAllocationV1,
} from '../common/editor/video-transition-v1.ts';
import {
	applyFramescaperProjectCommandRetime,
	snapshotFramescaperProjectCommandRetime,
	type FramescaperProjectCommandRetime,
} from './editor-project-retime-commands.ts';
import { FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	framescaperProjectProperOverlapsTransitions,
} from './editor-project-transitions-validation.ts';
import { isFramescaperOwnedVisualCommandTypeVisual } from './editor-project-visual-visual-command.ts';
import {
	snapshotFramescaperProjectCommandFinishing,
	type FramescaperProjectCommandBatchFinishing,
	type FramescaperProjectCommandFinishing,
} from './editor-project-finishing-commands.ts';
import { isFramescaperOwnedFinishingCommandTypeFinishing } from './editor-project-finishing-finishing-command.ts';
import { framescaperProjectRetimeFoundationFinishing } from './editor-project-finishing-runtime.ts';
import {
	validateFramescaperProjectFinishing,
	type FramescaperProjectFinishing,
} from './editor-project-finishing-validation.ts';

type CreateId = (prefix?: string) => string;

/** Add exact allocations to a selected-baseline command that creates proper video overlaps. */
export function prepareFramescaperVideoTransitionAllocationsFinishing(
	profile: unknown,
	projectValue: unknown,
	commandValue: unknown,
	createId: CreateId,
): FramescaperProjectCommandFinishing {
	validateFramescaperProjectFinishing(profile, projectValue);
	if (typeof createId !== 'function') throw new TypeError('A transition ID factory is required.');
	const project = projectValue as FramescaperProjectFinishing;
	const command = snapshotFramescaperProjectCommandFinishing(commandValue);
	if (!isRetimeCommandTree(command)) return command;
	const visualClipIds = selectedVisualClipIds(project);
	const inherited = snapshotFramescaperProjectCommandRetime(
		stripAllocations(command, visualClipIds) as FramescaperProjectCommandRetime,
	);
	const applied = applyFramescaperProjectCommandRetime(
		FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE,
		framescaperProjectRetimeFoundationFinishing(profile, project),
		inherited,
		{ now: String(project.updatedAt) },
	);
	const priorPairs = transitionPairs(project);
	const supplied = collectAllocations(command);
	const suppliedPairs = new Set(supplied.map(allocationKey));
	const additions: VideoTransitionAllocationV1[] = [];
	for (const overlap of framescaperProjectProperOverlapsTransitions(applied)) {
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
	return snapshotFramescaperProjectCommandFinishing(appendAllocations(command, additions));
}

function isRetimeCommandTree(command: FramescaperProjectCommandFinishing): boolean {
	if (isBatch(command)) return command.commands.every(isRetimeCommandTree);
	return command.type !== 'video-transition/set'
		&& !isFramescaperOwnedVisualCommandTypeVisual(command.type)
		&& !isFramescaperOwnedFinishingCommandTypeFinishing(command.type);
}

function collectAllocations(command: FramescaperProjectCommandFinishing): readonly VideoTransitionAllocationV1[] {
	if (isBatch(command)) {
		return Object.freeze(command.commands.flatMap((child) => [...collectAllocations(child)]));
	}
	const descriptor = Object.getOwnPropertyDescriptor(command, 'videoTransitionAllocations');
	return descriptor === undefined
		? Object.freeze([])
		: normalizeVideoTransitionAllocationsV1(descriptor.value);
}

function stripAllocations(
	command: FramescaperProjectCommandFinishing,
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
	command: FramescaperProjectCommandFinishing,
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
	if (!first) throw new TypeError('A finishing command batch must not be empty.');
	return {
		type: 'batch',
		commands: [appendAllocations(first, additions), ...rest],
	};
}

function transitionPairs(project: FramescaperProjectFinishing): ReadonlySet<string> {
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

function selectedVisualClipIds(project: FramescaperProjectFinishing): ReadonlySet<string> {
	const clips = project.clips as unknown as readonly Readonly<{
		readonly id: string;
		readonly kind: string;
	}>[];
	return new Set(clips.filter(({ kind }) => kind === 'still' || kind === 'generator')
		.map(({ id }) => id));
}

function isBatch(
	command: FramescaperProjectCommandFinishing,
): command is FramescaperProjectCommandBatchFinishing {
	return command.type === 'batch' && Array.isArray(command.commands);
}

function allocationKey(allocation: VideoTransitionAllocationV1): string {
	return pairKey(allocation.trackId, allocation.outgoingClipId, allocation.incomingClipId);
}

function pairKey(trackId: string, outgoingClipId: string, incomingClipId: string): string {
	return JSON.stringify([trackId, outgoingClipId, incomingClipId]);
}

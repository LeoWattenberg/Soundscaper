/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import { AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS } from '../common/editor/project-validation-budget.ts';
import {
	applyFramescaperProjectCommandV28,
	snapshotFramescaperProjectCommandV28,
	type FramescaperProjectCommandOptionsV28,
	type FramescaperProjectCommandV28,
} from './editor-project-v28-commands.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV30,
} from './editor-project-feature-requirements-v30.ts';
import { assertFramescaperProjectV30Profile } from './editor-project-runtime-profile-v30.ts';
import {
	applyFramescaperImageCommandV30,
	snapshotFramescaperImageCommandV30,
	type FramescaperImageCommandV30,
} from './editor-project-v30-image-command.ts';
import { framescaperProjectV28FoundationShapeV30 } from './editor-project-v30-foundation.ts';
import {
	validateFramescaperProjectV30,
	type FramescaperProjectV30,
} from './editor-project-v30.ts';

export interface FramescaperProjectCommandBatchV30 {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandV30[];
}

export type FramescaperProjectCommandV30 =
	| FramescaperImageCommandV30
	| FramescaperProjectCommandV28
	| FramescaperProjectCommandBatchV30;
export type FramescaperProjectCommandOptionsV30 = FramescaperProjectCommandOptionsV28;

const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;
interface SnapshotBudget { readonly active: Set<object>; count: number }

export function snapshotFramescaperProjectCommandV30(value: unknown): FramescaperProjectCommandV30 {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

export function applyFramescaperProjectCommandV30(
	profile: unknown,
	projectValue: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsV30 = {},
): FramescaperProjectV30 {
	assertFramescaperProjectV30Profile(profile);
	validateFramescaperProjectV30(profile, projectValue);
	const prior = projectValue as FramescaperProjectV30;
	const draft = applyBody(profile, prior, snapshotFramescaperProjectCommandV30(commandValue), options);
	return finalize(profile, prior, draft, options);
}

function snapshot(value: unknown, budget: SnapshotBudget, depth: number): FramescaperProjectCommandV30 {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS || depth > MAXIMUM_DEPTH) {
		throw new RangeError('Framescaper V30 command tree exceeds its bounded budget.');
	}
	const type = commandType(value);
	if (type === 'image-source/set' || type === 'image-clip/set') {
		return snapshotFramescaperImageCommandV30(value);
	}
	if (type !== 'batch') return snapshotFramescaperProjectCommandV28(value);
	const command = readClosedDomainRecord(value, 'Framescaper V30 batch', ['type', 'commands']);
	if (budget.active.has(command)) throw new TypeError('Cyclic V30 command batches are unsupported.');
	const commands = readClosedDomainArray(
		readClosedDomainField(command, 'commands', 'Framescaper V30 batch'),
		'Framescaper V30 batch.commands', 1, MAXIMUM_COMMANDS,
	);
	budget.active.add(command);
	try {
		return Object.freeze({
			type: 'batch', commands: Object.freeze(commands.map((child) => snapshot(child, budget, depth + 1))),
		});
	} finally { budget.active.delete(command); }
}

function applyBody(
	profile: unknown,
	project: FramescaperProjectV30,
	command: FramescaperProjectCommandV30,
	options: FramescaperProjectCommandOptionsV30,
): Record<string, unknown> {
	if (isBatch(command)) {
		let current = structuredClone(project) as unknown as Record<string, unknown>;
		for (const child of command.commands) {
			current = applyBody(profile, current as unknown as FramescaperProjectV30, child, options);
		}
		return current;
	}
	if (isImageCommand(command)) {
		const draft = structuredClone(project) as unknown as Record<string, unknown>;
		applyFramescaperImageCommandV30(draft, command);
		return draft;
	}
	return applyInherited(project, command as FramescaperProjectCommandV28, options);
}

function applyInherited(
	project: FramescaperProjectV30,
	command: FramescaperProjectCommandV28,
	options: FramescaperProjectCommandOptionsV30,
): Record<string, unknown> {
	const images = captureImages(project);
	const applied = applyFramescaperProjectCommandV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV28FoundationShapeV30(project),
		command,
		options,
	) as unknown as Record<string, unknown>;
	return restoreImages(applied, images);
}

interface ImageState {
	readonly sources: readonly Record<string, unknown>[];
	readonly timelineClips: readonly Record<string, unknown>[];
	readonly binClips: readonly Record<string, unknown>[];
	readonly trackByClip: ReadonlyMap<string, string>;
	readonly selectedClipIds: ReadonlySet<string>;
}

function captureImages(project: FramescaperProjectV30): ImageState {
	const timelineClips = records(project.clips, 'clips').filter(({ kind }) => kind === 'image');
	const bin = record(project.projectBin, 'projectBin');
	const binClips = records(bin.clips, 'projectBin.clips').filter(({ kind }) => kind === 'image');
	const imageIds = new Set([...timelineClips, ...binClips].map(({ id }) => String(id)));
	const trackByClip = new Map<string, string>();
	for (const track of records(project.tracks, 'tracks')) {
		if (!Array.isArray(track.clipIds)) continue;
		for (const id of track.clipIds.map(String)) if (imageIds.has(id)) trackByClip.set(id, String(track.id));
	}
	const selection = record(project.selection, 'selection');
	const selectedClipIds = new Set(Array.isArray(selection.clipIds)
		? selection.clipIds.map(String).filter((id) => imageIds.has(id)) : []);
	return Object.freeze({
		sources: records(project.sources, 'sources').filter(({ kind }) => kind === 'image'),
		timelineClips, binClips, trackByClip, selectedClipIds,
	});
}

function restoreImages(project: Record<string, unknown>, images: ImageState): Record<string, unknown> {
	project.schemaVersion = 30;
	project.sources = [...records(project.sources, 'sources'), ...structuredClone(images.sources)];
	project.clips = [...records(project.clips, 'clips'), ...structuredClone(images.timelineClips)];
	const bin = record(project.projectBin, 'projectBin');
	bin.clips = [...records(bin.clips, 'projectBin.clips'), ...structuredClone(images.binClips)];
	project.tracks = records(project.tracks, 'tracks').map((track) => {
		const owned = [...images.trackByClip].filter(([, trackId]) => trackId === String(track.id))
			.map(([clipId]) => clipId);
		return { ...track, clipIds: Array.isArray(track.clipIds) ? [...track.clipIds, ...owned] : track.clipIds };
	});
	const selection = record(project.selection, 'selection');
	if (Array.isArray(selection.clipIds)) selection.clipIds = [
		...selection.clipIds,
		...images.selectedClipIds,
	];
	return project;
}

function finalize(
	profile: unknown,
	prior: FramescaperProjectV30,
	draft: Record<string, unknown>,
	options: FramescaperProjectCommandOptionsV30,
): FramescaperProjectV30 {
	const revision = Number(prior.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V30 revision overflowed.');
	draft.revision = revision;
	const date = options.now === undefined ? new Date() : new Date(options.now);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V30 timestamp is invalid.');
	draft.updatedAt = date.toISOString();
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV30(profile, draft);
	validateFramescaperProjectV30(profile, draft);
	return draft as unknown as FramescaperProjectV30;
}

function isBatch(command: FramescaperProjectCommandV30): command is FramescaperProjectCommandBatchV30 {
	return command.type === 'batch' && 'commands' in command && Array.isArray(command.commands);
}

function isImageCommand(command: FramescaperProjectCommandV30): command is FramescaperImageCommandV30 {
	return command.type === 'image-source/set' || command.type === 'image-clip/set';
}

function commandType(value: unknown): string {
	const command = record(value, 'Framescaper V30 command');
	const type = readClosedDomainField(command, 'type', 'Framescaper V30 command');
	if (typeof type !== 'string') throw new TypeError('Framescaper V30 command.type must be a string.');
	return type;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

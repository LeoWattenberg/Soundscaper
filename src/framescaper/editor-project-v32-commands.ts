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
	reconcileFramescaperProjectFeatureRequirementsV32,
} from './editor-project-feature-requirements-v32.ts';
import { assertFramescaperProjectV32Profile } from './editor-project-runtime-profile-v32.ts';
import {
	applyFramescaperImageCommandV32,
	snapshotFramescaperImageCommandV32,
	type FramescaperImageCommandV32,
} from './editor-project-v32-image-command.ts';
import { framescaperProjectV28FoundationShapeV32 } from './editor-project-v32-foundation.ts';
import {
	validateFramescaperProjectV32,
	type FramescaperProjectV32,
} from './editor-project-v32.ts';

export interface FramescaperProjectCommandBatchV32 {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandV32[];
}

export type FramescaperProjectCommandV32 =
	| FramescaperImageCommandV32
	| FramescaperProjectCommandV28
	| FramescaperProjectCommandBatchV32;
export type FramescaperProjectCommandOptionsV32 = FramescaperProjectCommandOptionsV28;

const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;
interface SnapshotBudget { readonly active: Set<object>; count: number }

export function snapshotFramescaperProjectCommandV32(value: unknown): FramescaperProjectCommandV32 {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

export function applyFramescaperProjectCommandV32(
	profile: unknown,
	projectValue: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsV32 = {},
): FramescaperProjectV32 {
	assertFramescaperProjectV32Profile(profile);
	validateFramescaperProjectV32(profile, projectValue);
	const prior = projectValue as FramescaperProjectV32;
	const draft = applyBody(profile, prior, snapshotFramescaperProjectCommandV32(commandValue), options);
	return finalize(profile, prior, draft, options);
}

function snapshot(value: unknown, budget: SnapshotBudget, depth: number): FramescaperProjectCommandV32 {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS || depth > MAXIMUM_DEPTH) {
		throw new RangeError('Framescaper V32 command tree exceeds its bounded budget.');
	}
	const type = commandType(value);
	if (type === 'image-source/set' || type === 'image-clip/set') {
		return snapshotFramescaperImageCommandV32(value);
	}
	if (type !== 'batch') return snapshotFramescaperProjectCommandV28(value);
	const command = readClosedDomainRecord(value, 'Framescaper V32 batch', ['type', 'commands']);
	if (budget.active.has(command)) throw new TypeError('Cyclic V32 command batches are unsupported.');
	const commands = readClosedDomainArray(
		readClosedDomainField(command, 'commands', 'Framescaper V32 batch'),
		'Framescaper V32 batch.commands', 1, MAXIMUM_COMMANDS,
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
	project: FramescaperProjectV32,
	command: FramescaperProjectCommandV32,
	options: FramescaperProjectCommandOptionsV32,
): Record<string, unknown> {
	if (isBatch(command)) {
		return applyBatch(profile, project, command, options);
	}
	if (isImageCommand(command)) {
		const draft = structuredClone(project) as unknown as Record<string, unknown>;
		applyFramescaperImageCommandV32(draft, command);
		return draft;
	}
	return applyInherited(project, command as FramescaperProjectCommandV28, options);
}

function applyBatch(
	profile: unknown,
	project: FramescaperProjectV32,
	command: FramescaperProjectCommandBatchV32,
	options: FramescaperProjectCommandOptionsV32,
): Record<string, unknown> {
	if (!containsImageCommand(command)) {
		return applyInherited(project, command as unknown as FramescaperProjectCommandV28, options);
	}
	let current = structuredClone(project) as unknown as Record<string, unknown>;
	let inherited: FramescaperProjectCommandV28[] = [];
	const flushInherited = (): void => {
		if (inherited.length === 0) return;
		current = applyInherited(current as unknown as FramescaperProjectV32, {
			type: 'batch', commands: inherited,
		}, options);
		inherited = [];
	};
	for (const child of command.commands) {
		if (!containsImageCommand(child)) {
			inherited.push(child as FramescaperProjectCommandV28);
			continue;
		}
		flushInherited();
		current = applyBody(profile, current as unknown as FramescaperProjectV32, child, options);
	}
	flushInherited();
	return current;
}

function containsImageCommand(command: FramescaperProjectCommandV32): boolean {
	if (isImageCommand(command)) return true;
	return isBatch(command) && command.commands.some(containsImageCommand);
}

function applyInherited(
	project: FramescaperProjectV32,
	command: FramescaperProjectCommandV28,
	options: FramescaperProjectCommandOptionsV32,
): Record<string, unknown> {
	const images = captureImages(project);
	const applied = applyFramescaperProjectCommandV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV28FoundationShapeV32(project),
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

function captureImages(project: FramescaperProjectV32): ImageState {
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
	project.schemaVersion = 32;
	// A timeline image belongs to exactly one video track. When the inherited
	// command removed that track the image goes with it: restoring it would
	// leave a clip the validator refuses for having no owner, which would make
	// the removal itself impossible.
	const trackIds = new Set(records(project.tracks, 'tracks').map(({ id }) => String(id)));
	const timelineClips = images.timelineClips.filter(
		(clip) => trackIds.has(images.trackByClip.get(String(clip.id)) ?? ''),
	);
	const restoredIds = new Set([...timelineClips, ...images.binClips].map(({ id }) => String(id)));
	project.sources = [...records(project.sources, 'sources'), ...structuredClone(images.sources)];
	project.clips = [...records(project.clips, 'clips'), ...structuredClone(timelineClips)];
	const bin = record(project.projectBin, 'projectBin');
	bin.clips = [...records(bin.clips, 'projectBin.clips'), ...structuredClone(images.binClips)];
	project.tracks = records(project.tracks, 'tracks').map((track) => {
		const owned = [...images.trackByClip].filter(([, trackId]) => trackId === String(track.id))
			.map(([clipId]) => clipId);
		return Array.isArray(track.clipIds)
			? { ...track, clipIds: [...track.clipIds, ...owned] }
			: track;
	});
	const selection = record(project.selection, 'selection');
	if (Array.isArray(selection.clipIds)) selection.clipIds = [
		...selection.clipIds,
		...[...images.selectedClipIds].filter((id) => restoredIds.has(id)),
	];
	return project;
}

function finalize(
	profile: unknown,
	prior: FramescaperProjectV32,
	draft: Record<string, unknown>,
	options: FramescaperProjectCommandOptionsV32,
): FramescaperProjectV32 {
	const revision = Number(prior.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V32 revision overflowed.');
	draft.revision = revision;
	const date = options.now === undefined ? new Date() : new Date(options.now);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V32 timestamp is invalid.');
	draft.updatedAt = date.toISOString();
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV32(profile, draft);
	validateFramescaperProjectV32(profile, draft);
	return draft as unknown as FramescaperProjectV32;
}

function isBatch(command: FramescaperProjectCommandV32): command is FramescaperProjectCommandBatchV32 {
	return command.type === 'batch' && 'commands' in command && Array.isArray(command.commands);
}

function isImageCommand(command: FramescaperProjectCommandV32): command is FramescaperImageCommandV32 {
	return command.type === 'image-source/set' || command.type === 'image-clip/set';
}

function commandType(value: unknown): string {
	const command = record(value, 'Framescaper V32 command');
	const type = readClosedDomainField(command, 'type', 'Framescaper V32 command');
	if (typeof type !== 'string') throw new TypeError('Framescaper V32 command.type must be a string.');
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

/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import { AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS } from '../common/editor/project-validation-budget.ts';
import {
	applyFramescaperProjectCommandNativeMedia,
	snapshotFramescaperProjectCommandNativeMedia,
	type FramescaperProjectCommandOptionsNativeMedia,
	type FramescaperProjectCommandNativeMedia,
} from './editor-project-native-media-commands.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsTimelineImage,
} from './editor-project-feature-requirements-timeline-image.ts';
import { assertFramescaperProjectTimelineImageProfile } from './editor-domain-runtime-profile.ts';
import {
	applyFramescaperImageCommandTimelineImage,
	snapshotFramescaperImageCommandTimelineImage,
	type FramescaperImageCommandTimelineImage,
} from './editor-project-timeline-image-image-command.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import {
	validateFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImage,
} from './editor-project-timeline-image.ts';

export interface FramescaperProjectCommandBatchTimelineImage {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandTimelineImage[];
}

export type FramescaperProjectCommandTimelineImage =
	| FramescaperImageCommandTimelineImage
	| FramescaperProjectCommandNativeMedia
	| FramescaperProjectCommandBatchTimelineImage;
export type FramescaperProjectCommandOptionsTimelineImage = FramescaperProjectCommandOptionsNativeMedia;

const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;
interface SnapshotBudget { readonly active: Set<object>; count: number }

export function snapshotFramescaperProjectCommandTimelineImage(value: unknown): FramescaperProjectCommandTimelineImage {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

export function applyFramescaperProjectCommandTimelineImage(
	profile: unknown,
	projectValue: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsTimelineImage = {},
): FramescaperProjectTimelineImage {
	assertFramescaperProjectTimelineImageProfile(profile);
	validateFramescaperProjectTimelineImage(profile, projectValue);
	const prior = projectValue as FramescaperProjectTimelineImage;
	const draft = applyBody(profile, prior, snapshotFramescaperProjectCommandTimelineImage(commandValue), options);
	return finalize(profile, prior, draft, options);
}

function snapshot(value: unknown, budget: SnapshotBudget, depth: number): FramescaperProjectCommandTimelineImage {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS || depth > MAXIMUM_DEPTH) {
		throw new RangeError('Framescaper timelineImage command tree exceeds its bounded budget.');
	}
	const type = commandType(value);
	if (type === 'image-source/set' || type === 'image-clip/set') {
		return snapshotFramescaperImageCommandTimelineImage(value);
	}
	if (type !== 'batch') return snapshotFramescaperProjectCommandNativeMedia(value);
	const command = readClosedDomainRecord(value, 'Framescaper timelineImage batch', ['type', 'commands']);
	if (budget.active.has(command)) throw new TypeError('Cyclic timelineImage command batches are unsupported.');
	const commands = readClosedDomainArray(
		readClosedDomainField(command, 'commands', 'Framescaper timelineImage batch'),
		'Framescaper timelineImage batch.commands', 1, MAXIMUM_COMMANDS,
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
	project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandTimelineImage,
	options: FramescaperProjectCommandOptionsTimelineImage,
): Record<string, unknown> {
	if (isBatch(command)) {
		return applyBatch(profile, project, command, options);
	}
	if (isImageCommand(command)) {
		const draft = structuredClone(project) as unknown as Record<string, unknown>;
		applyFramescaperImageCommandTimelineImage(draft, command);
		return draft;
	}
	return applyInherited(project, command as FramescaperProjectCommandNativeMedia, options);
}

function applyBatch(
	profile: unknown,
	project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandBatchTimelineImage,
	options: FramescaperProjectCommandOptionsTimelineImage,
): Record<string, unknown> {
	if (!containsImageCommand(command)) {
		return applyInherited(project, command as unknown as FramescaperProjectCommandNativeMedia, options);
	}
	let current = structuredClone(project) as unknown as Record<string, unknown>;
	let inherited: FramescaperProjectCommandNativeMedia[] = [];
	const flushInherited = (): void => {
		if (inherited.length === 0) return;
		current = applyInherited(current as unknown as FramescaperProjectTimelineImage, {
			type: 'batch', commands: inherited,
		}, options);
		inherited = [];
	};
	for (const child of command.commands) {
		if (!containsImageCommand(child)) {
			inherited.push(child as FramescaperProjectCommandNativeMedia);
			continue;
		}
		flushInherited();
		current = applyBody(profile, current as unknown as FramescaperProjectTimelineImage, child, options);
	}
	flushInherited();
	return current;
}

function containsImageCommand(command: FramescaperProjectCommandTimelineImage): boolean {
	if (isImageCommand(command)) return true;
	return isBatch(command) && command.commands.some(containsImageCommand);
}

function applyInherited(
	project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandNativeMedia,
	options: FramescaperProjectCommandOptionsTimelineImage,
): Record<string, unknown> {
	const images = captureImages(project);
	const applied = applyFramescaperProjectCommandNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
		framescaperProjectNativeMediaFoundationShapeTimelineImage(project),
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

function captureImages(project: FramescaperProjectTimelineImage): ImageState {
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
	project.schemaVersion =  1;
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
	prior: FramescaperProjectTimelineImage,
	draft: Record<string, unknown>,
	options: FramescaperProjectCommandOptionsTimelineImage,
): FramescaperProjectTimelineImage {
	const revision = Number(prior.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper timelineImage revision overflowed.');
	draft.revision = revision;
	const date = options.now === undefined ? new Date() : new Date(options.now);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper timelineImage timestamp is invalid.');
	draft.updatedAt = date.toISOString();
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsTimelineImage(profile, draft);
	validateFramescaperProjectTimelineImage(profile, draft);
	return draft as unknown as FramescaperProjectTimelineImage;
}

function isBatch(command: FramescaperProjectCommandTimelineImage): command is FramescaperProjectCommandBatchTimelineImage {
	return command.type === 'batch' && 'commands' in command && Array.isArray(command.commands);
}

function isImageCommand(command: FramescaperProjectCommandTimelineImage): command is FramescaperImageCommandTimelineImage {
	return command.type === 'image-source/set' || command.type === 'image-clip/set';
}

function commandType(value: unknown): string {
	const command = record(value, 'Framescaper timelineImage command');
	const type = readClosedDomainField(command, 'type', 'Framescaper timelineImage command');
	if (typeof type !== 'string') throw new TypeError('Framescaper timelineImage command.type must be a string.');
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

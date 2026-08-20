/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	cloneVideoClipComposition,
	normalizeVideoClipComposition,
	videoClipCompositionsEqual,
	type VideoClipComposition,
} from '../common/editor/video-clip-composition.ts';
import {
	normalizeAudioEditorClipboardDescriptor,
} from '../common/editor/commands/clipboard-codec.ts';
import { snapshotInertEditorCommand } from '../common/editor/commands/editor-command-snapshot.ts';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import { AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS } from '../common/editor/project-validation-budget.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	applyFramescaperProjectCommandV18,
} from './editor-project-v18-commands.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';
import type { FramescaperProjectCommandV18 } from './editor-project-v18-subsequence.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV19,
} from './editor-project-feature-requirements-v19.ts';
import {
	cloneFramescaperProjectV19,
	normalizeFramescaperProjectClipCompositionsV19,
} from './editor-project-v19.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';
import {
	validateFramescaperProjectV19,
	type FramescaperProjectV19,
} from './editor-project-v19-validation.ts';
import { framescaperProjectV18FoundationV19 } from './editor-project-v19-validation.ts';

export interface FramescaperVideoCompositionSetCommandV19 {
	readonly type: 'video-composition/set';
	readonly clipId: string;
	readonly expectedComposition: VideoClipComposition;
	readonly composition: VideoClipComposition;
}

export type FramescaperProjectCommandV19 = FramescaperProjectCommandV18;

export interface FramescaperProjectCommandOptionsV19 {
	readonly now?: Date | string;
}

const COMMAND_FIELDS = Object.freeze([
	'type', 'clipId', 'expectedComposition', 'composition',
]);

/** Snapshot the one exact V19 command without invoking inherited state or accessors. */
export function normalizeFramescaperProjectCommandV19(
	value: unknown,
): FramescaperVideoCompositionSetCommandV19 {
	const command = readClosedDomainRecord(value, 'Framescaper V19 command', COMMAND_FIELDS);
	const type = readClosedDomainField(command, 'type', 'Framescaper V19 command');
	if (type !== 'video-composition/set') {
		throw new RangeError('Framescaper V19 command.type must be video-composition/set.');
	}
	const clipId = readClosedDomainField(command, 'clipId', 'Framescaper V19 command');
	if (typeof clipId !== 'string' || clipId.length === 0) {
		throw new TypeError('Framescaper V19 command.clipId must be a non-empty string.');
	}
	return Object.freeze({
		type,
		clipId,
		expectedComposition: normalizeVideoClipComposition(
			readClosedDomainField(command, 'expectedComposition', 'Framescaper V19 command'),
			'Framescaper V19 command.expectedComposition',
		),
		composition: normalizeVideoClipComposition(
			readClosedDomainField(command, 'composition', 'Framescaper V19 command'),
			'Framescaper V19 command.composition',
		),
	});
}

export function isFramescaperVideoCompositionCommandV19(
	value: FramescaperProjectCommandV19 | unknown,
): value is FramescaperVideoCompositionSetCommandV19 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
	return Boolean(
		descriptor?.enumerable
		&& Object.hasOwn(descriptor, 'value')
		&& descriptor.value === 'video-composition/set',
	);
}

/** Snapshot a V19 or inherited V18 command for bounded history ownership. */
export function snapshotFramescaperProjectCommandV19(
	command: FramescaperProjectCommandV19,
): FramescaperProjectCommandV19 {
	if (isFramescaperVideoCompositionCommandV19(command)) {
		return normalizeFramescaperProjectCommandV19(command);
	}
	return snapshotInertEditorCommand(command, 'Framescaper V19 command') as FramescaperProjectCommandV19;
}

/** Replace one timeline or Project Bin video's complete composition by optimistic equality. */
export function applyFramescaperProjectCommandV19(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV19 | unknown,
	command: FramescaperProjectCommandV19,
	options: FramescaperProjectCommandOptionsV19 = {},
): FramescaperProjectV19 {
	assertFramescaperProjectV19Profile(profile);
	validateFramescaperProjectV19(profile, project);
	const persisted = project as FramescaperProjectV19;
	const normalizedCommand = snapshotFramescaperProjectCommandV19(command);
	if (!isFramescaperVideoCompositionCommandV19(normalizedCommand)) {
		assertCurrentVideoClipboardV19(normalizedCommand);
		const foundation = framescaperProjectV18FoundationV19(profile, persisted, {
			retainComposition: true,
		});
		const commanded = applyFramescaperProjectCommandV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			foundation,
			normalizedCommand,
			options,
		) as unknown as Record<string, unknown>;
		commanded.schemaVersion = 19;
		normalizeFramescaperProjectClipCompositionsV19(commanded);
		commanded.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV19(profile, commanded);
		validateFramescaperProjectV19(profile, commanded);
		return commanded as FramescaperProjectV19;
	}
	const normalized = normalizedCommand;
	const current = findClip(persisted, normalized.clipId);
	if (current.kind !== 'video') {
		throw new RangeError(`Clip ${normalized.clipId} is not a video clip and cannot carry video composition.`);
	}
	assertClipTrackUnlocked(persisted, normalized.clipId);
	const currentComposition = dataProperty(
		current,
		'videoComposition',
		`Framescaper V19 video clip ${normalized.clipId}`,
	);
	if (!videoClipCompositionsEqual(currentComposition, normalized.expectedComposition)) {
		throw new RangeError(`Video clip ${normalized.clipId} has a stale expected composition.`);
	}

	const draft = cloneFramescaperProjectV19(profile, persisted) as unknown as Record<string, unknown>;
	const target = findClip(draft, normalized.clipId);
	target.videoComposition = cloneVideoClipComposition(
		normalized.composition,
		`Framescaper V19 video clip ${normalized.clipId}.videoComposition`,
	);
	const revision = persisted.revision + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V19 project revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now, 'V19 command');
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV19(profile, draft);
	validateFramescaperProjectV19(profile, draft);
	return draft as FramescaperProjectV19;
}

function assertClipTrackUnlocked(project: FramescaperProjectV19, clipId: string): void {
	for (const trackValue of project.tracks) {
		const track = dataRecord(trackValue, 'Framescaper V19 track');
		const clipIds = dataProperty(track, 'clipIds', 'Framescaper V19 track');
		if (!Array.isArray(clipIds) || !clipIds.includes(clipId)) continue;
		if (dataProperty(track, 'locked', 'Framescaper V19 track') === true) {
			throw new RangeError(`Locked track ${String(track.id)} cannot edit video clip ${clipId}.`);
		}
	}
}

function assertCurrentVideoClipboardV19(command: FramescaperProjectCommandV19): void {
	const limits = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS;
	const stack: Array<Readonly<{ command: unknown; depth: number }>> = [{ command, depth: 0 }];
	let nodes = 0;
	while (stack.length > 0) {
		const work = stack.pop()!;
		nodes += 1;
		if (nodes > limits.maximumTraversalNodes) {
			throw new RangeError('Framescaper V19 clipboard command traversal exceeds its structural limit.');
		}
		if (work.depth > limits.maximumTraversalDepth) {
			throw new RangeError('Framescaper V19 clipboard command nesting exceeds its structural limit.');
		}
		const candidate = dataRecord(work.command, 'Framescaper V19 inherited command');
		const type = dataProperty(candidate, 'type', 'Framescaper V19 inherited command');
		if (type === 'batch') {
			const children = readClosedDomainArray(
				dataProperty(candidate, 'commands', 'Framescaper V19 batch command'),
				'Framescaper V19 batch command.commands',
				0,
				limits.maximumTraversalNodes,
			);
			for (let index = children.length - 1; index >= 0; index -= 1) {
				stack.push({ command: children[index], depth: work.depth + 1 });
			}
			continue;
		}
		if (type !== 'clipboard/paste') continue;
		const clipboard = normalizeAudioEditorClipboardDescriptor(
			dataProperty(candidate, 'clipboard', 'Framescaper V19 clipboard paste'),
		);
		if (clipboard.schemaVersion !== 5
			&& clipboard.tracks.some((track) => track.sourceTrackType === 'video')) {
			throw new RangeError('Framescaper V19 video clipboard content requires V5 recopy.');
		}
	}
}

function findClip(project: FramescaperProjectV19 | Record<string, unknown>, clipId: string): Record<string, unknown> {
	const candidate = project as Record<string, unknown>;
	const timeline = dataArray(dataProperty(candidate, 'clips', 'Framescaper V19 project'), 'project.clips');
	const projectBin = dataRecord(
		dataProperty(candidate, 'projectBin', 'Framescaper V19 project'),
		'Framescaper V19 project.projectBin',
	);
	const bin = dataArray(
		dataProperty(projectBin, 'clips', 'Framescaper V19 project.projectBin'),
		'project.projectBin.clips',
	);
	const found = [...timeline, ...bin].find((clip) => (
		dataProperty(clip, 'id', 'Framescaper V19 clip') === clipId
	));
	if (!found) throw new ReferenceError(`Framescaper V19 clip ${clipId} is missing.`);
	return found;
}

function dataArray(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((entry, index) => dataRecord(entry, `${name}[${String(index)}]`));
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function timestamp(value: Date | string | undefined, owner: string): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError(`A valid ${owner} timestamp is required.`);
	return date.toISOString();
}

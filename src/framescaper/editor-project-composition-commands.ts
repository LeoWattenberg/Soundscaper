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
	applyFramescaperProjectCommandSequence,
} from './editor-project-sequence-commands.ts';
import { FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import type { FramescaperProjectCommandSequence } from './editor-project-sequence-subsequence.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsComposition,
} from './editor-project-feature-requirements-composition.ts';
import {
	cloneFramescaperProjectComposition,
	normalizeFramescaperProjectClipCompositionsComposition,
} from './editor-project-composition.ts';
import { assertFramescaperProjectCompositionProfile } from './editor-domain-runtime-profile.ts';
import {
	validateFramescaperProjectComposition,
	type FramescaperProjectComposition,
} from './editor-project-composition-validation.ts';
import { framescaperProjectSequenceFoundationComposition } from './editor-project-composition-validation.ts';

export interface FramescaperVideoCompositionSetCommandComposition {
	readonly type: 'video-composition/set';
	readonly clipId: string;
	readonly expectedComposition: VideoClipComposition;
	readonly composition: VideoClipComposition;
}

export type FramescaperProjectCommandComposition = FramescaperProjectCommandSequence;

export interface FramescaperProjectCommandOptionsComposition {
	readonly now?: Date | string;
}

const COMMAND_FIELDS = Object.freeze([
	'type', 'clipId', 'expectedComposition', 'composition',
]);

/** Snapshot the one exact composition command without invoking inherited state or accessors. */
export function normalizeFramescaperProjectCommandComposition(
	value: unknown,
): FramescaperVideoCompositionSetCommandComposition {
	const command = readClosedDomainRecord(value, 'Framescaper composition command', COMMAND_FIELDS);
	const type = readClosedDomainField(command, 'type', 'Framescaper composition command');
	if (type !== 'video-composition/set') {
		throw new RangeError('Framescaper composition command.type must be video-composition/set.');
	}
	const clipId = readClosedDomainField(command, 'clipId', 'Framescaper composition command');
	if (typeof clipId !== 'string' || clipId.length === 0) {
		throw new TypeError('Framescaper composition command.clipId must be a non-empty string.');
	}
	return Object.freeze({
		type,
		clipId,
		expectedComposition: normalizeVideoClipComposition(
			readClosedDomainField(command, 'expectedComposition', 'Framescaper composition command'),
			'Framescaper composition command.expectedComposition',
		),
		composition: normalizeVideoClipComposition(
			readClosedDomainField(command, 'composition', 'Framescaper composition command'),
			'Framescaper composition command.composition',
		),
	});
}

export function isFramescaperVideoCompositionCommandComposition(
	value: FramescaperProjectCommandComposition | unknown,
): value is FramescaperVideoCompositionSetCommandComposition {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
	return Boolean(
		descriptor?.enumerable
		&& Object.hasOwn(descriptor, 'value')
		&& descriptor.value === 'video-composition/set',
	);
}

/** Snapshot a composition or inherited sequence command for bounded history ownership. */
export function snapshotFramescaperProjectCommandComposition(
	command: FramescaperProjectCommandComposition,
): FramescaperProjectCommandComposition {
	if (isFramescaperVideoCompositionCommandComposition(command)) {
		return normalizeFramescaperProjectCommandComposition(command);
	}
	return snapshotInertEditorCommand(command, 'Framescaper composition command') as FramescaperProjectCommandComposition;
}

/** Replace one timeline or Project Bin video's complete composition by optimistic equality. */
export function applyFramescaperProjectCommandComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectComposition | unknown,
	command: FramescaperProjectCommandComposition,
	options: FramescaperProjectCommandOptionsComposition = {},
): FramescaperProjectComposition {
	assertFramescaperProjectCompositionProfile(profile);
	validateFramescaperProjectComposition(profile, project);
	const persisted = project as FramescaperProjectComposition;
	const normalizedCommand = snapshotFramescaperProjectCommandComposition(command);
	if (!isFramescaperVideoCompositionCommandComposition(normalizedCommand)) {
		assertCurrentVideoClipboardComposition(normalizedCommand);
		const foundation = framescaperProjectSequenceFoundationComposition(profile, persisted, {
			retainComposition: true,
		});
		const commanded = applyFramescaperProjectCommandSequence(
			FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
			foundation,
			normalizedCommand,
			options,
		) as unknown as Record<string, unknown>;
		commanded.schemaVersion =  1;
		normalizeFramescaperProjectClipCompositionsComposition(commanded);
		commanded.featureRequirements = reconcileFramescaperProjectFeatureRequirementsComposition(profile, commanded);
		validateFramescaperProjectComposition(profile, commanded);
		return commanded as FramescaperProjectComposition;
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
		`Framescaper composition video clip ${normalized.clipId}`,
	);
	if (!videoClipCompositionsEqual(currentComposition, normalized.expectedComposition)) {
		throw new RangeError(`Video clip ${normalized.clipId} has a stale expected composition.`);
	}

	const draft = cloneFramescaperProjectComposition(profile, persisted) as unknown as Record<string, unknown>;
	const target = findClip(draft, normalized.clipId);
	target.videoComposition = cloneVideoClipComposition(
		normalized.composition,
		`Framescaper composition video clip ${normalized.clipId}.videoComposition`,
	);
	const revision = persisted.revision + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper composition project revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now, 'composition command');
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsComposition(profile, draft);
	validateFramescaperProjectComposition(profile, draft);
	return draft as FramescaperProjectComposition;
}

function assertClipTrackUnlocked(project: FramescaperProjectComposition, clipId: string): void {
	for (const trackValue of project.tracks) {
		const track = dataRecord(trackValue, 'Framescaper composition track');
		const clipIds = dataProperty(track, 'clipIds', 'Framescaper composition track');
		if (!Array.isArray(clipIds) || !clipIds.includes(clipId)) continue;
		if (dataProperty(track, 'locked', 'Framescaper composition track') === true) {
			throw new RangeError(`Locked track ${String(track.id)} cannot edit video clip ${clipId}.`);
		}
	}
}

function assertCurrentVideoClipboardComposition(command: FramescaperProjectCommandComposition): void {
	const limits = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS;
	const stack: Array<Readonly<{ command: unknown; depth: number }>> = [{ command, depth: 0 }];
	let nodes = 0;
	while (stack.length > 0) {
		const work = stack.pop()!;
		nodes += 1;
		if (nodes > limits.maximumTraversalNodes) {
			throw new RangeError('Framescaper composition clipboard command traversal exceeds its structural limit.');
		}
		if (work.depth > limits.maximumTraversalDepth) {
			throw new RangeError('Framescaper composition clipboard command nesting exceeds its structural limit.');
		}
		const candidate = dataRecord(work.command, 'Framescaper composition inherited command');
		const type = dataProperty(candidate, 'type', 'Framescaper composition inherited command');
		if (type === 'batch') {
			const children = readClosedDomainArray(
				dataProperty(candidate, 'commands', 'Framescaper composition batch command'),
				'Framescaper composition batch command.commands',
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
			dataProperty(candidate, 'clipboard', 'Framescaper composition clipboard paste'),
		);
		if (clipboard.schemaVersion !== 5
			&& clipboard.tracks.some((track) => track.sourceTrackType === 'video')) {
			throw new RangeError('Framescaper composition video clipboard content requires V5 recopy.');
		}
	}
}

function findClip(project: FramescaperProjectComposition | Record<string, unknown>, clipId: string): Record<string, unknown> {
	const candidate = project as Record<string, unknown>;
	const timeline = dataArray(dataProperty(candidate, 'clips', 'Framescaper composition project'), 'project.clips');
	const projectBin = dataRecord(
		dataProperty(candidate, 'projectBin', 'Framescaper composition project'),
		'Framescaper composition project.projectBin',
	);
	const bin = dataArray(
		dataProperty(projectBin, 'clips', 'Framescaper composition project.projectBin'),
		'project.projectBin.clips',
	);
	const found = [...timeline, ...bin].find((clip) => (
		dataProperty(clip, 'id', 'Framescaper composition clip') === clipId
	));
	if (!found) throw new ReferenceError(`Framescaper composition clip ${clipId} is missing.`);
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

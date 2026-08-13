/* SPDX-License-Identifier: AGPL-3.0-only */

import { applyEditorCommand } from '../common/editor/commands.js';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV18,
} from './editor-project-feature-requirements-v18.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	isFramescaperMulticameraCommandV18,
	planFramescaperMulticameraCommandV18,
	type FramescaperMulticameraCommandV18,
} from './editor-project-v18-multicam.ts';
import {
	framescaperProjectV18HasProxyAttachment,
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18-validation.ts';
import {
	assertFramescaperSequenceDeletionV18,
	framescaperSequenceIdV18,
	isFramescaperSequenceCommandV18,
	snapshotFramescaperSequenceV18,
	type FramescaperSequenceCommandV18,
} from './editor-project-v18-sequence.ts';
import {
	isFramescaperSubsequenceCommandV18,
	type FramescaperProjectCommandV18,
	type FramescaperSubsequenceCommandV18,
} from './editor-project-v18-subsequence.ts';

export interface FramescaperProjectCommandOptionsV18 {
	readonly now?: Date | string;
}

/** Execute an existing command on a transient V17 projection, then restore exact V18 authority. */
export function applyFramescaperProjectCommandV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV18 | unknown,
	command: FramescaperProjectCommandV18,
	options: FramescaperProjectCommandOptionsV18 = {},
): FramescaperProjectV18 {
	assertFramescaperProjectV18Profile(profile);
	validateFramescaperProjectV18(profile, project);
	const persisted = project as FramescaperProjectV18;
	if (framescaperProjectV18HasProxyAttachment(persisted)) {
		throw new RangeError('A proxy-attached Framescaper V18 project is intrinsically read-only.');
	}
	if (isFramescaperSequenceCommandV18(command)) {
		return applySequenceCommand(profile, persisted, command, options);
	}
	if (isFramescaperSubsequenceCommandV18(command)) {
		return applySubsequenceCommand(profile, persisted, command, options);
	}
	if (isFramescaperMulticameraCommandV18(command)) {
		return applyMulticameraCommand(profile, persisted, command, options);
	}
	const v17Project = structuredClone(persisted) as unknown as Record<string, unknown>;
	v17Project.schemaVersion = 17;
	for (const source of v17Project.sources as Record<string, unknown>[]) delete source.proxyAttachment;
	const commanded = applyEditorCommand(v17Project, command, options) as unknown as Record<string, unknown>;
	commanded.schemaVersion = 18;
	for (const source of commanded.sources as Record<string, unknown>[]) {
		if (source.kind === 'video') source.proxyAttachment = null;
		else delete source.proxyAttachment;
	}
	commanded.multicameraGroups = structuredClone(persisted.multicameraGroups);
	validateFramescaperProjectV18(profile, commanded);
	return commanded as FramescaperProjectV18;
}

function applySequenceCommand(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV18,
	command: FramescaperSequenceCommandV18,
	options: FramescaperProjectCommandOptionsV18,
): FramescaperProjectV18 {
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const sequences = draft.sequences as Record<string, unknown>[];
	if (command.type === 'sequence/create') {
		const sequence = snapshotFramescaperSequenceV18(command.sequence);
		if (project.sequences.some(({ id }) => id === sequence.id)) {
			throw new RangeError(`Duplicate sequence ID: ${sequence.id}.`);
		}
		sequences.push(structuredClone(sequence));
	} else {
		const sequenceId = framescaperSequenceIdV18(command.sequenceId);
		assertFramescaperSequenceDeletionV18(project, sequenceId);
		const index = sequences.findIndex(({ id }) => id === sequenceId);
		if (index < 0) throw new ReferenceError(`Sequence ${sequenceId} is missing.`);
		sequences.splice(index, 1);
	}
	return finalizeDraft(profile, project, draft, options);
}

function applySubsequenceCommand(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV18,
	command: FramescaperSubsequenceCommandV18,
	options: FramescaperProjectCommandOptionsV18,
): FramescaperProjectV18 {
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const subsequences = (draft.subsequences ??= []) as Record<string, unknown>[];
	if (command.type === 'subsequence/add') {
		subsequences.push(snapshotSubsequence(command.subsequence));
	} else {
		const subsequenceId = commandString(command, 'subsequenceId');
		const index = subsequences.findIndex((value) => value.id === subsequenceId);
		if (index < 0) throw new ReferenceError(`Subsequence ${subsequenceId} is missing.`);
		if (command.type === 'subsequence/remove') subsequences.splice(index, 1);
		else subsequences[index] = {
			...subsequences[index],
			...snapshotChanges(command.changes),
		};
	}
	return finalizeDraft(profile, project, draft, options);
}

function applyMulticameraCommand(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV18,
	command: FramescaperMulticameraCommandV18,
	options: FramescaperProjectCommandOptionsV18,
): FramescaperProjectV18 {
	const plan = planFramescaperMulticameraCommandV18(
		profile,
		project,
		project.multicameraGroups,
		command,
	);
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	draft.multicameraGroups = structuredClone(plan.after);
	return finalizeDraft(profile, project, draft, options);
}

function finalizeDraft(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV18,
	draft: Record<string, unknown>,
	options: FramescaperProjectCommandOptionsV18,
): FramescaperProjectV18 {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V18 project revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV18(profile, draft);
	validateFramescaperProjectV18(profile, draft);
	return draft as FramescaperProjectV18;
}

function snapshotSubsequence(value: unknown): Record<string, unknown> {
	const fields = [
		'id', 'sequenceId', 'sourceSequenceId', 'sequenceStartFrame',
		'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount',
	] as const;
	return snapshotFields(value, fields, 'Framescaper subsequence command');
}

function snapshotChanges(value: unknown): Record<string, unknown> {
	const fields = [
		'sequenceId', 'sourceSequenceId', 'sequenceStartFrame',
		'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount',
	] as const;
	return snapshotFields(value, fields, 'Framescaper subsequence changes', true);
}

function snapshotFields(
	value: unknown,
	fields: readonly string[],
	name: string,
	partial = false,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const record = value as Record<string, unknown>;
	const allowed = new Set(fields);
	for (const key of Reflect.ownKeys(record)) {
		if (typeof key !== 'string' || !allowed.has(key)) throw new TypeError(`${name} has an unsupported field.`);
	}
	const result: Record<string, unknown> = {};
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(record, field);
		if (!descriptor) {
			if (!partial) throw new TypeError(`${name}.${field} is required.`);
			continue;
		}
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property.`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function commandString(value: object, key: string): string {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'string' || descriptor.value.length === 0) {
		throw new TypeError(`Framescaper subsequence command.${key} must be a non-empty own string.`);
	}
	return descriptor.value;
}

function timestamp(value: Date | string | undefined): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid V18 command timestamp is required.');
	return date.toISOString();
}

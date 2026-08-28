/* SPDX-License-Identifier: AGPL-3.0-only */

import { applyEditorCommand } from '../common/editor/commands.js';
import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY } from '../common/editor/project-schema-identity.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import type { AudioEditorProjectV17 } from '../common/editor/project-v17-validation.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsSequence,
} from './editor-project-feature-requirements-sequence.ts';
import { assertFramescaperProjectSequenceProfile } from './editor-domain-runtime-profile.ts';
import {
	isFramescaperMulticameraCommandSequence,
	planFramescaperMulticameraCommandSequence,
	type FramescaperMulticameraCommandSequence,
} from './editor-project-sequence-multicam.ts';
import {
	validateFramescaperProjectSequence,
	type FramescaperProjectSequence,
} from './editor-project-sequence-validation.ts';
import {
	framescaperVideoProxyAttachmentsSequence,
	retainFramescaperVideoProxyAttachmentsSequence,
} from './editor-video-proxy-attachment-retention-sequence.ts';
import {
	assertFramescaperSequenceDeletionSequence,
	framescaperSequenceIdSequence,
	isFramescaperSequenceCommandSequence,
	snapshotFramescaperSequenceSequence,
	type FramescaperSequenceCommandSequence,
} from './editor-project-sequence-sequence.ts';
import {
	isFramescaperSubsequenceCommandSequence,
	type FramescaperProjectCommandSequence,
	type FramescaperSubsequenceCommandSequence,
} from './editor-project-sequence-subsequence.ts';

export interface FramescaperProjectCommandOptionsSequence {
	readonly now?: Date | string;
}

/** Execute an existing command on a transient V17 projection, then restore exact sequence authority. */
export function applyFramescaperProjectCommandSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectSequence | unknown,
	command: FramescaperProjectCommandSequence,
	options: FramescaperProjectCommandOptionsSequence = {},
): FramescaperProjectSequence {
	assertFramescaperProjectSequenceProfile(profile);
	validateFramescaperProjectSequence(profile, project);
	const persisted = project as FramescaperProjectSequence;
	if (isFramescaperSequenceCommandSequence(command)) {
		return applySequenceCommand(profile, persisted, command, options);
	}
	if (isFramescaperSubsequenceCommandSequence(command)) {
		return applySubsequenceCommand(profile, persisted, command, options);
	}
	if (isFramescaperMulticameraCommandSequence(command)) {
		return applyMulticameraCommand(profile, persisted, command, options);
	}
	// The command runs against a V17 projection that has never heard of proxy
	// attachments, so they are lifted out first and carried back afterwards —
	// each one only if the edit left what it claims about its source true.
	const attachments = framescaperVideoProxyAttachmentsSequence(persisted);
	const v17Project = structuredClone(persisted) as unknown as Record<string, unknown>;
	delete v17Project.schemaFamily;
	v17Project.schemaVersion = 17;
	for (const source of v17Project.sources as Record<string, unknown>[]) delete source.proxyAttachment;
	const commanded = applyEditorCommand(
		v17Project as unknown as AudioEditorProjectV17,
		command,
		options,
	) as unknown as Record<string, unknown>;
	commanded.schemaFamily = FRAMESCAPER_PROJECT_SCHEMA_FAMILY;
	commanded.schemaVersion = 1;
	retainFramescaperVideoProxyAttachmentsSequence(commanded, attachments);
	commanded.multicameraGroups = structuredClone(persisted.multicameraGroups);
	commanded.featureRequirements = reconcileFramescaperProjectFeatureRequirementsSequence(profile, commanded);
	validateFramescaperProjectSequence(profile, commanded);
	return commanded as FramescaperProjectSequence;
}

function applySequenceCommand(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectSequence,
	command: FramescaperSequenceCommandSequence,
	options: FramescaperProjectCommandOptionsSequence,
): FramescaperProjectSequence {
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const sequences = draft.sequences as Record<string, unknown>[];
	if (command.type === 'sequence/create') {
		const sequence = snapshotFramescaperSequenceSequence(command.sequence);
		if (project.sequences.some(({ id }) => id === sequence.id)) {
			throw new RangeError(`Duplicate sequence ID: ${sequence.id}.`);
		}
		sequences.push(structuredClone(sequence));
	} else {
		const sequenceId = framescaperSequenceIdSequence(command.sequenceId);
		assertFramescaperSequenceDeletionSequence(project, sequenceId);
		const index = sequences.findIndex(({ id }) => id === sequenceId);
		if (index < 0) throw new ReferenceError(`Sequence ${sequenceId} is missing.`);
		sequences.splice(index, 1);
	}
	return finalizeDraft(profile, project, draft, options);
}

function applySubsequenceCommand(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectSequence,
	command: FramescaperSubsequenceCommandSequence,
	options: FramescaperProjectCommandOptionsSequence,
): FramescaperProjectSequence {
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
	project: FramescaperProjectSequence,
	command: FramescaperMulticameraCommandSequence,
	options: FramescaperProjectCommandOptionsSequence,
): FramescaperProjectSequence {
	const plan = planFramescaperMulticameraCommandSequence(
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
	project: FramescaperProjectSequence,
	draft: Record<string, unknown>,
	options: FramescaperProjectCommandOptionsSequence,
): FramescaperProjectSequence {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper sequence project revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
	// A sequence, subsequence, or multicamera edit clones the sequence document whole,
	// so its attachments arrive intact; they still pass the same test, because a
	// path that ever does reach a source must not be the one that keeps a stale
	// proxy alive.
	retainFramescaperVideoProxyAttachmentsSequence(draft, framescaperVideoProxyAttachmentsSequence(project));
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsSequence(profile, draft);
	validateFramescaperProjectSequence(profile, draft);
	return draft as FramescaperProjectSequence;
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
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid sequence command timestamp is required.');
	return date.toISOString();
}

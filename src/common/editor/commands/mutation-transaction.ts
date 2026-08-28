/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	isFoundationProjectAuthority,
} from '../project-current-runtime.ts';
import {
	brandRuntimeProjectProjection,
	type RuntimeClipProject,
} from '../runtime-clip-projection.ts';
import { isTrackFolderProjectSchema } from '../project-schema-version.ts';
import { pruneMissingProjectSelections } from './shared-runtime.js';
import {
	FOUNDATION_EDIT_OPERATION,
	LEGACY_TRACK_STRUCTURE_EDIT,
} from './command-projection-transients.ts';
import type {
	AudioEditorCommand,
	EditorCommandHandlerRegistry,
	EditorCommandProject,
} from './protocol.ts';
import { dispatchEditorCommand } from './registry.ts';
import { createEditorCommandRuntime } from './runtime-registry.ts';
import { createTrackLockAdmission } from './track-lock-admission.ts';
import { createVideoRetimePreservationAdmission } from './video-retime-preservation-admission.ts';

type DataRecord = Record<PropertyKey, unknown>;

interface CommandAdmission {
	beforeCommand(project: unknown, command: AudioEditorCommand): void;
	afterCommand(project: unknown): void;
	assertPersistedResult(project: unknown): void;
}

export interface EditorCommandMutationTransaction {
	mutate(project: EditorCommandProject, command: AudioEditorCommand): void;
	assertPersistedResult(project: unknown): void;
}

/** Reuse the exhaustive command registry without expanding the public facade. */
export function createEditorCommandMutationTransaction(
	persistedProjectValue: unknown,
	commandProjectValue: unknown,
): Readonly<EditorCommandMutationTransaction> {
	const persistedProject = projectRecord(persistedProjectValue, 'persisted project');
	const commandProject = projectRecord(commandProjectValue, 'command project');
	const admission = createCommandAdmission(persistedProject, commandProject);
	const mutate = createCommandMutator(admission);
	return Object.freeze({
		mutate(projectValue: EditorCommandProject, command: AudioEditorCommand) {
			if (!command || typeof command.type !== 'string') {
				throw new TypeError('A serializable editor command is required.');
			}
			const project = projectRecord(projectValue, 'command draft');
			if (isFoundationProjectAuthority(persistedProject)) {
				brandRuntimeProjectProjection(project as RuntimeClipProject);
			}
			mutate(project, command);
			pruneMissingProjectSelections(project);
		},
		assertPersistedResult: (project: unknown) => admission.assertPersistedResult(project),
	});
}

function createCommandAdmission(
	persistedProject: DataRecord,
	commandProject: DataRecord,
): Readonly<CommandAdmission> {
	const admissions = [
		createTrackLockAdmission(persistedProject, commandProject),
		createVideoRetimePreservationAdmission(persistedProject, commandProject),
	];
	return Object.freeze({
		beforeCommand: (project: unknown, command: AudioEditorCommand) => {
			for (const admission of admissions) admission.beforeCommand(project, command);
		},
		afterCommand: (project: unknown) => {
			for (const admission of admissions) admission.afterCommand(project);
		},
		assertPersistedResult: (project: unknown) => {
			for (const admission of admissions) admission.assertPersistedResult(project);
		},
	});
}

function createCommandMutator(
	admission: Readonly<CommandAdmission>,
): (project: DataRecord, command: AudioEditorCommand) => void {
	const handlers: Readonly<EditorCommandHandlerRegistry> = createEditorCommandRuntime((
		project: EditorCommandProject,
		command: AudioEditorCommand,
	): void => {
		mutateCommand(projectRecord(project, 'command project'), command, handlers, admission);
	});
	return (project, command) => mutateCommand(project, command, handlers, admission);
}

function mutateCommand(
	project: DataRecord,
	command: AudioEditorCommand,
	handlers: Readonly<EditorCommandHandlerRegistry>,
	admission: Readonly<CommandAdmission>,
): void {
	const isChild = command.type !== 'batch';
	if (isChild) admission.beforeCommand(project, command);
	if (isTrackFolderProjectSchema(project)
		&& (command.type === 'track/add' || command.type === 'track/remove' || command.type === 'track/reorder')
		&& !(Array.isArray(project.trackFolders) && project.trackFolders.length > 0)) {
		project[LEGACY_TRACK_STRUCTURE_EDIT] = true;
	}
	if (isFoundationProjectAuthority(project) && isChild) {
		const clips = recordArray(project.clips, 'project.clips');
		const before = new Map(clips.map((clip) => [clip.id, commandTimingSignature(clip)]));
		dispatchEditorCommand(handlers, project, command);
		const operation = {};
		for (const clip of recordArray(project.clips, 'project.clips')) {
			const previous = before.get(clip.id);
			if (previous != null && previous !== commandTimingSignature(clip)) {
				clip[FOUNDATION_EDIT_OPERATION] = operation;
			}
		}
		admission.afterCommand(project);
		return;
	}
	dispatchEditorCommand(handlers, project, command);
	if (isChild) admission.afterCommand(project);
}

function commandTimingSignature(clip: DataRecord): string {
	return [
		clip.timelineStartFrame,
		clip.durationFrames,
		clip.sourceStartFrame,
		clip.sourceDurationFrames,
	].map((value) => `${typeof value}:${String(value)}`).join('|');
}

function projectRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => projectRecord(candidate, `${name}[${String(index)}]`));
}

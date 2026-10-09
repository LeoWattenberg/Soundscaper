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
import { createEditorCommandRuntime, createEditorCommandRuntimeV2 } from './runtime-registry.ts';
import { createTrackLockAdmission } from './track-lock-admission.ts';
import { createVideoRetimePreservationAdmission } from './video-retime-preservation-admission.ts';
import { brandFrameResourceCommandProjectV2 } from './frame-resource-command-carriers-v2.ts';
import { pasteClipboardV7 } from './clipboard-runtime-v7.ts';
import { isCurrentClipboardPasteCommandV2, type CurrentAudioEditorMutationCommandV2 } from './clipboard-command-v2.ts';

type DataRecord = Record<PropertyKey, unknown>;

interface CommandAdmission {
	beforeCommand(project: unknown, command: CurrentAudioEditorMutationCommandV2): void;
	afterCommand(project: unknown): void;
	assertPersistedResult(project: unknown): void;
}

export interface EditorCommandMutationTransaction {
	mutate(project: EditorCommandProject, command: AudioEditorCommand): void;
	assertPersistedResult(project: unknown): void;
}
export interface EditorCommandMutationTransactionV2 {
	mutate(project: EditorCommandProject, command: CurrentAudioEditorMutationCommandV2): void;
	assertPersistedResult(project: unknown): void;
}

/** Reuse the exhaustive command registry without expanding the public facade. */
export function createEditorCommandMutationTransaction(
	persistedProjectValue: unknown,
	commandProjectValue: unknown,
): Readonly<EditorCommandMutationTransaction> {
	return createTransaction(persistedProjectValue, commandProjectValue, false);
}
export function createEditorCommandMutationTransactionForFrameV2(persistedProjectValue: unknown,
	commandProjectValue: unknown): Readonly<EditorCommandMutationTransactionV2> {
	return createTransaction(persistedProjectValue, commandProjectValue, true);
}
function createTransaction(persistedProjectValue: unknown, commandProjectValue: unknown, resourceV2: boolean): Readonly<EditorCommandMutationTransactionV2> {
	const persistedProject = projectRecord(persistedProjectValue, 'persisted project');
	const commandProject = projectRecord(commandProjectValue, 'command project');
	const admission = createCommandAdmission(persistedProject, commandProject);
	const mutate = createCommandMutator(admission, resourceV2);
	return Object.freeze({
		mutate(projectValue: EditorCommandProject, command: CurrentAudioEditorMutationCommandV2) {
			if (!command || typeof command.type !== 'string') {
				throw new TypeError('A serializable editor command is required.');
			}
			const project = projectRecord(projectValue, 'command draft');
			if (resourceV2) brandFrameResourceCommandProjectV2(project);
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
		beforeCommand: (project: unknown, command: CurrentAudioEditorMutationCommandV2) => {
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
	admission: Readonly<CommandAdmission>, resourceV2: boolean,
): (project: DataRecord, command: CurrentAudioEditorMutationCommandV2) => void {
	const handlers: Readonly<EditorCommandHandlerRegistry> = (resourceV2 ? createEditorCommandRuntimeV2 : createEditorCommandRuntime)((
		project: EditorCommandProject,
		command: AudioEditorCommand,
	): void => {
		mutateCommand(projectRecord(project, 'command project'), command, handlers, admission, resourceV2);
	});
	return (project, command) => mutateCommand(project, command, handlers, admission, resourceV2);
}

function mutateCommand(
	project: DataRecord,
	command: CurrentAudioEditorMutationCommandV2,
	handlers: Readonly<EditorCommandHandlerRegistry>,
	admission: Readonly<CommandAdmission>,
	resourceV2: boolean,
): void {
	if (resourceV2 && command.type === 'batch') {
		for (const child of command.commands) mutateCommand(project, child, handlers, admission, true);
		return;
	}
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
		dispatchMutationCommand(handlers, project, command, resourceV2);
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
	dispatchMutationCommand(handlers, project, command, resourceV2);
	if (isChild) admission.afterCommand(project);
}

function dispatchMutationCommand(handlers: Readonly<EditorCommandHandlerRegistry>, project: DataRecord,
	command: CurrentAudioEditorMutationCommandV2, resourceV2: boolean): void {
	if (isCurrentClipboardPasteCommandV2(command)) {
		if (!resourceV2) throw new TypeError('Resource clipboard V7 requires the current Frame mutation owner.');
		pasteClipboardV7(project, command);
		return;
	}
	// The named descriptor7 branch above owns the only added clipboard shape.
	// Every remaining leaf goes through the unchanged exhaustive legacy registry.
	dispatchEditorCommand(handlers, project, command as AudioEditorCommand);
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

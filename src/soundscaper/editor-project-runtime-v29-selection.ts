/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard, AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import type {
	ControllerProjectRuntime,
	ControllerRuntimeHistory,
	ControllerRuntimeProject,
	ControllerTrackDuplicateRequest,
} from '../common/editor/controller/project-runtime.ts';
import { acquireProjectLock } from '../common/editor/project-lock.js';
import { resolveRuntimeProjectProjection } from '../common/editor/runtime-clip-projection.ts';
import { createAudioEditorSessionController } from '../common/editor/session.js';
import { createAudioEditorSessionClipboard } from '../common/editor/session-clipboard-codec.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	applySoundscaperProjectCommandV29,
	soundscaperProjectForCommandConsumersV29,
} from './editor-project-v29-commands.ts';
import {
	createSoundscaperProjectHistoryV29,
	executeSoundscaperProjectCommandV29,
	redoSoundscaperProjectCommandV29,
	undoSoundscaperProjectCommandV29,
	validateSoundscaperProjectHistoryV29,
	type SoundscaperProjectHistoryV29,
} from './editor-project-v29-history.ts';
import {
	cloneSoundscaperProjectV29,
	createSoundscaperProjectV29,
	loadSoundscaperProjectV29,
	SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
	type SoundscaperProjectV29,
	type SoundscaperProjectV29Options,
} from './editor-project-v29.ts';
import {
	SOUNDSCAPER_V29_PROJECT_STORAGE_PROFILE,
} from './editor-project-storage-profile-v29.ts';
import { SOUNDSCAPER_V29_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v29.ts';
import { createSoundscaperProjectStoreV29 } from './editor-project-store-v29.ts';
import { validateSoundscaperProjectV29 } from './editor-project-v29-validation.ts';
import {
	prepareCurrentSoundscaperTrackDuplicateCarrierV8,
} from './editor-session-clipboard-v8.ts';

export interface SoundscaperProjectRuntimeV29Selection {
	readonly runtimeProfile: typeof SOUNDSCAPER_V29_PROJECT_RUNTIME_PROFILE;
	readonly storageProfile: typeof SOUNDSCAPER_V29_PROJECT_STORAGE_PROFILE;
	readonly createProject: (options?: SoundscaperProjectV29Options) => SoundscaperProjectV29 & ControllerRuntimeProject;
	readonly cloneProject: (project: unknown) => SoundscaperProjectV29 & ControllerRuntimeProject;
	readonly validateProject: (project: unknown) => project is SoundscaperProjectV29;
	readonly migrateProject: (project: unknown) => Readonly<{
		readonly project: SoundscaperProjectV29 | Readonly<Record<string, unknown>>;
		readonly readOnly: boolean;
		readonly intrinsicReadOnly: boolean;
		readonly reason: 'newer-schema' | null;
		readonly migrated: boolean;
		readonly fromVersion: number;
	}>;
	readonly createHistory: (project: unknown) => SoundscaperProjectHistoryV29 & ControllerRuntimeHistory;
	readonly createSessionController: () => ReturnType<typeof createAudioEditorSessionController>;
	readonly createProjectStore: (options?: AudioEditorProjectStoreOptions) => AudioEditorProjectStore;
	readonly acquireProjectLock: typeof acquireProjectLock;
	readonly projectForCommandConsumers: ControllerProjectRuntime['projectForCommandConsumers'];
	readonly projectForRuntimeConsumers: ControllerProjectRuntime['projectForRuntimeConsumers'];
	readonly prepareEditClipboardDescriptor: ControllerProjectRuntime['prepareEditClipboardDescriptor'];
	readonly prepareTrackDuplicateCarrier: ControllerProjectRuntime['prepareTrackDuplicateCarrier'];
	readonly applyCommand: ControllerProjectRuntime['applyCommand'];
	readonly executeCommand: ControllerProjectRuntime['executeCommand'];
	readonly undo: ControllerProjectRuntime['undo'];
	readonly redo: ControllerProjectRuntime['redo'];
	readonly canUndo: ControllerProjectRuntime['canUndo'];
	readonly canRedo: ControllerProjectRuntime['canRedo'];
}

/** Select exact V29 document, command, history, session, and storage authority. */
export function createSoundscaperProjectRuntimeV29Selection(): Readonly<SoundscaperProjectRuntimeV29Selection> {
	const selection = {
		runtimeProfile: SOUNDSCAPER_V29_PROJECT_RUNTIME_PROFILE,
		storageProfile: SOUNDSCAPER_V29_PROJECT_STORAGE_PROFILE,
		createProject: (options: SoundscaperProjectV29Options = {}) => (
			createSoundscaperProjectV29(options) as SoundscaperProjectV29 & ControllerRuntimeProject
		),
		cloneProject: (project: unknown) => (
			cloneSoundscaperProjectV29(project) as SoundscaperProjectV29 & ControllerRuntimeProject
		),
		validateProject: (project: unknown): project is SoundscaperProjectV29 => (
			validateSoundscaperProjectV29(project)
		),
		migrateProject: (project: unknown) => {
			const fromVersion = readSchemaVersion(project);
			return Object.freeze({
				...loadSoundscaperProjectV29(project),
				migrated: fromVersion !== SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
				fromVersion,
			});
		},
		projectForCommandConsumers: (project: unknown) => (
			soundscaperProjectForCommandConsumersV29(project) as ControllerRuntimeProject
		),
		projectForRuntimeConsumers: (project: unknown) => {
			validateSoundscaperProjectV29(project);
			return resolveRuntimeProjectProjection(
				project as SoundscaperProjectV29,
			) as unknown as ControllerRuntimeProject;
		},
		prepareEditClipboardDescriptor: (project: unknown, descriptor: AudioEditorClipboard) => (
			createAudioEditorSessionClipboard(
				soundscaperProjectForCommandConsumersV29(project),
				{ descriptor },
			).descriptor
		),
		prepareTrackDuplicateCarrier: (project: unknown, request: ControllerTrackDuplicateRequest) => (
			prepareCurrentSoundscaperTrackDuplicateCarrierV8(project, request)
		),
		createHistory: (project: unknown) => (
			createSoundscaperProjectHistoryV29(project) as SoundscaperProjectHistoryV29 & ControllerRuntimeHistory
		),
		applyCommand: (project: unknown, command: AudioEditorCommand, options = {}) => (
			applySoundscaperProjectCommandV29(project, command, options) as SoundscaperProjectV29 & ControllerRuntimeProject
		),
		executeCommand: (
			history: SoundscaperProjectHistoryV29,
			command: AudioEditorCommand,
			options = {},
		) => executeSoundscaperProjectCommandV29(history, command, options) as SoundscaperProjectHistoryV29 & ControllerRuntimeHistory,
		undo: (history: SoundscaperProjectHistoryV29, options = {}) => (
			undoSoundscaperProjectCommandV29(history, options) as SoundscaperProjectHistoryV29 & ControllerRuntimeHistory
		),
		redo: (history: SoundscaperProjectHistoryV29, options = {}) => (
			redoSoundscaperProjectCommandV29(history, options) as SoundscaperProjectHistoryV29 & ControllerRuntimeHistory
		),
		canUndo: (history: ControllerRuntimeHistory) => history.undoStack.length > 0,
		canRedo: (history: ControllerRuntimeHistory) => history.redoStack.length > 0,
		createSessionController: () => createSelectedSession(),
		createProjectStore: (options: AudioEditorProjectStoreOptions = {}) => (
			createSoundscaperProjectStoreV29(options)
		),
		acquireProjectLock: (projectId: string, options: Record<string, unknown> = {}) => acquireProjectLock(
			projectId,
			profiledLockOptions(options),
		),
	};
	return Object.freeze(selection) as unknown as Readonly<SoundscaperProjectRuntimeV29Selection>;
}

function createSelectedSession(): ReturnType<typeof createAudioEditorSessionController> {
	const delegate = createAudioEditorSessionController({
		currentSchemaVersion: SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
	});
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = loadSoundscaperProjectV29(project);
			return delegate.openProject(loaded.project, {
				...openOptions,
				readOnly: Boolean(openOptions.readOnly || loaded.intrinsicReadOnly),
				readOnlyReason: openOptions.readOnlyReason ?? loaded.reason,
			});
		},
		updateProject(projectId: string, update: unknown, updateOptions: Record<string, unknown> = {}) {
			return delegate.updateProject(projectId, (previous: unknown) => {
				const candidate = typeof update === 'function'
					? (update as (project: unknown) => unknown)(previous)
					: update;
				return cloneSoundscaperProjectV29(candidate);
			}, updateOptions);
		},
		updateProjectHistory(
			projectId: string,
			history: SoundscaperProjectHistoryV29,
			updateOptions: Record<string, unknown> = {},
		) {
			validateSoundscaperProjectHistoryV29(history);
			return delegate.updateProjectHistory(projectId, history, updateOptions);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper V29 project lock options must be a record.');
	}
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) {
		throw new TypeError('The selected V29 lock profile rejects authority overrides.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => key !== 'force')) {
		throw new TypeError('The selected V29 lock accepts only a force flag.');
	}
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The selected V29 lock force flag must be an own boolean data property.');
	}
	return {
		...(force ? { force: force.value } : {}),
		projectStorageProfile: SOUNDSCAPER_V29_PROJECT_STORAGE_PROFILE,
	};
}

function readSchemaVersion(value: unknown): number {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A Soundscaper project is required.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
		|| !Number.isSafeInteger(descriptor.value)) {
		throw new RangeError('Soundscaper project schemaVersion must be an own safe integer.');
	}
	return Number(descriptor.value);
}

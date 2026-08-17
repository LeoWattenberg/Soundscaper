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
	applySoundscaperProjectCommandV23,
	soundscaperProjectForCommandConsumersV23,
} from './editor-project-v23-commands.ts';
import {
	createSoundscaperProjectHistoryV23,
	executeSoundscaperProjectCommandV23,
	redoSoundscaperProjectCommandV23,
	undoSoundscaperProjectCommandV23,
	validateSoundscaperProjectHistoryV23,
	type SoundscaperProjectHistoryV23,
} from './editor-project-v23-history.ts';
import {
	cloneSoundscaperProjectV23,
	createSoundscaperProjectV23,
	loadSoundscaperProjectV23,
	SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
	type SoundscaperProjectV23,
	type SoundscaperProjectV23Options,
} from './editor-project-v23.ts';
import {
	SOUNDSCAPER_V23_PROJECT_STORAGE_PROFILE,
} from './editor-project-storage-profile-v23.ts';
import { SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v23.ts';
import { createSoundscaperProjectStoreV23 } from './editor-project-store-v23.ts';
import { validateSoundscaperProjectV23 } from './editor-project-v23-validation.ts';
import {
	prepareCurrentSoundscaperTrackDuplicateCarrierV7,
} from './editor-session-clipboard-v7.ts';

export interface SoundscaperProjectRuntimeV23Selection {
	readonly runtimeProfile: typeof SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE;
	readonly storageProfile: typeof SOUNDSCAPER_V23_PROJECT_STORAGE_PROFILE;
	readonly createProject: (options?: SoundscaperProjectV23Options) => SoundscaperProjectV23 & ControllerRuntimeProject;
	readonly cloneProject: (project: unknown) => SoundscaperProjectV23 & ControllerRuntimeProject;
	readonly validateProject: (project: unknown) => project is SoundscaperProjectV23;
	readonly migrateProject: (project: unknown) => Readonly<{
		readonly project: SoundscaperProjectV23 | Readonly<Record<string, unknown>>;
		readonly readOnly: boolean;
		readonly intrinsicReadOnly: boolean;
		readonly reason: 'newer-schema' | null;
		readonly migrated: false;
		readonly fromVersion: number;
	}>;
	readonly createHistory: (project: unknown) => SoundscaperProjectHistoryV23 & ControllerRuntimeHistory;
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

/** Select exact V23 document, command, history, session, and storage authority. */
export function createSoundscaperProjectRuntimeV23Selection(): Readonly<SoundscaperProjectRuntimeV23Selection> {
	const selection = {
		runtimeProfile: SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		storageProfile: SOUNDSCAPER_V23_PROJECT_STORAGE_PROFILE,
		createProject: (options: SoundscaperProjectV23Options = {}) => (
			createSoundscaperProjectV23(options) as SoundscaperProjectV23 & ControllerRuntimeProject
		),
		cloneProject: (project: unknown) => (
			cloneSoundscaperProjectV23(project) as SoundscaperProjectV23 & ControllerRuntimeProject
		),
		validateProject: (project: unknown): project is SoundscaperProjectV23 => (
			validateSoundscaperProjectV23(project)
		),
		migrateProject: (project: unknown) => {
			const fromVersion = readSchemaVersion(project);
			return Object.freeze({ ...loadSoundscaperProjectV23(project), migrated: false as const, fromVersion });
		},
		projectForCommandConsumers: (project: unknown) => (
			soundscaperProjectForCommandConsumersV23(project) as ControllerRuntimeProject
		),
		projectForRuntimeConsumers: (project: unknown) => {
			validateSoundscaperProjectV23(project);
			return resolveRuntimeProjectProjection(
				project as SoundscaperProjectV23,
			) as unknown as ControllerRuntimeProject;
		},
		prepareEditClipboardDescriptor: (project: unknown, descriptor: AudioEditorClipboard) => (
			createAudioEditorSessionClipboard(
				soundscaperProjectForCommandConsumersV23(project),
				{ descriptor },
			).descriptor
		),
		prepareTrackDuplicateCarrier: (project: unknown, request: ControllerTrackDuplicateRequest) => (
			prepareCurrentSoundscaperTrackDuplicateCarrierV7(project, request)
		),
		createHistory: (project: unknown) => (
			createSoundscaperProjectHistoryV23(project) as SoundscaperProjectHistoryV23 & ControllerRuntimeHistory
		),
		applyCommand: (project: unknown, command: AudioEditorCommand, options = {}) => (
			applySoundscaperProjectCommandV23(project, command, options) as SoundscaperProjectV23 & ControllerRuntimeProject
		),
		executeCommand: (
			history: SoundscaperProjectHistoryV23,
			command: AudioEditorCommand,
			options = {},
		) => executeSoundscaperProjectCommandV23(history, command, options) as SoundscaperProjectHistoryV23 & ControllerRuntimeHistory,
		undo: (history: SoundscaperProjectHistoryV23, options = {}) => (
			undoSoundscaperProjectCommandV23(history, options) as SoundscaperProjectHistoryV23 & ControllerRuntimeHistory
		),
		redo: (history: SoundscaperProjectHistoryV23, options = {}) => (
			redoSoundscaperProjectCommandV23(history, options) as SoundscaperProjectHistoryV23 & ControllerRuntimeHistory
		),
		canUndo: (history: ControllerRuntimeHistory) => history.undoStack.length > 0,
		canRedo: (history: ControllerRuntimeHistory) => history.redoStack.length > 0,
		createSessionController: () => createSelectedSession(),
		createProjectStore: (options: AudioEditorProjectStoreOptions = {}) => (
			createSoundscaperProjectStoreV23(options)
		),
		acquireProjectLock: (projectId: string, options: Record<string, unknown> = {}) => acquireProjectLock(
			projectId,
			profiledLockOptions(options),
		),
	};
	return Object.freeze(selection) as unknown as Readonly<SoundscaperProjectRuntimeV23Selection>;
}

function createSelectedSession(): ReturnType<typeof createAudioEditorSessionController> {
	const delegate = createAudioEditorSessionController({
		currentSchemaVersion: SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
	});
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = loadSoundscaperProjectV23(project);
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
				return cloneSoundscaperProjectV23(candidate);
			}, updateOptions);
		},
		updateProjectHistory(
			projectId: string,
			history: SoundscaperProjectHistoryV23,
			updateOptions: Record<string, unknown> = {},
		) {
			validateSoundscaperProjectHistoryV23(history);
			return delegate.updateProjectHistory(projectId, history, updateOptions);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper V23 project lock options must be a record.');
	}
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) {
		throw new TypeError('The selected V23 lock profile rejects authority overrides.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => key !== 'force')) {
		throw new TypeError('The selected V23 lock accepts only a force flag.');
	}
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The selected V23 lock force flag must be an own boolean data property.');
	}
	return {
		...(force ? { force: force.value } : {}),
		projectStorageProfile: SOUNDSCAPER_V23_PROJECT_STORAGE_PROFILE,
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

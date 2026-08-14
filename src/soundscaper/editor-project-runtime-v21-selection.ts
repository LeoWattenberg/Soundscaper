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
	applySoundscaperProjectCommandV21,
	soundscaperProjectForCommandConsumersV21,
} from './editor-project-v21-commands.ts';
import {
	createSoundscaperProjectHistoryV21,
	executeSoundscaperProjectCommandV21,
	redoSoundscaperProjectCommandV21,
	undoSoundscaperProjectCommandV21,
	validateSoundscaperProjectHistoryV21,
	type SoundscaperProjectHistoryV21,
} from './editor-project-v21-history.ts';
import {
	cloneSoundscaperProjectV21,
	createSoundscaperProjectV21,
	loadSoundscaperProjectV21,
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	type SoundscaperProjectV21,
	type SoundscaperProjectV21Options,
} from './editor-project-v21.ts';
import {
	SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE,
} from './editor-project-storage-profile-v21.ts';
import { SOUNDSCAPER_V21_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v21.ts';
import { createSoundscaperProjectStoreV21 } from './editor-project-store-v21.ts';
import { validateSoundscaperProjectV21 } from './editor-project-v21-validation.ts';
import {
	prepareCurrentSoundscaperTrackDuplicateCarrierV7,
} from './editor-session-clipboard-v7.ts';

export interface SoundscaperProjectRuntimeV21Selection {
	readonly runtimeProfile: typeof SOUNDSCAPER_V21_PROJECT_RUNTIME_PROFILE;
	readonly storageProfile: typeof SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE;
	readonly createProject: (options?: SoundscaperProjectV21Options) => SoundscaperProjectV21 & ControllerRuntimeProject;
	readonly cloneProject: (project: unknown) => SoundscaperProjectV21 & ControllerRuntimeProject;
	readonly validateProject: (project: unknown) => project is SoundscaperProjectV21;
	readonly migrateProject: (project: unknown) => Readonly<{
		readonly project: SoundscaperProjectV21 | Readonly<Record<string, unknown>>;
		readonly readOnly: boolean;
		readonly intrinsicReadOnly: boolean;
		readonly reason: 'newer-schema' | null;
		readonly migrated: false;
		readonly fromVersion: number;
	}>;
	readonly createHistory: (project: unknown) => SoundscaperProjectHistoryV21 & ControllerRuntimeHistory;
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

/** Select exact V21 document, command, history, session, and storage authority. */
export function createSoundscaperProjectRuntimeV21Selection(): Readonly<SoundscaperProjectRuntimeV21Selection> {
	const selection = {
		runtimeProfile: SOUNDSCAPER_V21_PROJECT_RUNTIME_PROFILE,
		storageProfile: SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE,
		createProject: (options: SoundscaperProjectV21Options = {}) => (
			createSoundscaperProjectV21(options) as SoundscaperProjectV21 & ControllerRuntimeProject
		),
		cloneProject: (project: unknown) => (
			cloneSoundscaperProjectV21(project) as SoundscaperProjectV21 & ControllerRuntimeProject
		),
		validateProject: (project: unknown): project is SoundscaperProjectV21 => (
			validateSoundscaperProjectV21(project)
		),
		migrateProject: (project: unknown) => {
			const fromVersion = readSchemaVersion(project);
			return Object.freeze({ ...loadSoundscaperProjectV21(project), migrated: false as const, fromVersion });
		},
		projectForCommandConsumers: (project: unknown) => (
			soundscaperProjectForCommandConsumersV21(project) as ControllerRuntimeProject
		),
		projectForRuntimeConsumers: (project: unknown) => {
			validateSoundscaperProjectV21(project);
			return resolveRuntimeProjectProjection(
				project as SoundscaperProjectV21,
			) as unknown as ControllerRuntimeProject;
		},
		prepareEditClipboardDescriptor: (project: unknown, descriptor: AudioEditorClipboard) => (
			createAudioEditorSessionClipboard(
				soundscaperProjectForCommandConsumersV21(project),
				{ descriptor },
			).descriptor
		),
		prepareTrackDuplicateCarrier: (project: unknown, request: ControllerTrackDuplicateRequest) => (
			prepareCurrentSoundscaperTrackDuplicateCarrierV7(project, request)
		),
		createHistory: (project: unknown) => (
			createSoundscaperProjectHistoryV21(project) as SoundscaperProjectHistoryV21 & ControllerRuntimeHistory
		),
		applyCommand: (project: unknown, command: AudioEditorCommand, options = {}) => (
			applySoundscaperProjectCommandV21(project, command, options) as SoundscaperProjectV21 & ControllerRuntimeProject
		),
		executeCommand: (
			history: SoundscaperProjectHistoryV21,
			command: AudioEditorCommand,
			options = {},
		) => executeSoundscaperProjectCommandV21(history, command, options) as SoundscaperProjectHistoryV21 & ControllerRuntimeHistory,
		undo: (history: SoundscaperProjectHistoryV21, options = {}) => (
			undoSoundscaperProjectCommandV21(history, options) as SoundscaperProjectHistoryV21 & ControllerRuntimeHistory
		),
		redo: (history: SoundscaperProjectHistoryV21, options = {}) => (
			redoSoundscaperProjectCommandV21(history, options) as SoundscaperProjectHistoryV21 & ControllerRuntimeHistory
		),
		canUndo: (history: ControllerRuntimeHistory) => history.undoStack.length > 0,
		canRedo: (history: ControllerRuntimeHistory) => history.redoStack.length > 0,
		createSessionController: () => createSelectedSession(),
		createProjectStore: (options: AudioEditorProjectStoreOptions = {}) => (
			createSoundscaperProjectStoreV21(options)
		),
		acquireProjectLock: (projectId: string, options: Record<string, unknown> = {}) => acquireProjectLock(
			projectId,
			profiledLockOptions(options),
		),
	};
	return Object.freeze(selection) as unknown as Readonly<SoundscaperProjectRuntimeV21Selection>;
}

function createSelectedSession(): ReturnType<typeof createAudioEditorSessionController> {
	const delegate = createAudioEditorSessionController({
		currentSchemaVersion: SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	});
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = loadSoundscaperProjectV21(project);
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
				return cloneSoundscaperProjectV21(candidate);
			}, updateOptions);
		},
		updateProjectHistory(
			projectId: string,
			history: SoundscaperProjectHistoryV21,
			updateOptions: Record<string, unknown> = {},
		) {
			validateSoundscaperProjectHistoryV21(history);
			return delegate.updateProjectHistory(projectId, history, updateOptions);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper V21 project lock options must be a record.');
	}
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) {
		throw new TypeError('The selected V21 lock profile rejects authority overrides.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => key !== 'force')) {
		throw new TypeError('The selected V21 lock accepts only a force flag.');
	}
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The selected V21 lock force flag must be an own boolean data property.');
	}
	return {
		...(force ? { force: force.value } : {}),
		projectStorageProfile: SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE,
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

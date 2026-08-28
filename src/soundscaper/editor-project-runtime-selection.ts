/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard } from '../common/editor/commands/protocol.ts';
import type {
	ControllerProjectRuntime,
	ControllerRuntimeHistory,
	ControllerRuntimeProject,
	ControllerTrackDuplicateRequest,
} from '../common/editor/controller/project-runtime.ts';
import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import { acquireProjectLock } from '../common/editor/project-lock.js';
import {
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	isCurrentProjectSchemaIdentity,
} from '../common/editor/project-schema-identity.ts';
import { resolveRuntimeProjectProjection } from '../common/editor/runtime-clip-projection.ts';
import { createAudioEditorSessionController } from '../common/editor/session.js';
import { createAudioEditorSessionClipboard } from '../common/editor/session-clipboard-codec.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	applySoundscaperProjectCommand,
	soundscaperProjectForCommandConsumers,
	type SoundscaperProjectCommand,
} from './editor-project-commands.ts';
import {
	createSoundscaperOpaqueCustodyConsumerProject,
	type SoundscaperOpaqueCustodyConsumerProject,
} from './editor-project-opaque-custody.ts';
import {
	createSoundscaperProjectHistory,
	executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand,
	undoSoundscaperProjectCommand,
	validateSoundscaperProjectHistory,
	type SoundscaperProjectHistory,
} from './editor-project-history.ts';
import {
	cloneSoundscaperProject,
	createSoundscaperProject,
	loadSoundscaperProject,
	PROJECT_SCHEMA_VERSION,
	type SoundscaperProject,
	type SoundscaperProjectOptions,
} from './editor-project.ts';
import {
	SOUNDSCAPER_PROJECT_STORAGE_PROFILE,
} from './editor-project-storage-profile.ts';
import { SOUNDSCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { createSoundscaperProjectStore } from './editor-project-store.ts';
import { validateSoundscaperProject } from './editor-project-validation.ts';
import {
	prepareCurrentSoundscaperTrackDuplicateCarrierV8,
} from './editor-session-clipboard.ts';

interface SoundscaperOpaqueCustodyHistory {
	readonly limit: number;
	readonly present: SoundscaperOpaqueCustodyConsumerProject;
	readonly undoStack: readonly never[];
	readonly redoStack: readonly never[];
}

type SoundscaperProjectHistorySelection =
	| SoundscaperProjectHistory
	| SoundscaperOpaqueCustodyHistory;

export interface SoundscaperProjectRuntimeSelection {
	readonly assistanceAssetCommands: true;
	readonly runtimeProfile: typeof SOUNDSCAPER_PROJECT_RUNTIME_PROFILE;
	readonly storageProfile: typeof SOUNDSCAPER_PROJECT_STORAGE_PROFILE;
	readonly createProject: (options?: SoundscaperProjectOptions) => SoundscaperProject & ControllerRuntimeProject;
	readonly cloneProject: (project: unknown) => SoundscaperProject & ControllerRuntimeProject;
	readonly validateProject: (project: unknown) => project is SoundscaperProject;
	readonly loadProject: (project: unknown) => Readonly<{
		readonly project: SoundscaperProject | Readonly<Record<string, unknown>>;
		readonly readOnly: boolean;
		readonly intrinsicReadOnly: boolean;
		readonly reason: 'foreign-family' | 'newer-schema' | null;
	}>;
	readonly createHistory: (project: unknown) => SoundscaperProjectHistorySelection & ControllerRuntimeHistory;
	readonly createSessionController: () => ReturnType<typeof createAudioEditorSessionController>;
	readonly createProjectStore: (options?: AudioEditorProjectStoreOptions) => AudioEditorProjectStore;
	readonly acquireProjectLock: typeof acquireProjectLock;
	readonly projectForCommandConsumers: ControllerProjectRuntime['projectForCommandConsumers'];
	readonly projectForRuntimeConsumers: ControllerProjectRuntime['projectForRuntimeConsumers'];
	readonly prepareEditClipboardDescriptor: ControllerProjectRuntime['prepareEditClipboardDescriptor'];
	readonly prepareTrackDuplicateCarrier: ControllerProjectRuntime['prepareTrackDuplicateCarrier'];
	readonly applyCommand: (
		project: unknown,
		command: SoundscaperProjectCommand,
		options?: Readonly<{ now?: Date | string }>,
	) => SoundscaperProject & ControllerRuntimeProject;
	readonly executeCommand: (
		history: SoundscaperProjectHistorySelection,
		command: SoundscaperProjectCommand,
		options?: Readonly<{ now?: Date | string }>,
	) => SoundscaperProjectHistory & ControllerRuntimeHistory;
	readonly undo: ControllerProjectRuntime['undo'];
	readonly redo: ControllerProjectRuntime['redo'];
	readonly canUndo: ControllerProjectRuntime['canUndo'];
	readonly canRedo: ControllerProjectRuntime['canRedo'];
}

/** Select baseline document, command, history, session, and storage authority. */
export function createSoundscaperProjectRuntimeSelection(): Readonly<SoundscaperProjectRuntimeSelection> {
	const selection = {
		assistanceAssetCommands: true as const,
		runtimeProfile: SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
		storageProfile: SOUNDSCAPER_PROJECT_STORAGE_PROFILE,
		createProject: (options: SoundscaperProjectOptions = {}) => (
			createSoundscaperProject(options) as SoundscaperProject & ControllerRuntimeProject
		),
		cloneProject: (project: unknown) => (
			cloneSoundscaperProject(project) as SoundscaperProject & ControllerRuntimeProject
		),
		validateProject: (project: unknown): project is SoundscaperProject => (
			validateSoundscaperProject(project)
		),
		loadProject: (project: unknown) => Object.freeze(loadSoundscaperProject(project)),
		projectForCommandConsumers: (project: unknown) => projectForConsumers(project, 'command'),
		projectForRuntimeConsumers: (project: unknown) => projectForConsumers(project, 'runtime'),
		prepareEditClipboardDescriptor: (project: unknown, descriptor: AudioEditorClipboard) => (
			createAudioEditorSessionClipboard(
				soundscaperProjectForCommandConsumers(project),
				{ descriptor },
			).descriptor
		),
		prepareTrackDuplicateCarrier: (project: unknown, request: ControllerTrackDuplicateRequest) => (
			prepareCurrentSoundscaperTrackDuplicateCarrierV8(project, request)
		),
		createHistory: (project: unknown) => createHistory(project),
		applyCommand: (project: unknown, command: SoundscaperProjectCommand, options = {}) => (
			applySoundscaperProjectCommand(project, command, options) as SoundscaperProject & ControllerRuntimeProject
		),
		executeCommand: (
			history: SoundscaperProjectHistorySelection,
			command: SoundscaperProjectCommand,
			options = {},
		) => executeSoundscaperProjectCommand(
			writableHistory(history), command, options,
		) as SoundscaperProjectHistory & ControllerRuntimeHistory,
		undo: (history: SoundscaperProjectHistorySelection, options = {}) => (
			undoSoundscaperProjectCommand(
				writableHistory(history), options,
			) as SoundscaperProjectHistory & ControllerRuntimeHistory
		),
		redo: (history: SoundscaperProjectHistorySelection, options = {}) => (
			redoSoundscaperProjectCommand(
				writableHistory(history), options,
			) as SoundscaperProjectHistory & ControllerRuntimeHistory
		),
		canUndo: (history: ControllerRuntimeHistory) => history.undoStack.length > 0,
		canRedo: (history: ControllerRuntimeHistory) => history.redoStack.length > 0,
		createSessionController: () => createSelectedSession(),
		createProjectStore: (options: AudioEditorProjectStoreOptions = {}) => (
			createSoundscaperProjectStore(options)
		),
		acquireProjectLock: (projectId: string, options: Record<string, unknown> = {}) => acquireProjectLock(
			projectId,
			profiledLockOptions(options),
		),
	};
	return Object.freeze(selection) as unknown as Readonly<SoundscaperProjectRuntimeSelection>;
}

function projectForConsumers(
	project: unknown,
	kind: 'command' | 'runtime',
): ControllerRuntimeProject {
	if (!isCurrentProjectSchemaIdentity(project, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY)) {
		return createSoundscaperOpaqueCustodyConsumerProject(project);
	}
	if (kind === 'command') {
		return soundscaperProjectForCommandConsumers(project) as ControllerRuntimeProject;
	}
	validateSoundscaperProject(project);
	return resolveRuntimeProjectProjection(
		project as SoundscaperProject,
	) as unknown as ControllerRuntimeProject;
}

function createHistory(
	project: unknown,
): SoundscaperProjectHistorySelection & ControllerRuntimeHistory {
	if (isCurrentProjectSchemaIdentity(project, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY)) {
		return createSoundscaperProjectHistory(project) as SoundscaperProjectHistory
			& ControllerRuntimeHistory;
	}
	const loaded = loadSoundscaperProject(project);
	if (!loaded.intrinsicReadOnly) {
		throw new Error('Only an intrinsically read-only project may use opaque custody history.');
	}
	return Object.freeze({
		limit: AUDIO_EDITOR_HISTORY_LIMIT,
		present: createSoundscaperOpaqueCustodyConsumerProject(loaded.project),
		undoStack: Object.freeze([]),
		redoStack: Object.freeze([]),
	});
}

function writableHistory(
	history: SoundscaperProjectHistorySelection,
): SoundscaperProjectHistory {
	if (!isCurrentProjectSchemaIdentity(history.present, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY)) {
		throw new Error('Opaque Soundscaper project custody is read-only.');
	}
	return history as SoundscaperProjectHistory;
}

function createSelectedSession(): ReturnType<typeof createAudioEditorSessionController> {
	const delegate = createAudioEditorSessionController({
		currentSchemaVersion: PROJECT_SCHEMA_VERSION,
	});
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = loadSoundscaperProject(project);
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
				return cloneSoundscaperProject(candidate);
			}, updateOptions);
		},
		updateProjectHistory(
			projectId: string,
			history: SoundscaperProjectHistory,
			updateOptions: Record<string, unknown> = {},
		) {
			validateSoundscaperProjectHistory(history);
			return delegate.updateProjectHistory(projectId, history, updateOptions);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper baseline project lock options must be a record.');
	}
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) {
		throw new TypeError('The baseline lock profile rejects authority overrides.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => key !== 'force')) {
		throw new TypeError('The baseline lock accepts only a force flag.');
	}
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The baseline lock force flag must be an own boolean data property.');
	}
	return {
		...(force ? { force: force.value } : {}),
		projectStorageProfile: SOUNDSCAPER_PROJECT_STORAGE_PROFILE,
	};
}

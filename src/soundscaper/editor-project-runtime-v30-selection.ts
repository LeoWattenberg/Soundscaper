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
import { resolveRuntimeProjectProjection } from '../common/editor/runtime-clip-projection.ts';
import { createAudioEditorSessionController } from '../common/editor/session.js';
import { createAudioEditorSessionClipboard } from '../common/editor/session-clipboard-codec.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	applySoundscaperProjectCommandV30,
	soundscaperProjectForCommandConsumersV30,
	type SoundscaperProjectCommandV30,
} from './editor-project-v30-commands.ts';
import {
	createSoundscaperOpaqueCustodyConsumerProjectV30,
	type SoundscaperOpaqueCustodyConsumerProjectV30,
} from './editor-project-opaque-custody-v30.ts';
import {
	createSoundscaperProjectHistoryV30,
	executeSoundscaperProjectCommandV30,
	redoSoundscaperProjectCommandV30,
	undoSoundscaperProjectCommandV30,
	validateSoundscaperProjectHistoryV30,
	type SoundscaperProjectHistoryV30,
} from './editor-project-v30-history.ts';
import {
	cloneSoundscaperProjectV30,
	createSoundscaperProjectV30,
	loadSoundscaperProjectV30,
	SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION,
	type SoundscaperProjectV30,
	type SoundscaperProjectV30Options,
} from './editor-project-v30.ts';
import {
	SOUNDSCAPER_V30_PROJECT_STORAGE_PROFILE,
} from './editor-project-storage-profile-v30.ts';
import { SOUNDSCAPER_V30_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v30.ts';
import { createSoundscaperProjectStoreV30 } from './editor-project-store-v30.ts';
import { validateSoundscaperProjectV30 } from './editor-project-v30-validation.ts';
import {
	prepareCurrentSoundscaperTrackDuplicateCarrierV8,
} from './editor-session-clipboard-v8.ts';

interface SoundscaperOpaqueCustodyHistoryV30 {
	readonly limit: number;
	readonly present: SoundscaperOpaqueCustodyConsumerProjectV30;
	readonly undoStack: readonly never[];
	readonly redoStack: readonly never[];
}

type SoundscaperProjectHistorySelectionV30 =
	| SoundscaperProjectHistoryV30
	| SoundscaperOpaqueCustodyHistoryV30;

export interface SoundscaperProjectRuntimeV30Selection {
	readonly assistanceAssetCommands: true;
	readonly runtimeProfile: typeof SOUNDSCAPER_V30_PROJECT_RUNTIME_PROFILE;
	readonly storageProfile: typeof SOUNDSCAPER_V30_PROJECT_STORAGE_PROFILE;
	readonly createProject: (options?: SoundscaperProjectV30Options) => SoundscaperProjectV30 & ControllerRuntimeProject;
	readonly cloneProject: (project: unknown) => SoundscaperProjectV30 & ControllerRuntimeProject;
	readonly validateProject: (project: unknown) => project is SoundscaperProjectV30;
	readonly migrateProject: (project: unknown) => Readonly<{
		readonly project: SoundscaperProjectV30 | Readonly<Record<string, unknown>>;
		readonly readOnly: boolean;
		readonly intrinsicReadOnly: boolean;
		readonly reason: 'newer-schema' | null;
		readonly migrated: boolean;
		readonly fromVersion: number;
	}>;
	readonly createHistory: (project: unknown) => SoundscaperProjectHistorySelectionV30 & ControllerRuntimeHistory;
	readonly createSessionController: () => ReturnType<typeof createAudioEditorSessionController>;
	readonly createProjectStore: (options?: AudioEditorProjectStoreOptions) => AudioEditorProjectStore;
	readonly acquireProjectLock: typeof acquireProjectLock;
	readonly projectForCommandConsumers: ControllerProjectRuntime['projectForCommandConsumers'];
	readonly projectForRuntimeConsumers: ControllerProjectRuntime['projectForRuntimeConsumers'];
	readonly prepareEditClipboardDescriptor: ControllerProjectRuntime['prepareEditClipboardDescriptor'];
	readonly prepareTrackDuplicateCarrier: ControllerProjectRuntime['prepareTrackDuplicateCarrier'];
	readonly applyCommand: (
		project: unknown,
		command: SoundscaperProjectCommandV30,
		options?: Readonly<{ now?: Date | string }>,
	) => SoundscaperProjectV30 & ControllerRuntimeProject;
	readonly executeCommand: (
		history: SoundscaperProjectHistorySelectionV30,
		command: SoundscaperProjectCommandV30,
		options?: Readonly<{ now?: Date | string }>,
	) => SoundscaperProjectHistoryV30 & ControllerRuntimeHistory;
	readonly undo: ControllerProjectRuntime['undo'];
	readonly redo: ControllerProjectRuntime['redo'];
	readonly canUndo: ControllerProjectRuntime['canUndo'];
	readonly canRedo: ControllerProjectRuntime['canRedo'];
}

/** Select exact V30 document, command, history, session, and storage authority. */
export function createSoundscaperProjectRuntimeV30Selection(): Readonly<SoundscaperProjectRuntimeV30Selection> {
	const selection = {
		assistanceAssetCommands: true as const,
		runtimeProfile: SOUNDSCAPER_V30_PROJECT_RUNTIME_PROFILE,
		storageProfile: SOUNDSCAPER_V30_PROJECT_STORAGE_PROFILE,
		createProject: (options: SoundscaperProjectV30Options = {}) => (
			createSoundscaperProjectV30(options) as SoundscaperProjectV30 & ControllerRuntimeProject
		),
		cloneProject: (project: unknown) => (
			cloneSoundscaperProjectV30(project) as SoundscaperProjectV30 & ControllerRuntimeProject
		),
		validateProject: (project: unknown): project is SoundscaperProjectV30 => (
			validateSoundscaperProjectV30(project)
		),
		migrateProject: (project: unknown) => {
			const fromVersion = readSchemaVersion(project);
			return Object.freeze({
				...loadSoundscaperProjectV30(project),
				migrated: fromVersion !== SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION,
				fromVersion,
			});
		},
		projectForCommandConsumers: (project: unknown) => projectForConsumers(project, 'command'),
		projectForRuntimeConsumers: (project: unknown) => projectForConsumers(project, 'runtime'),
		prepareEditClipboardDescriptor: (project: unknown, descriptor: AudioEditorClipboard) => (
			createAudioEditorSessionClipboard(
				soundscaperProjectForCommandConsumersV30(project),
				{ descriptor },
			).descriptor
		),
		prepareTrackDuplicateCarrier: (project: unknown, request: ControllerTrackDuplicateRequest) => (
			prepareCurrentSoundscaperTrackDuplicateCarrierV8(project, request)
		),
		createHistory: (project: unknown) => createHistory(project),
		applyCommand: (project: unknown, command: SoundscaperProjectCommandV30, options = {}) => (
			applySoundscaperProjectCommandV30(project, command, options) as SoundscaperProjectV30 & ControllerRuntimeProject
		),
		executeCommand: (
			history: SoundscaperProjectHistorySelectionV30,
			command: SoundscaperProjectCommandV30,
			options = {},
		) => executeSoundscaperProjectCommandV30(
			writableHistory(history), command, options,
		) as SoundscaperProjectHistoryV30 & ControllerRuntimeHistory,
		undo: (history: SoundscaperProjectHistorySelectionV30, options = {}) => (
			undoSoundscaperProjectCommandV30(
				writableHistory(history), options,
			) as SoundscaperProjectHistoryV30 & ControllerRuntimeHistory
		),
		redo: (history: SoundscaperProjectHistorySelectionV30, options = {}) => (
			redoSoundscaperProjectCommandV30(
				writableHistory(history), options,
			) as SoundscaperProjectHistoryV30 & ControllerRuntimeHistory
		),
		canUndo: (history: ControllerRuntimeHistory) => history.undoStack.length > 0,
		canRedo: (history: ControllerRuntimeHistory) => history.redoStack.length > 0,
		createSessionController: () => createSelectedSession(),
		createProjectStore: (options: AudioEditorProjectStoreOptions = {}) => (
			createSoundscaperProjectStoreV30(options)
		),
		acquireProjectLock: (projectId: string, options: Record<string, unknown> = {}) => acquireProjectLock(
			projectId,
			profiledLockOptions(options),
		),
	};
	return Object.freeze(selection) as unknown as Readonly<SoundscaperProjectRuntimeV30Selection>;
}

function projectForConsumers(
	project: unknown,
	kind: 'command' | 'runtime',
): ControllerRuntimeProject {
	if (readSchemaVersion(project) !== SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION) {
		return createSoundscaperOpaqueCustodyConsumerProjectV30(project);
	}
	if (kind === 'command') {
		return soundscaperProjectForCommandConsumersV30(project) as ControllerRuntimeProject;
	}
	validateSoundscaperProjectV30(project);
	return resolveRuntimeProjectProjection(
		project as SoundscaperProjectV30,
	) as unknown as ControllerRuntimeProject;
}

function createHistory(
	project: unknown,
): SoundscaperProjectHistorySelectionV30 & ControllerRuntimeHistory {
	if (readSchemaVersion(project) === SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION) {
		return createSoundscaperProjectHistoryV30(project) as SoundscaperProjectHistoryV30
			& ControllerRuntimeHistory;
	}
	const loaded = loadSoundscaperProjectV30(project);
	if (!loaded.intrinsicReadOnly) {
		throw new Error('Only an intrinsically read-only project may use opaque V30 custody history.');
	}
	return Object.freeze({
		limit: AUDIO_EDITOR_HISTORY_LIMIT,
		present: createSoundscaperOpaqueCustodyConsumerProjectV30(loaded.project),
		undoStack: Object.freeze([]),
		redoStack: Object.freeze([]),
	});
}

function writableHistory(
	history: SoundscaperProjectHistorySelectionV30,
): SoundscaperProjectHistoryV30 {
	if (readSchemaVersion(history.present) !== SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION) {
		throw new Error('Opaque Soundscaper project custody is read-only.');
	}
	return history as SoundscaperProjectHistoryV30;
}

function createSelectedSession(): ReturnType<typeof createAudioEditorSessionController> {
	const delegate = createAudioEditorSessionController({
		currentSchemaVersion: SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION,
	});
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = loadSoundscaperProjectV30(project);
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
				return cloneSoundscaperProjectV30(candidate);
			}, updateOptions);
		},
		updateProjectHistory(
			projectId: string,
			history: SoundscaperProjectHistoryV30,
			updateOptions: Record<string, unknown> = {},
		) {
			validateSoundscaperProjectHistoryV30(history);
			return delegate.updateProjectHistory(projectId, history, updateOptions);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper V30 project lock options must be a record.');
	}
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) {
		throw new TypeError('The selected V30 lock profile rejects authority overrides.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => key !== 'force')) {
		throw new TypeError('The selected V30 lock accepts only a force flag.');
	}
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The selected V30 lock force flag must be an own boolean data property.');
	}
	return {
		...(force ? { force: force.value } : {}),
		projectStorageProfile: SOUNDSCAPER_V30_PROJECT_STORAGE_PROFILE,
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

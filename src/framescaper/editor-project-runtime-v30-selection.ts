/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard, AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import { acquireProjectLock } from '../common/editor/project-lock.js';
import { createAudioEditorSessionController } from '../common/editor/session.js';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import { createStableId } from '../common/editor/stable-id.js';
import {
	createFramescaperProjectFeatureCompatibilityServiceV30,
} from './editor-project-feature-requirements-v30.ts';
import {
	createFramescaperOpaqueCustodyConsumerProjectV30,
	snapshotFramescaperOpaqueCustodyProjectV30,
	type FramescaperOpaqueCustodyConsumerProjectV30,
	type FramescaperOpaqueCustodyProjectV30,
} from './editor-project-opaque-custody-v30.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import {
	FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
	assertFramescaperProjectV30Profile,
} from './editor-project-runtime-profile-v30.ts';
import { FRAMESCAPER_V30_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v30.ts';
import { createFramescaperProjectStoreV30 } from './editor-project-store-v30.ts';
import {
	applyFramescaperProjectCommandV30,
	type FramescaperProjectCommandV30,
} from './editor-project-v30-commands.ts';
import {
	createFramescaperProjectHistoryV30,
	executeFramescaperProjectCommandV30,
	redoFramescaperProjectCommandV30,
	undoFramescaperProjectCommandV30,
	validateFramescaperProjectHistoryV30,
	type FramescaperProjectHistoryV30,
} from './editor-project-v30-history.ts';
import { migrateFramescaperProjectV30 } from './editor-project-v30-migration.ts';
import {
	framescaperProjectForCommandConsumersV30,
	framescaperProjectForEditClipboardConsumersV30,
	framescaperProjectForRuntimeConsumersV30,
} from './editor-project-v30-runtime.ts';
import { prepareFramescaperVideoTransitionAllocationsV30 } from './editor-project-v30-transition-allocation.ts';
import {
	cloneFramescaperProjectV30,
	createFramescaperProjectV30,
	loadFramescaperProjectV30,
	reimportFramescaperProjectV30,
	type FramescaperProjectV30,
	type FramescaperProjectV30Options,
} from './editor-project-v30.ts';
import {
	FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION,
	validateFramescaperProjectV30,
} from './editor-project-v30-validation.ts';
import {
	prepareFramescaperSessionClipboardPasteV13,
	stageFramescaperSessionClipboardImageBodiesV13,
	type FramescaperImageClipboardBodyStageV13,
	type FramescaperImageClipboardBodyStoreV13,
	type FramescaperSessionClipboardPasteV13,
} from './editor-session-clipboard-v13-paste.ts';
import {
	createFramescaperSessionClipboardV13,
	type FramescaperSessionClipboardV13,
} from './editor-session-clipboard-v13.ts';

type LockFactory = (projectId: string, options?: Record<string, unknown>) => Promise<unknown>;
type SessionFactory = () => ReturnType<typeof createAudioEditorSessionController>;
interface FramescaperOpaqueCustodyHistoryV30 {
	readonly limit: number;
	readonly present: FramescaperOpaqueCustodyProjectV30;
	readonly undoStack: readonly never[];
	readonly redoStack: readonly never[];
}
type FramescaperProjectHistorySelectionV30 =
	| FramescaperProjectHistoryV30
	| FramescaperOpaqueCustodyHistoryV30;
const STORE_AUTHORITY_FIELDS = [
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
] as const;

export interface EditorProjectRuntimeV30Selection {
	readonly profile: typeof FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE;
	readonly storageProfile: typeof FRAMESCAPER_V30_PROJECT_STORAGE_PROFILE;
	readonly compatibility: ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceV30>;
	readonly createProject: (options?: FramescaperProjectV30Options) => FramescaperProjectV30;
	readonly cloneProject: (project: unknown) => FramescaperProjectV30;
	readonly validateProject: (project: unknown) => project is FramescaperProjectV30;
	readonly migrateProject: (project: unknown) => ReturnType<typeof migrateFramescaperProjectV30>;
	readonly reimportProject: (project: unknown) => FramescaperProjectV30;
	readonly projectForCommandConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForCommandConsumersV30> | FramescaperOpaqueCustodyConsumerProjectV30;
	readonly projectForRuntimeConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForRuntimeConsumersV30> | FramescaperOpaqueCustodyConsumerProjectV30;
	readonly projectForEditClipboardConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForEditClipboardConsumersV30>;
	readonly createSessionClipboard: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => FramescaperSessionClipboardV13;
	readonly createEditSessionClipboard: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => FramescaperSessionClipboardV13;
	readonly prepareEditClipboardPaste: (
		project: unknown,
		clipboard: unknown,
		command: AudioEditorCommand,
		createId: (prefix?: string) => string,
	) => FramescaperSessionClipboardPasteV13;
	readonly prepareEditClipboardPasteCommand: (
		project: unknown,
		clipboard: unknown,
		command: AudioEditorCommand,
		createId: (prefix?: string) => string,
	) => FramescaperProjectCommandV30;
	readonly stageEditClipboardPasteBodies: (
		prepared: FramescaperSessionClipboardPasteV13,
		store: FramescaperImageClipboardBodyStoreV13,
		options?: Readonly<{ signal?: AbortSignal }>,
	) => Promise<FramescaperImageClipboardBodyStageV13>;
	readonly prepareEditClipboardDescriptor: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => AudioEditorClipboard;
	readonly createHistory: (project: unknown) => FramescaperProjectHistorySelectionV30;
	readonly applyCommand: (
		project: unknown,
		command: FramescaperProjectCommandV30,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectV30;
	readonly executeCommand: (
		history: FramescaperProjectHistorySelectionV30,
		command: FramescaperProjectCommandV30,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV30;
	readonly undo: (
		history: FramescaperProjectHistorySelectionV30,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV30;
	readonly redo: (
		history: FramescaperProjectHistorySelectionV30,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV30;
	readonly canUndo: (history: FramescaperProjectHistorySelectionV30) => boolean;
	readonly canRedo: (history: FramescaperProjectHistorySelectionV30) => boolean;
	readonly createSessionController: SessionFactory;
	readonly createProjectStore: (options?: AudioEditorProjectStoreOptions) => unknown;
	readonly acquireProjectLock: LockFactory;
}

/** Complete selected V30 authority; nonexact documents remain inert custody. */
export function createEditorProjectRuntimeV30Selection(
	profile: unknown,
): Readonly<EditorProjectRuntimeV30Selection> {
	assertFramescaperProjectV30Profile(profile);
	const selection: EditorProjectRuntimeV30Selection = {
		profile,
		storageProfile: FRAMESCAPER_V30_PROJECT_STORAGE_PROFILE,
		compatibility: createFramescaperProjectFeatureCompatibilityServiceV30(profile),
		createProject: (options = {}) => createFramescaperProjectV30(profile, options),
		cloneProject: (project) => cloneFramescaperProjectV30(profile, project),
		validateProject: (project): project is FramescaperProjectV30 => validateFramescaperProjectV30(profile, project),
		migrateProject: (project) => migrateFramescaperProjectV30(profile, project),
		reimportProject: (project) => reimportFramescaperProjectV30(profile, project),
		projectForCommandConsumers: (project) => projectForCommandConsumers(profile, project),
		projectForRuntimeConsumers: (project) => projectForRuntimeConsumers(profile, project),
		projectForEditClipboardConsumers: (project) => framescaperProjectForEditClipboardConsumersV30(
			profile, project,
		),
		createSessionClipboard: (project, descriptor) => createClipboard(project, descriptor),
		createEditSessionClipboard: (project, descriptor) => createClipboard(project, descriptor),
		prepareEditClipboardPaste: (project, clipboard, command, createId) => (
			prepareFramescaperSessionClipboardPasteV13(
				profile, project, clipboard, command, createId,
			)
		),
		prepareEditClipboardPasteCommand: (project, clipboard, command, createId) => (
			prepareFramescaperSessionClipboardPasteV13(
				profile, project, clipboard, command, createId,
			).command
		),
		stageEditClipboardPasteBodies: (prepared, store, options = {}) => (
			stageFramescaperSessionClipboardImageBodiesV13(
				prepared.bodyTransfers, store, options,
			)
		),
		prepareEditClipboardDescriptor: (project, descriptor) => createClipboard(project, descriptor).descriptor,
		createHistory: (project) => createHistory(profile, project),
		applyCommand: (project, command, options = {}) => applyFramescaperProjectCommandV30(
			profile,
			project,
			prepareFramescaperVideoTransitionAllocationsV30(profile, project, command, createStableId),
			options,
		),
		executeCommand: (history, command, options = {}) => {
			const writable = writableHistory(history);
			return executeFramescaperProjectCommandV30(
				profile,
				writable,
				prepareFramescaperVideoTransitionAllocationsV30(
					profile, writable.present, command, createStableId,
				),
				options,
			);
		},
		undo: (history, options = {}) => undoFramescaperProjectCommandV30(
			profile, writableHistory(history), options,
		),
		redo: (history, options = {}) => redoFramescaperProjectCommandV30(
			profile, writableHistory(history), options,
		),
		canUndo: (history) => history.undoStack.length > 0,
		canRedo: (history) => history.redoStack.length > 0,
		createSessionController(...args: unknown[]) {
			if (args.length !== 0) throw new TypeError('The selected V30 session accepts no caller-owned options.');
			return createSelectedSession(profile);
		},
		createProjectStore: (options = {}) => createFramescaperProjectStoreV30(
			profile, selectedStoreOptions(options),
		),
		acquireProjectLock: (projectId, options = {}) => acquireProjectLock(
			projectId, profiledLockOptions(options),
		),
	};
	return Object.freeze(selection);

	function createClipboard(project: unknown, descriptor: AudioEditorClipboard) {
		return createFramescaperSessionClipboardV13(profile, project, descriptor);
	}
}

function createSelectedSession(profile: unknown): ReturnType<typeof createAudioEditorSessionController> {
	const delegate = createAudioEditorSessionController({
		currentSchemaVersion: FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION,
	});
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = migrateFramescaperProjectV30(profile, project);
			return delegate.openProject(loaded.project, {
				...openOptions,
				readOnly: Boolean(openOptions.readOnly || loaded.intrinsicReadOnly),
				readOnlyReason: openOptions.readOnlyReason ?? loaded.reason,
			});
		},
		updateProject(projectId: string, update: unknown, updateOptions: Record<string, unknown> = {}) {
			return delegate.updateProject(projectId, (previous: unknown) => cloneFramescaperProjectV30(
				profile,
				typeof update === 'function' ? (update as (value: unknown) => unknown)(previous) : update,
			), updateOptions);
		},
		updateProjectHistory(
			projectId: string,
			history: FramescaperProjectHistoryV30,
			options: Record<string, unknown> = {},
		) {
			validateFramescaperProjectHistoryV30(profile, history);
			return delegate.updateProjectHistory(projectId, history, options);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('V30 lock options must be a record.');
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) {
		throw new TypeError('The V30 lock profile is internal.');
	}
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The V30 lock force option must be an own boolean data property.');
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'force')) throw new TypeError('The V30 lock rejects authority overrides.');
	return {
		...(force ? { force: force.value } : {}),
		projectStorageProfile: FRAMESCAPER_V30_PROJECT_STORAGE_PROFILE,
	};
}

function selectedStoreOptions(value: AudioEditorProjectStoreOptions | unknown): AudioEditorProjectStoreOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Selected V30 store options must be a record.');
	}
	for (const field of STORE_AUTHORITY_FIELDS) {
		if (Object.getOwnPropertyDescriptor(value, field)) {
			throw new TypeError(`The selected V30 store rejects ${field} authority override.`);
		}
	}
	return value as AudioEditorProjectStoreOptions;
}

function projectForRuntimeConsumers(
	profile: unknown,
	project: unknown,
): ReturnType<typeof framescaperProjectForRuntimeConsumersV30> | FramescaperOpaqueCustodyConsumerProjectV30 {
	return readFramescaperProjectSchemaVersion(project) === FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION
		? framescaperProjectForRuntimeConsumersV30(profile, project)
		: createFramescaperOpaqueCustodyConsumerProjectV30(project);
}

function projectForCommandConsumers(
	profile: unknown,
	project: unknown,
): ReturnType<typeof framescaperProjectForCommandConsumersV30> | FramescaperOpaqueCustodyConsumerProjectV30 {
	return readFramescaperProjectSchemaVersion(project) === FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION
		? framescaperProjectForCommandConsumersV30(profile, project)
		: createFramescaperOpaqueCustodyConsumerProjectV30(project);
}

function createHistory(profile: unknown, project: unknown): FramescaperProjectHistorySelectionV30 {
	if (readFramescaperProjectSchemaVersion(project) === FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION) {
		return createFramescaperProjectHistoryV30(profile, project);
	}
	const loaded = loadFramescaperProjectV30(profile, project);
	if (!loaded.intrinsicReadOnly) {
		throw new Error('Only an intrinsically read-only project may use opaque V30 custody history.');
	}
	return Object.freeze({
		limit: AUDIO_EDITOR_HISTORY_LIMIT,
		present: snapshotFramescaperOpaqueCustodyProjectV30(loaded.project),
		undoStack: Object.freeze([]),
		redoStack: Object.freeze([]),
	});
}

function writableHistory(history: FramescaperProjectHistorySelectionV30): FramescaperProjectHistoryV30 {
	if (history.present.schemaVersion !== FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION) {
		throw new Error('Opaque Framescaper project custody is read-only.');
	}
	return history as FramescaperProjectHistoryV30;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard, AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import { acquireProjectLock } from '../common/editor/project-lock.js';
import { createAudioEditorSessionController } from '../common/editor/session.js';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import { createStableId } from '../common/editor/stable-id.js';
import {
	createFramescaperProjectFeatureCompatibilityServiceV32,
} from './editor-project-feature-requirements-v32.ts';
import {
	createFramescaperOpaqueCustodyConsumerProjectV32,
	snapshotFramescaperOpaqueCustodyProjectV32,
	type FramescaperOpaqueCustodyConsumerProjectV32,
	type FramescaperOpaqueCustodyProjectV32,
} from './editor-project-opaque-custody-v32.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import {
	FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE,
	assertFramescaperProjectV32Profile,
} from './editor-project-runtime-profile-v32.ts';
import { FRAMESCAPER_V32_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v32.ts';
import { createFramescaperProjectStoreV32 } from './editor-project-store-v32.ts';
import {
	applyFramescaperProjectCommandV32,
	type FramescaperProjectCommandV32,
} from './editor-project-v32-commands.ts';
import {
	createFramescaperProjectHistoryV32,
	executeFramescaperProjectCommandV32,
	redoFramescaperProjectCommandV32,
	undoFramescaperProjectCommandV32,
	validateFramescaperProjectHistoryV32,
	type FramescaperProjectHistoryV32,
} from './editor-project-v32-history.ts';
import { migrateFramescaperProjectV32 } from './editor-project-v32-migration.ts';
import {
	framescaperProjectForCommandConsumersV32,
	framescaperProjectForEditClipboardConsumersV32,
	framescaperProjectForRuntimeConsumersV32,
} from './editor-project-v32-runtime.ts';
import { prepareFramescaperVideoTransitionAllocationsV32 } from './editor-project-v32-transition-allocation.ts';
import {
	cloneFramescaperProjectV32,
	createFramescaperProjectV32,
	loadFramescaperProjectV32,
	reimportFramescaperProjectV32,
	type FramescaperProjectV32,
	type FramescaperProjectV32Options,
} from './editor-project-v32.ts';
import {
	FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION,
	validateFramescaperProjectV32,
} from './editor-project-v32-validation.ts';
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
interface FramescaperOpaqueCustodyHistoryV32 {
	readonly limit: number;
	readonly present: FramescaperOpaqueCustodyProjectV32;
	readonly undoStack: readonly never[];
	readonly redoStack: readonly never[];
}
type FramescaperProjectHistorySelectionV32 =
	| FramescaperProjectHistoryV32
	| FramescaperOpaqueCustodyHistoryV32;
const STORE_AUTHORITY_FIELDS = [
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
] as const;

export interface EditorProjectRuntimeV32Selection {
	readonly profile: typeof FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;
	readonly storageProfile: typeof FRAMESCAPER_V32_PROJECT_STORAGE_PROFILE;
	readonly compatibility: ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceV32>;
	readonly createProject: (options?: FramescaperProjectV32Options) => FramescaperProjectV32;
	readonly cloneProject: (project: unknown) => FramescaperProjectV32;
	readonly validateProject: (project: unknown) => project is FramescaperProjectV32;
	readonly migrateProject: (project: unknown) => ReturnType<typeof migrateFramescaperProjectV32>;
	readonly reimportProject: (project: unknown) => FramescaperProjectV32;
	readonly projectForCommandConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForCommandConsumersV32> | FramescaperOpaqueCustodyConsumerProjectV32;
	readonly projectForRuntimeConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForRuntimeConsumersV32> | FramescaperOpaqueCustodyConsumerProjectV32;
	readonly projectForEditClipboardConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForEditClipboardConsumersV32>;
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
	) => FramescaperProjectCommandV32;
	readonly stageEditClipboardPasteBodies: (
		prepared: FramescaperSessionClipboardPasteV13,
		store: FramescaperImageClipboardBodyStoreV13,
		options?: Readonly<{ signal?: AbortSignal }>,
	) => Promise<FramescaperImageClipboardBodyStageV13>;
	readonly prepareEditClipboardDescriptor: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => AudioEditorClipboard;
	readonly createHistory: (project: unknown) => FramescaperProjectHistorySelectionV32;
	readonly applyCommand: (
		project: unknown,
		command: FramescaperProjectCommandV32,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectV32;
	readonly executeCommand: (
		history: FramescaperProjectHistorySelectionV32,
		command: FramescaperProjectCommandV32,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV32;
	readonly undo: (
		history: FramescaperProjectHistorySelectionV32,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV32;
	readonly redo: (
		history: FramescaperProjectHistorySelectionV32,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV32;
	readonly canUndo: (history: FramescaperProjectHistorySelectionV32) => boolean;
	readonly canRedo: (history: FramescaperProjectHistorySelectionV32) => boolean;
	readonly createSessionController: SessionFactory;
	readonly createProjectStore: (options?: AudioEditorProjectStoreOptions) => unknown;
	readonly acquireProjectLock: LockFactory;
}

/** Complete selected V32 authority; nonexact documents remain inert custody. */
export function createEditorProjectRuntimeV32Selection(
	profile: unknown,
): Readonly<EditorProjectRuntimeV32Selection> {
	assertFramescaperProjectV32Profile(profile);
	const selection: EditorProjectRuntimeV32Selection = {
		profile,
		storageProfile: FRAMESCAPER_V32_PROJECT_STORAGE_PROFILE,
		compatibility: createFramescaperProjectFeatureCompatibilityServiceV32(profile),
		createProject: (options = {}) => createFramescaperProjectV32(profile, options),
		cloneProject: (project) => cloneFramescaperProjectV32(profile, project),
		validateProject: (project): project is FramescaperProjectV32 => validateFramescaperProjectV32(profile, project),
		migrateProject: (project) => migrateFramescaperProjectV32(profile, project),
		reimportProject: (project) => reimportFramescaperProjectV32(profile, project),
		projectForCommandConsumers: (project) => projectForCommandConsumers(profile, project),
		projectForRuntimeConsumers: (project) => projectForRuntimeConsumers(profile, project),
		projectForEditClipboardConsumers: (project) => framescaperProjectForEditClipboardConsumersV32(
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
		applyCommand: (project, command, options = {}) => applyFramescaperProjectCommandV32(
			profile,
			project,
			prepareFramescaperVideoTransitionAllocationsV32(profile, project, command, createStableId),
			options,
		),
		executeCommand: (history, command, options = {}) => {
			const writable = writableHistory(history);
			return executeFramescaperProjectCommandV32(
				profile,
				writable,
				prepareFramescaperVideoTransitionAllocationsV32(
					profile, writable.present, command, createStableId,
				),
				options,
			);
		},
		undo: (history, options = {}) => undoFramescaperProjectCommandV32(
			profile, writableHistory(history), options,
		),
		redo: (history, options = {}) => redoFramescaperProjectCommandV32(
			profile, writableHistory(history), options,
		),
		canUndo: (history) => history.undoStack.length > 0,
		canRedo: (history) => history.redoStack.length > 0,
		createSessionController(...args: unknown[]) {
			if (args.length !== 0) throw new TypeError('The selected V32 session accepts no caller-owned options.');
			return createSelectedSession(profile);
		},
		createProjectStore: (options = {}) => createFramescaperProjectStoreV32(
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
		currentSchemaVersion: FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION,
	});
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = migrateFramescaperProjectV32(profile, project);
			return delegate.openProject(loaded.project, {
				...openOptions,
				readOnly: Boolean(openOptions.readOnly || loaded.intrinsicReadOnly),
				readOnlyReason: openOptions.readOnlyReason ?? loaded.reason,
			});
		},
		updateProject(projectId: string, update: unknown, updateOptions: Record<string, unknown> = {}) {
			return delegate.updateProject(projectId, (previous: unknown) => cloneFramescaperProjectV32(
				profile,
				typeof update === 'function' ? (update as (value: unknown) => unknown)(previous) : update,
			), updateOptions);
		},
		updateProjectHistory(
			projectId: string,
			history: FramescaperProjectHistoryV32,
			options: Record<string, unknown> = {},
		) {
			validateFramescaperProjectHistoryV32(profile, history);
			return delegate.updateProjectHistory(projectId, history, options);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('V32 lock options must be a record.');
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) {
		throw new TypeError('The V32 lock profile is internal.');
	}
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The V32 lock force option must be an own boolean data property.');
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'force')) throw new TypeError('The V32 lock rejects authority overrides.');
	return {
		...(force ? { force: force.value } : {}),
		projectStorageProfile: FRAMESCAPER_V32_PROJECT_STORAGE_PROFILE,
	};
}

function selectedStoreOptions(value: AudioEditorProjectStoreOptions | unknown): AudioEditorProjectStoreOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Selected V32 store options must be a record.');
	}
	for (const field of STORE_AUTHORITY_FIELDS) {
		if (Object.getOwnPropertyDescriptor(value, field)) {
			throw new TypeError(`The selected V32 store rejects ${field} authority override.`);
		}
	}
	return value as AudioEditorProjectStoreOptions;
}

function projectForRuntimeConsumers(
	profile: unknown,
	project: unknown,
): ReturnType<typeof framescaperProjectForRuntimeConsumersV32> | FramescaperOpaqueCustodyConsumerProjectV32 {
	return readFramescaperProjectSchemaVersion(project) === FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION
		? framescaperProjectForRuntimeConsumersV32(profile, project)
		: createFramescaperOpaqueCustodyConsumerProjectV32(project);
}

function projectForCommandConsumers(
	profile: unknown,
	project: unknown,
): ReturnType<typeof framescaperProjectForCommandConsumersV32> | FramescaperOpaqueCustodyConsumerProjectV32 {
	return readFramescaperProjectSchemaVersion(project) === FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION
		? framescaperProjectForCommandConsumersV32(profile, project)
		: createFramescaperOpaqueCustodyConsumerProjectV32(project);
}

function createHistory(profile: unknown, project: unknown): FramescaperProjectHistorySelectionV32 {
	if (readFramescaperProjectSchemaVersion(project) === FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION) {
		return createFramescaperProjectHistoryV32(profile, project);
	}
	const loaded = loadFramescaperProjectV32(profile, project);
	if (!loaded.intrinsicReadOnly) {
		throw new Error('Only an intrinsically read-only project may use opaque V32 custody history.');
	}
	return Object.freeze({
		limit: AUDIO_EDITOR_HISTORY_LIMIT,
		present: snapshotFramescaperOpaqueCustodyProjectV32(loaded.project),
		undoStack: Object.freeze([]),
		redoStack: Object.freeze([]),
	});
}

function writableHistory(history: FramescaperProjectHistorySelectionV32): FramescaperProjectHistoryV32 {
	if (history.present.schemaVersion !== FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION) {
		throw new Error('Opaque Framescaper project custody is read-only.');
	}
	return history as FramescaperProjectHistoryV32;
}

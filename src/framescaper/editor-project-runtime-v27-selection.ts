/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard, AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import { acquireProjectLock } from '../common/editor/project-lock.js';
import { createAudioEditorSessionController } from '../common/editor/session.js';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import {
	createFramescaperProjectFeatureCompatibilityServiceV27,
} from './editor-project-feature-requirements-v27.ts';
import {
	createFramescaperSessionClipboardV11,
	type FramescaperSessionClipboardV11,
} from './editor-session-clipboard-v11.ts';
import { prepareFramescaperSessionClipboardPasteCommandV11 } from './editor-session-clipboard-v11-controller.ts';
import {
	applyFramescaperProjectCommandV27,
	type FramescaperProjectCommandV27,
} from './editor-project-v27-commands.ts';
import {
	createFramescaperProjectHistoryV27,
	executeFramescaperProjectCommandV27,
	redoFramescaperProjectCommandV27,
	undoFramescaperProjectCommandV27,
	validateFramescaperProjectHistoryV27,
	type FramescaperProjectHistoryV27,
} from './editor-project-v27-history.ts';
import { migrateFramescaperProjectV27 } from './editor-project-v27-migration.ts';
import {
	framescaperProjectForCommandConsumersV27,
	framescaperProjectForEditClipboardConsumersV27,
	framescaperProjectForRuntimeConsumersV27,
} from './editor-project-v27-runtime.ts';
import {
	FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
	assertFramescaperProjectV27Profile,
} from './editor-project-runtime-profile-v27.ts';
import { FRAMESCAPER_V27_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v27.ts';
import { createFramescaperProjectStoreV27 } from './editor-project-store-v27.ts';
import {
	cloneFramescaperProjectV27,
	createFramescaperProjectV27,
	loadFramescaperProjectV27,
	reimportFramescaperProjectV27,
	type FramescaperProjectV27,
	type FramescaperProjectV27Options,
} from './editor-project-v27.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import {
	createFramescaperOpaqueCustodyConsumerProjectV27,
	snapshotFramescaperOpaqueCustodyProjectV27,
	type FramescaperOpaqueCustodyProjectV27,
} from './editor-project-opaque-custody-v27.ts';
import { FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION, validateFramescaperProjectV27 } from './editor-project-v27-validation.ts';

type LockFactory = (projectId: string, options?: Record<string, unknown>) => Promise<unknown>;
type SessionFactory = () => ReturnType<typeof createAudioEditorSessionController>;
interface FramescaperOpaqueCustodyHistoryV27 {
	readonly limit: number;
	readonly present: FramescaperOpaqueCustodyProjectV27;
	readonly undoStack: readonly never[];
	readonly redoStack: readonly never[];
}
type FramescaperProjectHistorySelectionV27 =
	| FramescaperProjectHistoryV27
	| FramescaperOpaqueCustodyHistoryV27;
const STORE_AUTHORITY_FIELDS = [
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
] as const;

export interface EditorProjectRuntimeV27Selection {
	readonly profile: typeof FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;
	readonly storageProfile: typeof FRAMESCAPER_V27_PROJECT_STORAGE_PROFILE;
	readonly compatibility: ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceV27>;
	readonly createProject: (options?: FramescaperProjectV27Options) => FramescaperProjectV27;
	readonly cloneProject: (project: unknown) => FramescaperProjectV27;
	readonly validateProject: (project: unknown) => project is FramescaperProjectV27;
	readonly migrateProject: (project: unknown) => ReturnType<typeof migrateFramescaperProjectV27>;
	readonly reimportProject: (project: unknown) => FramescaperProjectV27;
	readonly projectForCommandConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForCommandConsumersV27> | FramescaperOpaqueCustodyProjectV27;
	readonly projectForRuntimeConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForRuntimeConsumersV27> | FramescaperOpaqueCustodyProjectV27;
	readonly projectForEditClipboardConsumers: (project: unknown) => ReturnType<typeof framescaperProjectForEditClipboardConsumersV27>;
	readonly createSessionClipboard: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => FramescaperSessionClipboardV11;
	readonly createEditSessionClipboard: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => FramescaperSessionClipboardV11;
	readonly prepareEditClipboardPasteCommand: (
		project: unknown,
		clipboard: unknown,
		command: AudioEditorCommand,
		createId: (prefix?: string) => string,
	) => FramescaperProjectCommandV27;
	readonly prepareEditClipboardDescriptor: (project: unknown, descriptor: AudioEditorClipboard) => AudioEditorClipboard;
	readonly createHistory: (project: unknown) => FramescaperProjectHistorySelectionV27;
	readonly applyCommand: (project: unknown, command: FramescaperProjectCommandV27, options?: Readonly<{ now?: Date | string }>) => FramescaperProjectV27;
	readonly executeCommand: (history: FramescaperProjectHistorySelectionV27, command: FramescaperProjectCommandV27, options?: Readonly<{ now?: Date | string }>) => FramescaperProjectHistoryV27;
	readonly undo: (history: FramescaperProjectHistorySelectionV27, options?: Readonly<{ now?: Date | string }>) => FramescaperProjectHistoryV27;
	readonly redo: (history: FramescaperProjectHistorySelectionV27, options?: Readonly<{ now?: Date | string }>) => FramescaperProjectHistoryV27;
	readonly canUndo: (history: FramescaperProjectHistorySelectionV27) => boolean;
	readonly canRedo: (history: FramescaperProjectHistorySelectionV27) => boolean;
	readonly createSessionController: SessionFactory;
	readonly createProjectStore: (options?: AudioEditorProjectStoreOptions) => unknown;
	readonly acquireProjectLock: LockFactory;
}

/** Complete selected V27 document/session authority; V25/V26 remain custody-only. */
export function createEditorProjectRuntimeV27Selection(
	profile: unknown,
): Readonly<EditorProjectRuntimeV27Selection> {
	assertFramescaperProjectV27Profile(profile);
	const selection: EditorProjectRuntimeV27Selection = {
		profile,
		storageProfile: FRAMESCAPER_V27_PROJECT_STORAGE_PROFILE,
		compatibility: createFramescaperProjectFeatureCompatibilityServiceV27(profile),
		createProject: (options = {}) => createFramescaperProjectV27(profile, options),
		cloneProject: (project) => cloneFramescaperProjectV27(profile, project),
		validateProject: (project): project is FramescaperProjectV27 => validateFramescaperProjectV27(profile, project),
		migrateProject: (project) => migrateFramescaperProjectV27(profile, project),
		reimportProject: (project) => reimportFramescaperProjectV27(profile, project),
		projectForCommandConsumers: (project) => projectForCommandConsumers(profile, project),
		projectForRuntimeConsumers: (project) => projectForRuntimeConsumers(profile, project),
		projectForEditClipboardConsumers: (project) => framescaperProjectForEditClipboardConsumersV27(
			profile,
			project,
		),
		createSessionClipboard: (project, descriptor) => createFramescaperSessionClipboardV11(
			profile,
			project,
			descriptor,
		),
		createEditSessionClipboard: (project, descriptor) => createFramescaperSessionClipboardV11(
			profile,
			project,
			descriptor,
		),
		prepareEditClipboardPasteCommand: (project, clipboard, command, createId) => (
			prepareFramescaperSessionClipboardPasteCommandV11(
				profile,
				project,
				clipboard,
				command,
				createId,
			)
		),
		prepareEditClipboardDescriptor: (project, descriptor) => createFramescaperSessionClipboardV11(
			profile,
			project,
			descriptor,
		).descriptor,
		createHistory: (project) => createHistory(profile, project),
		applyCommand: (project, command, options = {}) => applyFramescaperProjectCommandV27(profile, project, command, options),
		executeCommand: (history, command, options = {}) => executeFramescaperProjectCommandV27(
			profile, writableHistory(history), command, options,
		),
		undo: (history, options = {}) => undoFramescaperProjectCommandV27(
			profile, writableHistory(history), options,
		),
		redo: (history, options = {}) => redoFramescaperProjectCommandV27(
			profile, writableHistory(history), options,
		),
		canUndo: (history) => history.undoStack.length > 0,
		canRedo: (history) => history.redoStack.length > 0,
		createSessionController(...args: unknown[]) {
			if (args.length !== 0) throw new TypeError('The selected V27 session accepts no caller-owned options.');
			return createSelectedSession(profile);
		},
		createProjectStore: (options = {}) => createFramescaperProjectStoreV27(profile, selectedStoreOptions(options)),
		acquireProjectLock: (projectId, options = {}) => acquireProjectLock(projectId, profiledLockOptions(options)),
	};
	return Object.freeze(selection);
}

function createSelectedSession(profile: unknown): ReturnType<typeof createAudioEditorSessionController> {
	const delegate = createAudioEditorSessionController({ currentSchemaVersion: FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION });
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = migrateFramescaperProjectV27(profile, project);
			return delegate.openProject(loaded.project, {
				...openOptions,
				readOnly: Boolean(openOptions.readOnly || loaded.intrinsicReadOnly),
				readOnlyReason: openOptions.readOnlyReason ?? loaded.reason,
			});
		},
		updateProject(projectId: string, update: unknown, updateOptions: Record<string, unknown> = {}) {
			return delegate.updateProject(projectId, (previous: unknown) => cloneFramescaperProjectV27(
				profile,
				typeof update === 'function' ? (update as (value: unknown) => unknown)(previous) : update,
			), updateOptions);
		},
		updateProjectHistory(projectId: string, history: FramescaperProjectHistoryV27, options: Record<string, unknown> = {}) {
			validateFramescaperProjectHistoryV27(profile, history);
			return delegate.updateProjectHistory(projectId, history, options);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('V27 lock options must be a record.');
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) throw new TypeError('The V27 lock profile is internal.');
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The V27 lock force option must be an own boolean data property.');
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'force')) throw new TypeError('The V27 lock rejects authority overrides.');
	return { ...(force ? { force: force.value } : {}), projectStorageProfile: FRAMESCAPER_V27_PROJECT_STORAGE_PROFILE };
}

function selectedStoreOptions(value: AudioEditorProjectStoreOptions | unknown): AudioEditorProjectStoreOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Selected V27 store options must be a record.');
	for (const field of STORE_AUTHORITY_FIELDS) {
		if (Object.getOwnPropertyDescriptor(value, field)) throw new TypeError(`The selected V27 store rejects ${field} authority override.`);
	}
	return value as AudioEditorProjectStoreOptions;
}

function projectForRuntimeConsumers(
	profile: unknown,
	project: unknown,
): ReturnType<typeof framescaperProjectForRuntimeConsumersV27> | FramescaperOpaqueCustodyProjectV27 {
	return readFramescaperProjectSchemaVersion(project) === FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION
		? framescaperProjectForRuntimeConsumersV27(profile, project)
		: createFramescaperOpaqueCustodyConsumerProjectV27(project);
}

function projectForCommandConsumers(
	profile: unknown,
	project: unknown,
): ReturnType<typeof framescaperProjectForCommandConsumersV27> | FramescaperOpaqueCustodyProjectV27 {
	return readFramescaperProjectSchemaVersion(project) === FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION
		? framescaperProjectForCommandConsumersV27(profile, project)
		: createFramescaperOpaqueCustodyConsumerProjectV27(project);
}

function createHistory(
	profile: unknown,
	project: unknown,
): FramescaperProjectHistorySelectionV27 {
	if (readFramescaperProjectSchemaVersion(project) === FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION) {
		return createFramescaperProjectHistoryV27(profile, project);
	}
	const loaded = loadFramescaperProjectV27(profile, project);
	if (!loaded.intrinsicReadOnly) {
		throw new Error('Only an intrinsically read-only project may use opaque V27 custody history.');
	}
	return Object.freeze({
		limit: AUDIO_EDITOR_HISTORY_LIMIT,
		present: snapshotFramescaperOpaqueCustodyProjectV27(loaded.project),
		undoStack: Object.freeze([]),
		redoStack: Object.freeze([]),
	});
}

function writableHistory(
	history: FramescaperProjectHistorySelectionV27,
): FramescaperProjectHistoryV27 {
	if (history.present.schemaVersion !== FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION) {
		throw new Error('Opaque Framescaper project custody is read-only.');
	}
	return history as FramescaperProjectHistoryV27;
}

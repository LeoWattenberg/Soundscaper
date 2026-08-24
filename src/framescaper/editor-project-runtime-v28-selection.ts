/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard, AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import { acquireProjectLock } from '../common/editor/project-lock.js';
import { createAudioEditorSessionController } from '../common/editor/session.js';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import { createStableId } from '../common/editor/stable-id.js';
import {
	createFramescaperProjectFeatureCompatibilityServiceV28,
} from './editor-project-feature-requirements-v28.ts';
import {
	createFramescaperSessionClipboardV12,
	type FramescaperSessionClipboardV12,
} from './editor-session-clipboard-v12.ts';
import { prepareFramescaperSessionClipboardPasteCommandV12 } from './editor-session-clipboard-v12-controller.ts';
import {
	applyFramescaperProjectCommandV28,
	type FramescaperProjectCommandV28,
} from './editor-project-v28-commands.ts';
import {
	createFramescaperProjectHistoryV28,
	executeFramescaperProjectCommandV28,
	redoFramescaperProjectCommandV28,
	undoFramescaperProjectCommandV28,
	validateFramescaperProjectHistoryV28,
	type FramescaperProjectHistoryV28,
} from './editor-project-v28-history.ts';
import { migrateFramescaperProjectV28 } from './editor-project-v28-migration.ts';
import {
	framescaperProjectForCommandConsumersV28,
	framescaperProjectForEditClipboardConsumersV28,
	framescaperProjectForRuntimeConsumersV28,
} from './editor-project-v28-runtime.ts';
import {
	FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
	assertFramescaperProjectV28Profile,
} from './editor-project-runtime-profile-v28.ts';
import { FRAMESCAPER_V28_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v28.ts';
import { createFramescaperProjectStoreV28 } from './editor-project-store-v28.ts';
import {
	cloneFramescaperProjectV28,
	createFramescaperProjectV28,
	loadFramescaperProjectV28,
	reimportFramescaperProjectV28,
	type FramescaperProjectV28,
	type FramescaperProjectV28Options,
} from './editor-project-v28.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import {
	createFramescaperOpaqueCustodyConsumerProjectV28,
	snapshotFramescaperOpaqueCustodyProjectV28,
	type FramescaperOpaqueCustodyProjectV28,
} from './editor-project-opaque-custody-v28.ts';
import { FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION, validateFramescaperProjectV28 } from './editor-project-v28-validation.ts';
import { prepareFramescaperVideoTransitionAllocationsV28 } from './editor-project-v28-transition-allocation.ts';

type LockFactory = (projectId: string, options?: Record<string, unknown>) => Promise<unknown>;
type SessionFactory = () => ReturnType<typeof createAudioEditorSessionController>;
interface FramescaperOpaqueCustodyHistoryV28 {
	readonly limit: number;
	readonly present: FramescaperOpaqueCustodyProjectV28;
	readonly undoStack: readonly never[];
	readonly redoStack: readonly never[];
}
type FramescaperProjectHistorySelectionV28 =
	| FramescaperProjectHistoryV28
	| FramescaperOpaqueCustodyHistoryV28;
const STORE_AUTHORITY_FIELDS = [
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
] as const;

export interface EditorProjectRuntimeV28Selection {
	readonly profile: typeof FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	readonly storageProfile: typeof FRAMESCAPER_V28_PROJECT_STORAGE_PROFILE;
	readonly compatibility: ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceV28>;
	readonly createProject: (options?: FramescaperProjectV28Options) => FramescaperProjectV28;
	readonly cloneProject: (project: unknown) => FramescaperProjectV28;
	readonly validateProject: (project: unknown) => project is FramescaperProjectV28;
	readonly migrateProject: (project: unknown) => ReturnType<typeof migrateFramescaperProjectV28>;
	readonly reimportProject: (project: unknown) => FramescaperProjectV28;
	readonly projectForCommandConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForCommandConsumersV28> | FramescaperOpaqueCustodyProjectV28;
	readonly projectForRuntimeConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForRuntimeConsumersV28> | FramescaperOpaqueCustodyProjectV28;
	readonly projectForEditClipboardConsumers: (project: unknown) => ReturnType<typeof framescaperProjectForEditClipboardConsumersV28>;
	readonly createSessionClipboard: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => FramescaperSessionClipboardV12;
	readonly createEditSessionClipboard: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => FramescaperSessionClipboardV12;
	readonly prepareEditClipboardPasteCommand: (
		project: unknown,
		clipboard: unknown,
		command: AudioEditorCommand,
		createId: (prefix?: string) => string,
	) => FramescaperProjectCommandV28;
	readonly prepareEditClipboardDescriptor: (project: unknown, descriptor: AudioEditorClipboard) => AudioEditorClipboard;
	readonly createHistory: (project: unknown) => FramescaperProjectHistorySelectionV28;
	readonly applyCommand: (project: unknown, command: FramescaperProjectCommandV28, options?: Readonly<{ now?: Date | string }>) => FramescaperProjectV28;
	readonly executeCommand: (history: FramescaperProjectHistorySelectionV28, command: FramescaperProjectCommandV28, options?: Readonly<{ now?: Date | string }>) => FramescaperProjectHistoryV28;
	readonly undo: (history: FramescaperProjectHistorySelectionV28, options?: Readonly<{ now?: Date | string }>) => FramescaperProjectHistoryV28;
	readonly redo: (history: FramescaperProjectHistorySelectionV28, options?: Readonly<{ now?: Date | string }>) => FramescaperProjectHistoryV28;
	readonly canUndo: (history: FramescaperProjectHistorySelectionV28) => boolean;
	readonly canRedo: (history: FramescaperProjectHistorySelectionV28) => boolean;
	readonly createSessionController: SessionFactory;
	readonly createProjectStore: (options?: AudioEditorProjectStoreOptions) => unknown;
	readonly acquireProjectLock: LockFactory;
}

/** Complete selected V28 document/session authority; V25/V26 remain custody-only. */
export function createEditorProjectRuntimeV28Selection(
	profile: unknown,
): Readonly<EditorProjectRuntimeV28Selection> {
	assertFramescaperProjectV28Profile(profile);
	const selection: EditorProjectRuntimeV28Selection = {
		profile,
		storageProfile: FRAMESCAPER_V28_PROJECT_STORAGE_PROFILE,
		compatibility: createFramescaperProjectFeatureCompatibilityServiceV28(profile),
		createProject: (options = {}) => createFramescaperProjectV28(profile, options),
		cloneProject: (project) => cloneFramescaperProjectV28(profile, project),
		validateProject: (project): project is FramescaperProjectV28 => validateFramescaperProjectV28(profile, project),
		migrateProject: (project) => migrateFramescaperProjectV28(profile, project),
		reimportProject: (project) => reimportFramescaperProjectV28(profile, project),
		projectForCommandConsumers: (project) => projectForCommandConsumers(profile, project),
		projectForRuntimeConsumers: (project) => projectForRuntimeConsumers(profile, project),
		projectForEditClipboardConsumers: (project) => framescaperProjectForEditClipboardConsumersV28(
			profile,
			project,
		),
		createSessionClipboard: (project, descriptor) => createFramescaperSessionClipboardV12(
			profile,
			project,
			descriptor,
		),
		createEditSessionClipboard: (project, descriptor) => createFramescaperSessionClipboardV12(
			profile,
			project,
			descriptor,
		),
		prepareEditClipboardPasteCommand: (project, clipboard, command, createId) => (
			prepareFramescaperSessionClipboardPasteCommandV12(
				profile,
				project,
				clipboard,
				command,
				createId,
			)
		),
		prepareEditClipboardDescriptor: (project, descriptor) => createFramescaperSessionClipboardV12(
			profile,
			project,
			descriptor,
		).descriptor,
		createHistory: (project) => createHistory(profile, project),
		applyCommand: (project, command, options = {}) => applyFramescaperProjectCommandV28(
			profile,
			project,
			prepareFramescaperVideoTransitionAllocationsV28(
				profile, project, command, createStableId,
			),
			options,
		),
		executeCommand: (history, command, options = {}) => {
			const writable = writableHistory(history);
			return executeFramescaperProjectCommandV28(
				profile,
				writable,
				prepareFramescaperVideoTransitionAllocationsV28(
					profile, writable.present, command, createStableId,
				),
				options,
			);
		},
		undo: (history, options = {}) => undoFramescaperProjectCommandV28(
			profile, writableHistory(history), options,
		),
		redo: (history, options = {}) => redoFramescaperProjectCommandV28(
			profile, writableHistory(history), options,
		),
		canUndo: (history) => history.undoStack.length > 0,
		canRedo: (history) => history.redoStack.length > 0,
		createSessionController(...args: unknown[]) {
			if (args.length !== 0) throw new TypeError('The selected V28 session accepts no caller-owned options.');
			return createSelectedSession(profile);
		},
		createProjectStore: (options = {}) => createFramescaperProjectStoreV28(profile, selectedStoreOptions(options)),
		acquireProjectLock: (projectId, options = {}) => acquireProjectLock(projectId, profiledLockOptions(options)),
	};
	return Object.freeze(selection);
}

function createSelectedSession(profile: unknown): ReturnType<typeof createAudioEditorSessionController> {
	const delegate = createAudioEditorSessionController({ currentSchemaVersion: FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION });
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = migrateFramescaperProjectV28(profile, project);
			return delegate.openProject(loaded.project, {
				...openOptions,
				readOnly: Boolean(openOptions.readOnly || loaded.intrinsicReadOnly),
				readOnlyReason: openOptions.readOnlyReason ?? loaded.reason,
			});
		},
		updateProject(projectId: string, update: unknown, updateOptions: Record<string, unknown> = {}) {
			return delegate.updateProject(projectId, (previous: unknown) => cloneFramescaperProjectV28(
				profile,
				typeof update === 'function' ? (update as (value: unknown) => unknown)(previous) : update,
			), updateOptions);
		},
		updateProjectHistory(projectId: string, history: FramescaperProjectHistoryV28, options: Record<string, unknown> = {}) {
			validateFramescaperProjectHistoryV28(profile, history);
			return delegate.updateProjectHistory(projectId, history, options);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('V28 lock options must be a record.');
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) throw new TypeError('The V28 lock profile is internal.');
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The V28 lock force option must be an own boolean data property.');
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'force')) throw new TypeError('The V28 lock rejects authority overrides.');
	return { ...(force ? { force: force.value } : {}), projectStorageProfile: FRAMESCAPER_V28_PROJECT_STORAGE_PROFILE };
}

function selectedStoreOptions(value: AudioEditorProjectStoreOptions | unknown): AudioEditorProjectStoreOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Selected V28 store options must be a record.');
	for (const field of STORE_AUTHORITY_FIELDS) {
		if (Object.getOwnPropertyDescriptor(value, field)) throw new TypeError(`The selected V28 store rejects ${field} authority override.`);
	}
	return value as AudioEditorProjectStoreOptions;
}

function projectForRuntimeConsumers(
	profile: unknown,
	project: unknown,
): ReturnType<typeof framescaperProjectForRuntimeConsumersV28> | FramescaperOpaqueCustodyProjectV28 {
	return readFramescaperProjectSchemaVersion(project) === FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION
		? framescaperProjectForRuntimeConsumersV28(profile, project)
		: createFramescaperOpaqueCustodyConsumerProjectV28(project);
}

function projectForCommandConsumers(
	profile: unknown,
	project: unknown,
): ReturnType<typeof framescaperProjectForCommandConsumersV28> | FramescaperOpaqueCustodyProjectV28 {
	return readFramescaperProjectSchemaVersion(project) === FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION
		? framescaperProjectForCommandConsumersV28(profile, project)
		: createFramescaperOpaqueCustodyConsumerProjectV28(project);
}

function createHistory(
	profile: unknown,
	project: unknown,
): FramescaperProjectHistorySelectionV28 {
	if (readFramescaperProjectSchemaVersion(project) === FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION) {
		return createFramescaperProjectHistoryV28(profile, project);
	}
	const loaded = loadFramescaperProjectV28(profile, project);
	if (!loaded.intrinsicReadOnly) {
		throw new Error('Only an intrinsically read-only project may use opaque V28 custody history.');
	}
	return Object.freeze({
		limit: AUDIO_EDITOR_HISTORY_LIMIT,
		present: snapshotFramescaperOpaqueCustodyProjectV28(loaded.project),
		undoStack: Object.freeze([]),
		redoStack: Object.freeze([]),
	});
}

function writableHistory(
	history: FramescaperProjectHistorySelectionV28,
): FramescaperProjectHistoryV28 {
	if (history.present.schemaVersion !== FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION) {
		throw new Error('Opaque Framescaper project custody is read-only.');
	}
	return history as FramescaperProjectHistoryV28;
}

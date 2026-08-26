/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard, AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import { acquireProjectLock } from '../common/editor/project-lock.js';
import { createAudioEditorSessionController } from '../common/editor/session.js';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import { createStableId } from '../common/editor/stable-id.js';
import {
	createFramescaperProjectFeatureCompatibilityServiceV31,
} from './editor-project-feature-requirements-v31.ts';
import {
	createFramescaperOpaqueCustodyConsumerProjectV31,
	type FramescaperOpaqueCustodyConsumerProjectV31,
} from './editor-project-opaque-custody-v31.ts';
import {
	applyFramescaperProjectCommandV31,
	type FramescaperProjectCommandV31,
} from './editor-project-v31-commands.ts';
import {
	createFramescaperProjectHistoryV31,
	executeFramescaperProjectCommandV31,
	redoFramescaperProjectCommandV31,
	undoFramescaperProjectCommandV31,
	validateFramescaperProjectHistoryV31,
	type FramescaperProjectHistoryV31,
} from './editor-project-v31-history.ts';
import { migrateFramescaperProjectV31 } from './editor-project-v31-migration.ts';
import {
	framescaperProjectForCommandConsumersV31,
	framescaperProjectForEditClipboardConsumersV31,
	framescaperProjectForRuntimeConsumersV31,
} from './editor-project-v31-runtime.ts';
import {
	FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
	assertFramescaperProjectV31Profile,
} from './editor-project-runtime-profile-v31.ts';
import { FRAMESCAPER_V31_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v31.ts';
import { createFramescaperProjectStoreV31 } from './editor-project-store-v31.ts';
import {
	cloneFramescaperProjectV31,
	createFramescaperProjectV31,
	loadFramescaperProjectV31,
	reimportFramescaperProjectV31,
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
	type FramescaperProjectV31Options,
} from './editor-project-v31.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
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
import { prepareFramescaperVideoTransitionAllocationsV31 } from './editor-project-v31-transition-allocation.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v30.ts';
import { framescaperProjectV30FoundationShapeV31 } from './editor-project-v31-foundation.ts';

type LockFactory = (projectId: string, options?: Record<string, unknown>) => Promise<unknown>;
type SessionFactory = () => ReturnType<typeof createAudioEditorSessionController>;
interface FramescaperOpaqueCustodyHistoryV31 {
	readonly limit: number;
	readonly present: FramescaperOpaqueCustodyConsumerProjectV31;
	readonly undoStack: readonly never[];
	readonly redoStack: readonly never[];
}
type FramescaperProjectHistorySelectionV31 =
	| FramescaperProjectHistoryV31
	| FramescaperOpaqueCustodyHistoryV31;
const STORE_AUTHORITY_FIELDS = [
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
] as const;

export interface EditorProjectRuntimeV31Selection {
	readonly assistanceAssetCommands: true;
	readonly profile: typeof FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE;
	readonly storageProfile: typeof FRAMESCAPER_V31_PROJECT_STORAGE_PROFILE;
	readonly compatibility: ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceV31>;
	readonly createProject: (options?: FramescaperProjectV31Options) => FramescaperProjectV31;
	readonly cloneProject: (project: unknown) => FramescaperProjectV31;
	readonly validateProject: (project: unknown) => project is FramescaperProjectV31;
	readonly migrateProject: (project: unknown) => ReturnType<typeof migrateFramescaperProjectV31>;
	readonly reimportProject: (project: unknown) => FramescaperProjectV31;
	readonly projectForCommandConsumers: (project: unknown) => Readonly<Record<string, unknown>>;
	readonly projectForRuntimeConsumers: (project: unknown) => Readonly<Record<string, unknown>>;
	readonly projectForEditClipboardConsumers: (project: unknown) => Readonly<Record<string, unknown>>;
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
	) => FramescaperProjectCommandV31;
	readonly stageEditClipboardPasteBodies: (
		prepared: FramescaperSessionClipboardPasteV13,
		store: FramescaperImageClipboardBodyStoreV13,
		options?: Readonly<{ signal?: AbortSignal }>,
	) => Promise<FramescaperImageClipboardBodyStageV13>;
	readonly prepareEditClipboardDescriptor: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => AudioEditorClipboard;
	readonly createHistory: (project: unknown) => FramescaperProjectHistorySelectionV31;
	readonly applyCommand: (
		project: unknown,
		command: FramescaperProjectCommandV31,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectV31;
	readonly executeCommand: (
		history: FramescaperProjectHistorySelectionV31,
		command: FramescaperProjectCommandV31,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV31;
	readonly undo: (
		history: FramescaperProjectHistorySelectionV31,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV31;
	readonly redo: (
		history: FramescaperProjectHistorySelectionV31,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV31;
	readonly canUndo: (history: FramescaperProjectHistorySelectionV31) => boolean;
	readonly canRedo: (history: FramescaperProjectHistorySelectionV31) => boolean;
	readonly createSessionController: SessionFactory;
	readonly createProjectStore: (options?: AudioEditorProjectStoreOptions) => unknown;
	readonly acquireProjectLock: LockFactory;
}

/** Prepared exact-F31 document/session authority; route selection remains external. */
export function createEditorProjectRuntimeV31Selection(
	profile: unknown,
): Readonly<EditorProjectRuntimeV31Selection> {
	assertFramescaperProjectV31Profile(profile);
	const selection: EditorProjectRuntimeV31Selection = {
		assistanceAssetCommands: true,
		profile,
		storageProfile: FRAMESCAPER_V31_PROJECT_STORAGE_PROFILE,
		compatibility: createFramescaperProjectFeatureCompatibilityServiceV31(profile),
		createProject: (options = {}) => createFramescaperProjectV31(profile, options),
		cloneProject: (project) => cloneFramescaperProjectV31(profile, project),
		validateProject: (project): project is FramescaperProjectV31 => validateFramescaperProjectV31(profile, project),
		migrateProject: (project) => migrateFramescaperProjectV31(profile, project),
		reimportProject: (project) => reimportFramescaperProjectV31(profile, project),
		projectForCommandConsumers: (project) => projectForConsumers(profile, project, 'command'),
		projectForRuntimeConsumers: (project) => projectForConsumers(profile, project, 'runtime'),
		projectForEditClipboardConsumers: (project) => framescaperProjectForEditClipboardConsumersV31(
			profile, project,
		),
		createSessionClipboard: (project, descriptor) => createClipboard(project, descriptor),
		createEditSessionClipboard: (project, descriptor) => createClipboard(project, descriptor),
		prepareEditClipboardPaste: (project, clipboard, command, createId) => (
			prepareFramescaperSessionClipboardPasteV13(
				FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
				framescaperProjectV30FoundationShapeV31(project),
				clipboard,
				command,
				createId,
			)
		),
		prepareEditClipboardPasteCommand: (project, clipboard, command, createId) => (
			prepareFramescaperSessionClipboardPasteV13(
				FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
				framescaperProjectV30FoundationShapeV31(project),
				clipboard,
				command,
				createId,
			).command as FramescaperProjectCommandV31
		),
		stageEditClipboardPasteBodies: (prepared, store, options = {}) => (
			stageFramescaperSessionClipboardImageBodiesV13(
				prepared.bodyTransfers, store, options,
			)
		),
		prepareEditClipboardDescriptor: (project, descriptor) => createClipboard(project, descriptor).descriptor,
		createHistory: (project) => createHistory(profile, project),
		applyCommand: (project, command, options = {}) => applyFramescaperProjectCommandV31(
			profile,
			project,
			prepareFramescaperVideoTransitionAllocationsV31(profile, project, command, createStableId),
			options,
		),
		executeCommand: (history, command, options = {}) => {
			const writable = writableHistory(history);
			return executeFramescaperProjectCommandV31(
				profile,
				writable,
				prepareFramescaperVideoTransitionAllocationsV31(
					profile, writable.present, command, createStableId,
				),
				options,
			);
		},
		undo: (history, options = {}) => undoFramescaperProjectCommandV31(
			profile, writableHistory(history), options,
		),
		redo: (history, options = {}) => redoFramescaperProjectCommandV31(
			profile, writableHistory(history), options,
		),
		canUndo: (history) => history.undoStack.length > 0,
		canRedo: (history) => history.redoStack.length > 0,
		createSessionController(...args: unknown[]) {
			if (args.length !== 0) throw new TypeError('The prepared F31 session accepts no caller-owned options.');
			return createSelectedSession(profile);
		},
		createProjectStore: (options = {}) => createFramescaperProjectStoreV31(
			profile, selectedStoreOptions(options),
		),
		acquireProjectLock: (projectId, options = {}) => acquireProjectLock(
			projectId, profiledLockOptions(options),
		),
	};
	return Object.freeze(selection);
}

function createClipboard(
	project: unknown,
	descriptor: AudioEditorClipboard,
): FramescaperSessionClipboardV13 {
	return createFramescaperSessionClipboardV13(
		FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV30FoundationShapeV31(project),
		descriptor,
	);
}

function createSelectedSession(profile: unknown): ReturnType<typeof createAudioEditorSessionController> {
	const delegate = createAudioEditorSessionController({ currentSchemaVersion: 31 });
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = migrateFramescaperProjectV31(profile, project);
			return delegate.openProject(loaded.project, {
				...openOptions,
				readOnly: Boolean(openOptions.readOnly || loaded.intrinsicReadOnly),
				readOnlyReason: openOptions.readOnlyReason ?? loaded.reason,
			});
		},
		updateProject(projectId: string, update: unknown, updateOptions: Record<string, unknown> = {}) {
			return delegate.updateProject(projectId, (previous: unknown) => cloneFramescaperProjectV31(
				profile,
				typeof update === 'function' ? (update as (value: unknown) => unknown)(previous) : update,
			), updateOptions);
		},
		updateProjectHistory(projectId: string, history: FramescaperProjectHistoryV31, options: Record<string, unknown> = {}) {
			validateFramescaperProjectHistoryV31(profile, history);
			return delegate.updateProjectHistory(projectId, history, options);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function projectForConsumers(
	profile: unknown,
	project: unknown,
	kind: 'runtime' | 'command',
): Readonly<Record<string, unknown>> {
	return readFramescaperProjectSchemaVersion(project) === 31
		? kind === 'runtime'
			? framescaperProjectForRuntimeConsumersV31(profile, project)
			: framescaperProjectForCommandConsumersV31(profile, project)
		: createFramescaperOpaqueCustodyConsumerProjectV31(project);
}

function createHistory(profile: unknown, project: unknown): FramescaperProjectHistorySelectionV31 {
	if (readFramescaperProjectSchemaVersion(project) === 31) {
		return createFramescaperProjectHistoryV31(profile, project);
	}
	const loaded = loadFramescaperProjectV31(profile, project);
	if (!loaded.intrinsicReadOnly) {
		throw new Error('Only an intrinsically read-only project may use opaque F31 custody history.');
	}
	return Object.freeze({
		limit: AUDIO_EDITOR_HISTORY_LIMIT,
		present: createFramescaperOpaqueCustodyConsumerProjectV31(loaded.project),
		undoStack: Object.freeze([]),
		redoStack: Object.freeze([]),
	});
}

function writableHistory(
	history: FramescaperProjectHistorySelectionV31,
): FramescaperProjectHistoryV31 {
	if (!Object.hasOwn(history.present, 'assistanceAssets')) {
		throw new Error('Opaque Framescaper project custody is read-only.');
	}
	return history as FramescaperProjectHistoryV31;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('F31 lock options must be a record.');
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) throw new TypeError('The F31 lock profile is internal.');
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The F31 lock force option must be an own boolean data property.');
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'force')) throw new TypeError('F31 lock rejects authority overrides.');
	return { ...(force ? { force: force.value } : {}), projectStorageProfile: FRAMESCAPER_V31_PROJECT_STORAGE_PROFILE };
}

function selectedStoreOptions(value: AudioEditorProjectStoreOptions | unknown): AudioEditorProjectStoreOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Prepared F31 store options must be a record.');
	for (const field of STORE_AUTHORITY_FIELDS) {
		if (Object.getOwnPropertyDescriptor(value, field)) throw new TypeError(`Prepared F31 store rejects ${field} authority override.`);
	}
	return value as AudioEditorProjectStoreOptions;
}

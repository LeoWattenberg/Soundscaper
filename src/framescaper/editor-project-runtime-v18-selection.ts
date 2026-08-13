/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { acquireProjectLock } from '../common/editor/project-lock.js';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { createAudioEditorSessionController } from '../common/editor/session.js';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import {
	createFramescaperProjectFeatureCompatibilityServiceV18,
} from './editor-project-feature-requirements-v18.ts';
import { FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v18.ts';
import { createFramescaperProjectStoreV18 } from './editor-project-store-v18.ts';
import {
	applyFramescaperProjectCommandV18,
} from './editor-project-v18-commands.ts';
import {
	createFramescaperProjectHistoryV18,
	executeFramescaperProjectCommandV18,
	redoFramescaperProjectCommandV18,
	undoFramescaperProjectCommandV18,
	validateFramescaperProjectHistoryV18,
	type FramescaperProjectHistoryV18,
} from './editor-project-v18-history.ts';
import { migrateFramescaperProjectV18 } from './editor-project-v18-migration.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	framescaperProjectForCommandConsumersV18,
	framescaperProjectForRuntimeConsumersV18,
} from './editor-project-v18-runtime.ts';
import {
	cloneFramescaperProjectV18,
	createFramescaperProjectV18,
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
	type FramescaperProjectV18Options,
} from './editor-project-v18.ts';
import {
	FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION,
} from './editor-project-v18-validation.ts';

type LockFactory = (projectId: string, options?: Record<string, unknown>) => Promise<unknown>;
type SessionFactory = () => ReturnType<typeof createAudioEditorSessionController>;

const STORE_AUTHORITY_FIELDS = [
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
] as const;

export interface EditorProjectRuntimeV18Selection {
	readonly profile: EditorProjectRuntimeProfile;
	readonly storageProfile: typeof FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE;
	readonly compatibility: ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceV18>;
	readonly createProject: (options?: FramescaperProjectV18Options) => FramescaperProjectV18;
	readonly cloneProject: (project: unknown) => FramescaperProjectV18;
	readonly validateProject: (project: unknown) => project is FramescaperProjectV18;
	readonly migrateProject: (project: unknown) => ReturnType<typeof migrateFramescaperProjectV18>;
	readonly projectForCommandConsumers: (project: unknown) => FramescaperProjectV18;
	readonly projectForRuntimeConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForRuntimeConsumersV18>;
	readonly createHistory: (project: unknown) => FramescaperProjectHistoryV18;
	readonly applyCommand: (
		project: unknown,
		command: AudioEditorCommand,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectV18;
	readonly executeCommand: (
		history: FramescaperProjectHistoryV18,
		command: AudioEditorCommand,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV18;
	readonly undo: (
		history: FramescaperProjectHistoryV18,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV18;
	readonly redo: (
		history: FramescaperProjectHistoryV18,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV18;
	readonly canUndo: (history: FramescaperProjectHistoryV18) => boolean;
	readonly canRedo: (history: FramescaperProjectHistoryV18) => boolean;
	readonly createSessionController: SessionFactory;
	readonly createProjectStore: (options?: AudioEditorProjectStoreOptions) => unknown;
	readonly acquireProjectLock: LockFactory;
}

/**
 * Resolve every already-authorized V18 domain choice behind one exact product
 * authority. Importing individual foundations does not activate Framescaper;
 * the UI bootstrap selects only this closed composition.
 */
export function createEditorProjectRuntimeV18Selection(
	profile: EditorProjectRuntimeProfile | unknown,
): Readonly<EditorProjectRuntimeV18Selection> {
	assertFramescaperProjectV18Profile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV18(profile);

	const selection: EditorProjectRuntimeV18Selection = {
		profile,
		storageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
		compatibility,
		createProject: (options = {}) => createFramescaperProjectV18(profile, options),
		cloneProject: (project) => cloneFramescaperProjectV18(profile, project),
		validateProject: (project): project is FramescaperProjectV18 => (
			validateFramescaperProjectV18(profile, project)
		),
		migrateProject: (project) => migrateFramescaperProjectV18(profile, project),
		projectForCommandConsumers: (project) => (
			framescaperProjectForCommandConsumersV18(profile, project)
		),
		projectForRuntimeConsumers: (project) => (
			framescaperProjectForRuntimeConsumersV18(profile, project)
		),
		createHistory: (project) => createFramescaperProjectHistoryV18(profile, project),
		applyCommand: (project, command, options = {}) => (
			applyFramescaperProjectCommandV18(profile, project, command, options)
		),
		executeCommand: (history, command, options = {}) => (
			executeFramescaperProjectCommandV18(profile, history, command, options)
		),
		undo: (history, options = {}) => undoFramescaperProjectCommandV18(profile, history, options),
		redo: (history, options = {}) => redoFramescaperProjectCommandV18(profile, history, options),
		canUndo: (history) => history.undoStack.length > 0,
		canRedo: (history) => history.redoStack.length > 0,
		createSessionController(...args: unknown[]) {
			if (args.length !== 0) {
				throw new TypeError('The selected V18 session does not accept caller-owned session options.');
			}
			return createSelectedSession(profile, createAudioEditorSessionController);
		},
		createProjectStore: (options = {}) => createFramescaperProjectStoreV18(
			profile,
			selectedStoreOptions(options),
		),
		acquireProjectLock: (projectId, options = {}) => acquireProjectLock(
			projectId,
			profiledLockOptions(options),
		),
	};
	return Object.freeze(selection);
}

function createSelectedSession(
	profile: EditorProjectRuntimeProfile,
	createSession: typeof createAudioEditorSessionController,
): ReturnType<typeof createAudioEditorSessionController> {
	const delegate = createSession({
		currentSchemaVersion: FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION,
	});
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = migrateFramescaperProjectV18(profile, project);
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
				return cloneFramescaperProjectV18(profile, candidate);
			}, updateOptions);
		},
		updateProjectHistory(
			projectId: string,
			history: FramescaperProjectHistoryV18,
			updateOptions: Record<string, unknown> = {},
		) {
			validateFramescaperProjectHistoryV18(profile, history);
			return delegate.updateProjectHistory(projectId, history, updateOptions);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V18 project lock options must be a record.');
	}
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) {
		throw new TypeError('The selected V18 lock profile is internal and rejects authority overrides.');
	}
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The selected V18 lock force option must be an own boolean data property.');
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'force')) {
		throw new TypeError('The selected V18 lock accepts no environment or callback authority overrides.');
	}
	return {
		...(force ? { force: force.value } : {}),
		projectStorageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
	};
}

function selectedStoreOptions(value: AudioEditorProjectStoreOptions | unknown): AudioEditorProjectStoreOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Selected V18 store options must be a record.');
	}
	for (const field of STORE_AUTHORITY_FIELDS) {
		if (Object.getOwnPropertyDescriptor(value, field)) {
			throw new TypeError(`The selected V18 store rejects the ${field} authority override.`);
		}
	}
	return value as AudioEditorProjectStoreOptions;
}

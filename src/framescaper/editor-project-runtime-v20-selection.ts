/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard } from '../common/editor/commands/protocol.ts';
import { acquireProjectLock } from '../common/editor/project-lock.js';
import { createAudioEditorSessionController } from '../common/editor/session.js';
import {
	createAudioEditorSessionClipboard,
} from '../common/editor/session-clipboard-codec.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import {
	createFramescaperProjectFeatureCompatibilityServiceV20,
} from './editor-project-feature-requirements-v20.ts';
import { FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v20.ts';
import { createFramescaperProjectStoreV20 } from './editor-project-store-v20.ts';
import {
	applyFramescaperProjectCommandV20,
	type FramescaperProjectCommandV20,
} from './editor-project-v20-commands.ts';
import {
	createFramescaperProjectHistoryV20,
	executeFramescaperProjectCommandV20,
	redoFramescaperProjectCommandV20,
	undoFramescaperProjectCommandV20,
	validateFramescaperProjectHistoryV20,
	type FramescaperProjectHistoryV20,
} from './editor-project-v20-history.ts';
import { migrateFramescaperProjectV20 } from './editor-project-v20-migration.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import {
	framescaperProjectForCommandConsumersV20,
	framescaperProjectForRuntimeConsumersV20,
} from './editor-project-v20-runtime.ts';
import {
	cloneFramescaperProjectV20,
	createFramescaperProjectV20,
	FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION,
	type FramescaperProjectV20,
	type FramescaperProjectV20Options,
} from './editor-project-v20.ts';
import { validateFramescaperProjectV20 } from './editor-project-v20-validation.ts';

type LockFactory = (projectId: string, options?: Record<string, unknown>) => Promise<unknown>;
type SessionFactory = () => ReturnType<typeof createAudioEditorSessionController>;

const STORE_AUTHORITY_FIELDS = [
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
] as const;

export interface EditorProjectRuntimeV20Selection {
	readonly profile: FramescaperProjectV20Profile;
	readonly storageProfile: typeof FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE;
	readonly compatibility: ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceV20>;
	readonly createProject: (options?: FramescaperProjectV20Options) => FramescaperProjectV20;
	readonly cloneProject: (project: unknown) => FramescaperProjectV20;
	readonly validateProject: (project: unknown) => project is FramescaperProjectV20;
	readonly migrateProject: (project: unknown) => ReturnType<typeof migrateFramescaperProjectV20>;
	readonly projectForCommandConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForCommandConsumersV20>;
	readonly projectForRuntimeConsumers: (
		project: unknown,
	) => ReturnType<typeof framescaperProjectForRuntimeConsumersV20>;
	readonly prepareEditClipboardDescriptor: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => AudioEditorClipboard;
	readonly createHistory: (project: unknown) => FramescaperProjectHistoryV20;
	readonly applyCommand: (
		project: unknown,
		command: FramescaperProjectCommandV20,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectV20;
	readonly executeCommand: (
		history: FramescaperProjectHistoryV20,
		command: FramescaperProjectCommandV20,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV20;
	readonly undo: (
		history: FramescaperProjectHistoryV20,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV20;
	readonly redo: (
		history: FramescaperProjectHistoryV20,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV20;
	readonly canUndo: (history: FramescaperProjectHistoryV20) => boolean;
	readonly canRedo: (history: FramescaperProjectHistoryV20) => boolean;
	readonly createSessionController: SessionFactory;
	readonly createProjectStore: (options?: AudioEditorProjectStoreOptions) => unknown;
	readonly acquireProjectLock: LockFactory;
}

/**
 * Compose the complete V20 authority for qualification. Construction alone
 * does not select a browser or packaged product route.
 */
export function createEditorProjectRuntimeV20Selection(
	profile: FramescaperProjectV20Profile | unknown,
): Readonly<EditorProjectRuntimeV20Selection> {
	assertFramescaperProjectV20Profile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV20(profile);
	const selection: EditorProjectRuntimeV20Selection = {
		profile,
		storageProfile: FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE,
		compatibility,
		createProject: (options = {}) => createFramescaperProjectV20(profile, options),
		cloneProject: (project) => cloneFramescaperProjectV20(profile, project),
		validateProject: (project): project is FramescaperProjectV20 => (
			validateFramescaperProjectV20(profile, project)
		),
		migrateProject: (project) => migrateFramescaperProjectV20(profile, project),
		projectForCommandConsumers: (project) => framescaperProjectForCommandConsumersV20(profile, project),
		projectForRuntimeConsumers: (project) => framescaperProjectForRuntimeConsumersV20(profile, project),
		prepareEditClipboardDescriptor: (project, descriptor) => createAudioEditorSessionClipboard(
			framescaperProjectForCommandConsumersV20(profile, project),
			{ descriptor },
		).descriptor,
		createHistory: (project) => createFramescaperProjectHistoryV20(profile, project),
		applyCommand: (project, command, options = {}) => (
			applyFramescaperProjectCommandV20(profile, project, command, options)
		),
		executeCommand: (history, command, options = {}) => (
			executeFramescaperProjectCommandV20(profile, history, command, options)
		),
		undo: (history, options = {}) => undoFramescaperProjectCommandV20(profile, history, options),
		redo: (history, options = {}) => redoFramescaperProjectCommandV20(profile, history, options),
		canUndo: (history) => history.undoStack.length > 0,
		canRedo: (history) => history.redoStack.length > 0,
		createSessionController(...args: unknown[]) {
			if (args.length !== 0) {
				throw new TypeError('The V20 qualification session does not accept caller-owned options.');
			}
			return createSelectedSession(profile);
		},
		createProjectStore: (options = {}) => createFramescaperProjectStoreV20(
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
	profile: FramescaperProjectV20Profile,
): ReturnType<typeof createAudioEditorSessionController> {
	const delegate = createAudioEditorSessionController({
		currentSchemaVersion: FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION,
	});
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = migrateFramescaperProjectV20(profile, project);
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
				return cloneFramescaperProjectV20(profile, candidate);
			}, updateOptions);
		},
		updateProjectHistory(
			projectId: string,
			history: FramescaperProjectHistoryV20,
			updateOptions: Record<string, unknown> = {},
		) {
			validateFramescaperProjectHistoryV20(profile, history);
			return delegate.updateProjectHistory(projectId, history, updateOptions);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V20 project lock options must be a record.');
	}
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) {
		throw new TypeError('The V20 lock profile is internal and rejects authority overrides.');
	}
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The V20 lock force option must be an own boolean data property.');
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'force')) {
		throw new TypeError('The V20 lock accepts no environment or callback authority overrides.');
	}
	return {
		...(force ? { force: force.value } : {}),
		projectStorageProfile: FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE,
	};
}

function selectedStoreOptions(value: AudioEditorProjectStoreOptions | unknown): AudioEditorProjectStoreOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('V20 qualification store options must be a record.');
	}
	for (const field of STORE_AUTHORITY_FIELDS) {
		if (Object.getOwnPropertyDescriptor(value, field)) {
			throw new TypeError(`The V20 qualification store rejects the ${field} authority override.`);
		}
	}
	return value as AudioEditorProjectStoreOptions;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { acquireProjectLock } from '../common/editor/project-lock.js';
import type { AudioEditorClipboard } from '../common/editor/commands/protocol.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { createAudioEditorSessionController } from '../common/editor/session.js';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import {
	createFramescaperProjectFeatureCompatibilityServiceV19,
} from './editor-project-feature-requirements-v19.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';
import { createFramescaperSessionClipboardV18 } from './editor-project-v18-interchange.ts';
import {
	framescaperProjectForCommandConsumersV18,
} from './editor-project-v18-runtime.ts';
import {
	FRAMESCAPER_V19_PROJECT_STORAGE_PROFILE,
} from './editor-project-storage-profile-v19.ts';
import { createFramescaperProjectStoreV19 } from './editor-project-store-v19.ts';
import {
	applyFramescaperProjectCommandV19,
	type FramescaperProjectCommandV19,
} from './editor-project-v19-commands.ts';
import {
	createFramescaperProjectHistoryV19,
	executeFramescaperProjectCommandV19,
	redoFramescaperProjectCommandV19,
	undoFramescaperProjectCommandV19,
	validateFramescaperProjectHistoryV19,
	type FramescaperProjectHistoryV19,
} from './editor-project-v19-history.ts';
import { migrateFramescaperProjectV19 } from './editor-project-v19-migration.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';
import {
	framescaperProjectForRuntimeConsumersV19,
} from './editor-project-v19-runtime.ts';
import {
	cloneFramescaperProjectV19,
	createFramescaperProjectV19,
	validateFramescaperProjectV19,
	type FramescaperProjectV19,
	type FramescaperProjectV19Options,
} from './editor-project-v19.ts';
import {
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	framescaperProjectV18FoundationV19,
} from './editor-project-v19-validation.ts';

type LockFactory = (projectId: string, options?: Record<string, unknown>) => Promise<unknown>;
type SessionFactory = () => ReturnType<typeof createAudioEditorSessionController>;

const STORE_AUTHORITY_FIELDS = [
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
] as const;

export interface EditorProjectRuntimeV19Selection {
	readonly profile: EditorProjectRuntimeProfile;
	readonly storageProfile: typeof FRAMESCAPER_V19_PROJECT_STORAGE_PROFILE;
	readonly compatibility: ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceV19>;
	readonly createProject: (options?: FramescaperProjectV19Options) => FramescaperProjectV19;
	readonly cloneProject: (project: unknown) => FramescaperProjectV19;
	readonly validateProject: (project: unknown) => project is FramescaperProjectV19;
	readonly migrateProject: (project: unknown) => ReturnType<typeof migrateFramescaperProjectV19>;
	readonly projectForCommandConsumers: (project: unknown) => ReturnType<typeof framescaperProjectForCommandConsumersV18>;
	readonly projectForRuntimeConsumers: (project: unknown) => ReturnType<typeof framescaperProjectForRuntimeConsumersV19>;
	readonly prepareEditClipboardDescriptor: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => AudioEditorClipboard;
	readonly createHistory: (project: unknown) => FramescaperProjectHistoryV19;
	readonly applyCommand: (
		project: unknown,
		command: FramescaperProjectCommandV19,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectV19;
	readonly executeCommand: (
		history: FramescaperProjectHistoryV19,
		command: FramescaperProjectCommandV19,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV19;
	readonly undo: (
		history: FramescaperProjectHistoryV19,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV19;
	readonly redo: (
		history: FramescaperProjectHistoryV19,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistoryV19;
	readonly canUndo: (history: FramescaperProjectHistoryV19) => boolean;
	readonly canRedo: (history: FramescaperProjectHistoryV19) => boolean;
	readonly createSessionController: SessionFactory;
	readonly createProjectStore: (options?: AudioEditorProjectStoreOptions) => unknown;
	readonly acquireProjectLock: LockFactory;
}

/** Select the complete exact-V19 domain, persistence, history, and runtime boundary. */
export function createEditorProjectRuntimeV19Selection(
	profile: EditorProjectRuntimeProfile | unknown,
): Readonly<EditorProjectRuntimeV19Selection> {
	assertFramescaperProjectV19Profile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV19(profile);
	const selection: EditorProjectRuntimeV19Selection = {
		profile,
		storageProfile: FRAMESCAPER_V19_PROJECT_STORAGE_PROFILE,
		compatibility,
		createProject: (options = {}) => createFramescaperProjectV19(profile, options),
		cloneProject: (project) => cloneFramescaperProjectV19(profile, project),
		validateProject: (project): project is FramescaperProjectV19 => (
			validateFramescaperProjectV19(profile, project)
		),
		migrateProject: (project) => migrateFramescaperProjectV19(profile, project),
		projectForCommandConsumers: (project) => framescaperProjectForCommandConsumersV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV18FoundationV19(profile, project, { retainComposition: true }),
		),
		projectForRuntimeConsumers: (project) => framescaperProjectForRuntimeConsumersV19(profile, project),
		// Through the V18 clipboard, not the shared one directly: the session
		// descriptor has no ownership of a nested-sequence or multicamera graph, so
		// a copy that contains one has to fail where it is made rather than where it
		// is pasted. Inheriting the projection without the guard let the shipped web
		// build accept such a copy and refuse it later.
		prepareEditClipboardDescriptor: (project, descriptor) => createFramescaperSessionClipboardV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			framescaperProjectV18FoundationV19(profile, project, { retainComposition: true }),
			{ descriptor },
		).descriptor,
		createHistory: (project) => createFramescaperProjectHistoryV19(profile, project),
		applyCommand: (project, command, options = {}) => (
			applyFramescaperProjectCommandV19(profile, project, command, options)
		),
		executeCommand: (history, command, options = {}) => (
			executeFramescaperProjectCommandV19(profile, history, command, options)
		),
		undo: (history, options = {}) => undoFramescaperProjectCommandV19(profile, history, options),
		redo: (history, options = {}) => redoFramescaperProjectCommandV19(profile, history, options),
		canUndo: (history) => history.undoStack.length > 0,
		canRedo: (history) => history.redoStack.length > 0,
		createSessionController(...args: unknown[]) {
			if (args.length !== 0) {
				throw new TypeError('The selected V19 session does not accept caller-owned session options.');
			}
			return createSelectedSession(profile, createAudioEditorSessionController);
		},
		createProjectStore: (options = {}) => createFramescaperProjectStoreV19(
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
	const delegate = createSession({ currentSchemaVersion: FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION });
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = migrateFramescaperProjectV19(profile, project);
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
				return cloneFramescaperProjectV19(profile, candidate);
			}, updateOptions);
		},
		updateProjectHistory(
			projectId: string,
			history: FramescaperProjectHistoryV19,
			updateOptions: Record<string, unknown> = {},
		) {
			validateFramescaperProjectHistoryV19(profile, history);
			return delegate.updateProjectHistory(projectId, history, updateOptions);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V19 project lock options must be a record.');
	}
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) {
		throw new TypeError('The selected V19 lock profile is internal and rejects authority overrides.');
	}
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The selected V19 lock force option must be an own boolean data property.');
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'force')) {
		throw new TypeError('The selected V19 lock accepts no environment or callback authority overrides.');
	}
	return {
		...(force ? { force: force.value } : {}),
		projectStorageProfile: FRAMESCAPER_V19_PROJECT_STORAGE_PROFILE,
	};
}

function selectedStoreOptions(value: AudioEditorProjectStoreOptions | unknown): AudioEditorProjectStoreOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Selected V19 store options must be a record.');
	}
	for (const field of STORE_AUTHORITY_FIELDS) {
		if (Object.getOwnPropertyDescriptor(value, field)) {
			throw new TypeError(`The selected V19 store rejects the ${field} authority override.`);
		}
	}
	return value as AudioEditorProjectStoreOptions;
}

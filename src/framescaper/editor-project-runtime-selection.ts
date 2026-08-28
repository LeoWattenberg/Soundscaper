/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard, AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import { acquireProjectLock } from '../common/editor/project-lock.js';
import { createAudioEditorProjectV17 } from '../common/editor/project-v17.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	classifyProjectSchemaIdentity,
} from '../common/editor/project-schema-identity.ts';
import { createAudioEditorSessionController } from '../common/editor/session.js';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import { createStableId } from '../common/editor/stable-id.js';
import {
	createFramescaperProjectFeatureCompatibilityService,
} from './editor-project-feature-requirements.ts';
import {
	applyFramescaperProjectCommand,
	prepareFramescaperVideoTransitionAllocations,
	type FramescaperProjectCommand,
} from './editor-project-commands.ts';
import {
	createFramescaperProjectHistory,
	executeFramescaperProjectCommand,
	redoFramescaperProjectCommand,
	undoFramescaperProjectCommand,
	validateFramescaperProjectHistory,
	type FramescaperProjectHistory,
} from './editor-project-history.ts';
import {
	framescaperProjectForCommandConsumers,
	framescaperProjectForEditClipboardConsumers,
	framescaperProjectForRuntimeConsumers,
} from './editor-project-runtime.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
	assertFramescaperProjectRuntimeProfile,
} from './editor-project-runtime-profile.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile.ts';
import { createFramescaperProjectStore } from './editor-project-store.ts';
import {
	cloneFramescaperProject,
	createFramescaperProject,
	loadFramescaperProject,
	type FramescaperProject,
	type FramescaperProjectOptions,
} from './editor-project.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
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
interface FramescaperOpaqueCustodyHistory {
	readonly limit: number;
	readonly present: Readonly<Record<string, unknown>>;
	readonly undoStack: readonly never[];
	readonly redoStack: readonly never[];
}
type FramescaperProjectHistorySelection = FramescaperProjectHistory | FramescaperOpaqueCustodyHistory;
const STORE_AUTHORITY_FIELDS = [
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge',
] as const;

export interface EditorProjectRuntimeSelection {
	readonly assistanceAssetCommands: true;
	readonly profile: typeof FRAMESCAPER_PROJECT_RUNTIME_PROFILE;
	readonly storageProfile: typeof FRAMESCAPER_PROJECT_STORAGE_PROFILE;
	readonly compatibility: ReturnType<typeof createFramescaperProjectFeatureCompatibilityService>;
	readonly createProject: (options?: FramescaperProjectOptions) => FramescaperProject;
	readonly cloneProject: (project: unknown) => FramescaperProject;
	readonly loadProject: (project: unknown) => ReturnType<typeof loadFramescaperProject>;
	readonly validateProject: (project: unknown) => project is FramescaperProject;
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
	) => FramescaperProjectCommand;
	readonly stageEditClipboardPasteBodies: (
		prepared: FramescaperSessionClipboardPasteV13,
		store: FramescaperImageClipboardBodyStoreV13,
		options?: Readonly<{ signal?: AbortSignal }>,
	) => Promise<FramescaperImageClipboardBodyStageV13>;
	readonly prepareEditClipboardDescriptor: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => AudioEditorClipboard;
	readonly createHistory: (project: unknown) => FramescaperProjectHistorySelection;
	readonly applyCommand: (
		project: unknown,
		command: FramescaperProjectCommand,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProject;
	readonly executeCommand: (
		history: FramescaperProjectHistorySelection,
		command: FramescaperProjectCommand,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistory;
	readonly undo: (
		history: FramescaperProjectHistorySelection,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistory;
	readonly redo: (
		history: FramescaperProjectHistorySelection,
		options?: Readonly<{ now?: Date | string }>,
	) => FramescaperProjectHistory;
	readonly canUndo: (history: FramescaperProjectHistorySelection) => boolean;
	readonly canRedo: (history: FramescaperProjectHistorySelection) => boolean;
	readonly createSessionController: SessionFactory;
	readonly createProjectStore: (options?: AudioEditorProjectStoreOptions) => unknown;
	readonly acquireProjectLock: LockFactory;
}

export function createEditorProjectRuntimeSelection(
	profile: unknown,
): Readonly<EditorProjectRuntimeSelection> {
	assertFramescaperProjectRuntimeProfile(profile);
	const selection: EditorProjectRuntimeSelection = {
		assistanceAssetCommands: true,
		profile,
		storageProfile: FRAMESCAPER_PROJECT_STORAGE_PROFILE,
		compatibility: createFramescaperProjectFeatureCompatibilityService(profile),
		createProject: (options = {}) => createFramescaperProject(profile, options),
		cloneProject: (project) => cloneFramescaperProject(profile, project),
		loadProject: (project) => loadFramescaperProject(profile, project),
		validateProject: (project): project is FramescaperProject => {
			try { cloneFramescaperProject(profile, project); return true; } catch { return false; }
		},
		projectForCommandConsumers: (project) => projectForConsumers(profile, project, 'command'),
		projectForRuntimeConsumers: (project) => projectForConsumers(profile, project, 'runtime'),
		projectForEditClipboardConsumers: (project) => framescaperProjectForEditClipboardConsumers(
			profile, project,
		),
		createSessionClipboard: (project, descriptor) => createClipboard(project, descriptor),
		createEditSessionClipboard: (project, descriptor) => createClipboard(project, descriptor),
		prepareEditClipboardPaste: (project, clipboard, command, createId) => (
			prepareFramescaperSessionClipboardPasteV13(
				FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
				legacyImageFoundation(project),
				clipboard,
				command,
				createId,
			)
		),
		prepareEditClipboardPasteCommand: (project, clipboard, command, createId) => (
			prepareFramescaperSessionClipboardPasteV13(
				FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
				legacyImageFoundation(project),
				clipboard,
				command,
				createId,
			).command as FramescaperProjectCommand
		),
		stageEditClipboardPasteBodies: (prepared, store, options = {}) => (
			stageFramescaperSessionClipboardImageBodiesV13(prepared.bodyTransfers, store, options)
		),
		prepareEditClipboardDescriptor: (project, descriptor) => createClipboard(project, descriptor).descriptor,
		createHistory: (project) => createHistory(profile, project),
		applyCommand: (project, command, options = {}) => applyFramescaperProjectCommand(
			profile,
			project,
			prepareFramescaperVideoTransitionAllocations(profile, project, command, createStableId),
			options,
		),
		executeCommand: (history, command, options = {}) => {
			const writable = writableHistory(history);
			return executeFramescaperProjectCommand(
				profile,
				writable,
				prepareFramescaperVideoTransitionAllocations(
					profile, writable.present, command, createStableId,
				),
				options,
			);
		},
		undo: (history, options = {}) => undoFramescaperProjectCommand(
			profile, writableHistory(history), options,
		),
		redo: (history, options = {}) => redoFramescaperProjectCommand(
			profile, writableHistory(history), options,
		),
		canUndo: (history) => history.undoStack.length > 0,
		canRedo: (history) => history.redoStack.length > 0,
		createSessionController(...args: unknown[]) {
			if (args.length !== 0) throw new TypeError('The prepared Framescaper session accepts no options.');
			return createSelectedSession(profile);
		},
		createProjectStore: (options = {}) => createFramescaperProjectStore(
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
		FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
		legacyImageFoundation(project),
		descriptor,
	);
}

function legacyImageFoundation(project: unknown) {
	return framescaperProjectTimelineImageFoundationShapeAssistance(project);
}

function createSelectedSession(profile: unknown): ReturnType<typeof createAudioEditorSessionController> {
	const delegate = createAudioEditorSessionController({ currentSchemaVersion: 1 });
	return Object.freeze({
		...delegate,
		openProject(project: unknown, openOptions: Record<string, unknown> = {}) {
			const loaded = loadFramescaperProject(profile, project);
			const consumer = loaded.intrinsicReadOnly
				? createOpaqueCustodyConsumer(loaded.project)
				: loaded.project;
			return delegate.openProject(consumer, {
				...openOptions,
				readOnly: Boolean(openOptions.readOnly || loaded.intrinsicReadOnly),
				readOnlyReason: openOptions.readOnlyReason ?? loaded.reason,
			});
		},
		updateProject(projectId: string, update: unknown, updateOptions: Record<string, unknown> = {}) {
			return delegate.updateProject(projectId, (previous: unknown) => cloneFramescaperProject(
				profile,
				typeof update === 'function' ? (update as (value: unknown) => unknown)(previous) : update,
			), updateOptions);
		},
		updateProjectHistory(
			projectId: string,
			history: FramescaperProjectHistory,
			options: Record<string, unknown> = {},
		) {
			validateFramescaperProjectHistory(profile, history);
			return delegate.updateProjectHistory(projectId, history, options);
		},
	}) as ReturnType<typeof createAudioEditorSessionController>;
}

function projectForConsumers(
	profile: unknown,
	project: unknown,
	kind: 'runtime' | 'command',
): Readonly<Record<string, unknown>> {
	const classification = classifyProjectSchemaIdentity(project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY);
	if (classification.disposition !== 'current') return createOpaqueCustodyConsumer(project);
	return kind === 'runtime'
		? framescaperProjectForRuntimeConsumers(profile, project)
		: framescaperProjectForCommandConsumers(profile, project);
}

function createHistory(profile: unknown, project: unknown): FramescaperProjectHistorySelection {
	const loaded = loadFramescaperProject(profile, project);
	if (!loaded.intrinsicReadOnly) return createFramescaperProjectHistory(profile, loaded.project);
	return Object.freeze({
		limit: AUDIO_EDITOR_HISTORY_LIMIT,
		present: createOpaqueCustodyConsumer(loaded.project),
		undoStack: Object.freeze([]),
		redoStack: Object.freeze([]),
	});
}

function writableHistory(history: FramescaperProjectHistorySelection): FramescaperProjectHistory {
	if (classifyProjectSchemaIdentity(
		history.present,
		FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	).disposition !== 'current') {
		throw new Error('Opaque Framescaper project custody is read-only.');
	}
	return history as FramescaperProjectHistory;
}

function createOpaqueCustodyConsumer(value: unknown): Readonly<Record<string, unknown>> {
	const classification = classifyProjectSchemaIdentity(value, FRAMESCAPER_PROJECT_SCHEMA_FAMILY);
	const project = value as object;
	const id = envelopeString(project, 'id', 'foreign-project');
	const title = envelopeString(project, 'title', 'Read-only project');
	const sampleRate = envelopeSampleRate(project);
	const shell = createAudioEditorProjectV17({
		id,
		title,
		sampleRate,
		now: '1970-01-01T00:00:00.000Z',
		updatedAt: '1970-01-01T00:00:00.000Z',
		sources: [], clips: [], tracks: [],
	}) as unknown as Record<string, unknown>;
	shell.schemaFamily = classification.identity.schemaFamily;
	shell.schemaVersion = classification.identity.schemaVersion;
	shell.sources = Object.freeze([]);
	shell.clips = Object.freeze([]);
	shell.tracks = Object.freeze([]);
	shell.automationLanes = Object.freeze([]);
	return Object.freeze(shell);
}

function envelopeString(value: object, field: string, fallback: string): string {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& typeof descriptor.value === 'string' && descriptor.value.trim()
		? descriptor.value : fallback;
}

function envelopeSampleRate(value: object): number {
	const descriptor = Object.getOwnPropertyDescriptor(value, 'sampleRate');
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& Number.isSafeInteger(descriptor.value)
		&& Number(descriptor.value) >= 8_000 && Number(descriptor.value) <= 384_000
		? Number(descriptor.value) : 48_000;
}

function profiledLockOptions(value: Record<string, unknown>): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper lock options must be a record.');
	}
	if (Object.getOwnPropertyDescriptor(value, 'projectStorageProfile')) {
		throw new TypeError('The Framescaper lock profile is internal.');
	}
	const force = Object.getOwnPropertyDescriptor(value, 'force');
	if (force && (!force.enumerable || !Object.hasOwn(force, 'value') || typeof force.value !== 'boolean')) {
		throw new TypeError('The Framescaper lock force option must be an own boolean data property.');
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'force')) {
		throw new TypeError('Framescaper lock rejects authority overrides.');
	}
	return {
		...(force ? { force: force.value } : {}),
		projectStorageProfile: FRAMESCAPER_PROJECT_STORAGE_PROFILE,
	};
}

function selectedStoreOptions(value: AudioEditorProjectStoreOptions | unknown): AudioEditorProjectStoreOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Prepared Framescaper store options must be a record.');
	}
	for (const field of STORE_AUTHORITY_FIELDS) {
		if (Object.getOwnPropertyDescriptor(value, field)) {
			throw new TypeError(`Prepared Framescaper store rejects ${field} authority override.`);
		}
	}
	return value as AudioEditorProjectStoreOptions;
}

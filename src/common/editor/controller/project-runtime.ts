/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MacroTransactionMetadata } from './macro-transaction-metadata.ts';

import type { AudioEditorClipboard, AudioEditorCommand } from '../commands/protocol.ts';
import { applyEditorCommand } from '../commands.js';
import {
	AUDIO_EDITOR_HISTORY_LIMIT,
	canRedo,
	canUndo,
	collapseEditorHistory,
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	rollbackEditorHistory,
	undoEditorCommand,
} from '../history.js';
import { cloneProject } from '../project.js';
import {
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
} from '../project-current.ts';
import { projectForCommandConsumers, projectForRuntimeConsumers } from '../project-current-runtime.ts';
import { createOpaqueProjectConsumer } from '../project-opaque-consumer.ts';
import { validateAudioEditorProjectV17 } from '../project-v17-validation.ts';
import { AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION } from '../project-schema-version.ts';

const METHOD_NAMES = [
	'createProject', 'cloneProject', 'projectForCommandConsumers',
	'projectForRuntimeConsumers', 'prepareEditClipboardDescriptor',
	'createHistory', 'executeCommand', 'applyCommand', 'undo', 'redo', 'canUndo', 'canRedo',
] as const;

/**
 * Capabilities a runtime may carry but need not.
 *
 * Only a product that runs macros folds history, and the capability is fenced
 * long before a transaction could open — so a runtime without these is complete,
 * and one with them keeps them rather than having them snapshotted away.
 */
const OPTIONAL_METHOD_NAMES = ['collapseHistory', 'rollbackHistory', 'validateProject'] as const;

export interface ControllerRuntimeProject extends Record<string, unknown> {
	readonly id: string;
	readonly schemaVersion: number;
}

export interface ControllerRuntimeHistoryEntry<Project extends ControllerRuntimeProject = ControllerRuntimeProject> {
	readonly project: Project;
}

export interface ControllerRuntimeHistory<Project extends ControllerRuntimeProject = ControllerRuntimeProject> {
	readonly present: Project;
	readonly undoStack: readonly ControllerRuntimeHistoryEntry<Project>[];
	readonly redoStack: readonly ControllerRuntimeHistoryEntry<Project>[];
	/**
	 * Where the playhead belongs for the present document, for a history that
	 * keeps it: undo and redo restore it alongside the document.
	 */
	readonly playheadFrame?: number;
}

/**
 * What a command is told about the moment it runs.
 *
 * The playhead travels with the command because undo restores the position the
 * person left as well as the document, and only the controller can see where
 * the transport actually is.
 */
export interface ControllerRuntimeCommandOptions {
	readonly now?: Date | string;
	readonly playheadFrame?: number;
}

export interface ControllerTrackDuplicateEffectMapping {
	readonly sourceId: string;
	readonly targetId: string;
}

export interface ControllerTrackDuplicateRequest {
	readonly sourceTrackId: string;
	readonly targetTrackId: string;
	readonly effectIds: readonly Readonly<ControllerTrackDuplicateEffectMapping>[];
}

export interface ControllerTrackDuplicateCarrier {
	readonly sourceTrackId: string;
	readonly effectIds: readonly Readonly<ControllerTrackDuplicateEffectMapping>[];
}

export interface ControllerEditSessionClipboardCarrier {
	readonly descriptor: AudioEditorClipboard;
	readonly sources?: readonly Readonly<{ readonly id: string }>[];
	readonly originProjectId?: string;
}

export interface ControllerProjectRuntime<
	Project extends ControllerRuntimeProject = ControllerRuntimeProject,
	History extends ControllerRuntimeHistory<Project> = ControllerRuntimeHistory<Project>,
	LoadedProject = Project,
	ConsumerProject = Project,
> {
	/** Whether this exact product command owner accepts assistance-asset compounds. */
	readonly assistanceAssetCommands: boolean;
	readonly createProject: (options?: Readonly<Record<string, unknown>>) => Project;
	readonly cloneProject: (project: unknown) => Project;
	/** Validate an existing object without replacing its identity. */
	readonly validateProject?: (project: unknown) => project is Project;
	readonly loadProject: (project: unknown) => Readonly<{
		readonly project: LoadedProject;
		readonly readOnly: boolean;
		readonly intrinsicReadOnly?: boolean;
		readonly reason?: string | null;
	}>;
	readonly projectForCommandConsumers: (project: unknown) => ConsumerProject;
	readonly projectForRuntimeConsumers: (project: unknown) => ConsumerProject;
	readonly projectForEditClipboardConsumers?: (project: unknown) => Readonly<Record<string, unknown>>;
	readonly prepareEditClipboardDescriptor: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => AudioEditorClipboard;
	readonly createEditSessionClipboard?: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => ControllerEditSessionClipboardCarrier;
	readonly prepareEditClipboardPasteCommand?: (
		project: unknown,
		clipboard: ControllerEditSessionClipboardCarrier,
		command: AudioEditorCommand,
		createId: (prefix?: string) => string,
	) => unknown;
	readonly prepareTrackDuplicateCarrier: (
		project: unknown,
		request: Readonly<ControllerTrackDuplicateRequest>,
	) => Readonly<ControllerTrackDuplicateCarrier>;
	readonly createHistory: (project: unknown) => History;
	readonly executeCommand: (
		history: History,
		command: unknown,
		options?: ControllerRuntimeCommandOptions,
	) => History;
	readonly applyCommand: (
		project: unknown,
		command: AudioEditorCommand,
		options?: Readonly<{ now?: Date | string }>,
	) => Project;
	/**
	 * Fold everything a macro committed since a depth into one undo entry.
	 *
	 * Optional, because only a product that runs macros needs it: the capability
	 * is fenced on `audioMacros`, and a runtime without these two simply cannot
	 * open a macro transaction.
	 */
	readonly collapseHistory?: (
		history: History,
		depth: number,
		command: MacroTransactionMetadata,
	) => History;
	/** Put a failed macro's project back and drop what it committed. */
	readonly rollbackHistory?: (
		history: History,
		depth: number,
		options?: Readonly<{ now?: Date | string }>,
	) => History;
	readonly undo: (
		history: History,
		options?: ControllerRuntimeCommandOptions,
	) => History;
	readonly redo: (
		history: History,
		options?: ControllerRuntimeCommandOptions,
	) => History;
	readonly canUndo: (history: History) => boolean;
	readonly canRedo: (history: History) => boolean;
}

export type ControllerEditClipboardRuntimeBindings = Readonly<Pick<
	ControllerProjectRuntime,
	'createEditSessionClipboard' | 'prepareEditClipboardPasteCommand'
>>;

const DEFAULT_RUNTIME = Object.freeze({
	assistanceAssetCommands: false,
	createProject: createCurrentAudioEditorProject,
	cloneProject,
	validateProject: validateAudioEditorProjectV17,
	loadProject: loadCurrentAudioEditorProject,
	projectForCommandConsumers,
	projectForRuntimeConsumers,
	projectForEditClipboardConsumers: projectForCommandConsumers,
	prepareEditClipboardDescriptor: (_project: unknown, descriptor: AudioEditorClipboard) => descriptor,
	createEditSessionClipboard: (_project: unknown, descriptor: AudioEditorClipboard) => ({ descriptor }),
	prepareEditClipboardPasteCommand: (
		_project: unknown,
		_clipboard: ControllerEditSessionClipboardCarrier,
		command: AudioEditorCommand,
	) => command,
	prepareTrackDuplicateCarrier: (_project: unknown, request: ControllerTrackDuplicateRequest) => ({
		sourceTrackId: request.sourceTrackId,
		effectIds: request.effectIds,
	}),
	createHistory: createDefaultControllerHistory,
	executeCommand: executeEditorCommand,
	applyCommand: (project: unknown, command: AudioEditorCommand, options?: Readonly<{ now?: Date | string }>) => {
		if (!validateAudioEditorProjectV17(project)) throw new TypeError('Expected a current audio editor project.');
		return applyEditorCommand(project, command, options);
	},
	collapseHistory: collapseEditorHistory,
	rollbackHistory: rollbackEditorHistory,
	undo: undoEditorCommand,
	redo: redoEditorCommand,
	canUndo,
	canRedo,
});

function createDefaultControllerHistory(project: unknown) {
	const descriptor = typeof project === 'object' && project !== null
		? Object.getOwnPropertyDescriptor(project, 'schemaVersion') : undefined;
	const version: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
	if (typeof version === 'number' && Number.isSafeInteger(version) && version > AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION) {
		return Object.freeze({
			limit: AUDIO_EDITOR_HISTORY_LIMIT,
			present: createOpaqueProjectConsumer(project, { schemaVersion: version }),
			undoStack: Object.freeze([]), redoStack: Object.freeze([]),
			dropped: 0, playheadFrame: undefined,
		});
	}
	if (!validateAudioEditorProjectV17(project)) throw new TypeError('Expected a current audio editor project.');
	return createEditorHistory(project);
}

/** Admission checks callable ports; selected products retain their own result models. */
export type ControllerProjectRuntimeSelection = {
	readonly [Name in typeof METHOD_NAMES[number] | 'loadProject']: (...args: never[]) => unknown;
};

/** A host may omit hooks whose implementation is supplied during admission. */
export type ControllerProjectRuntimeInput<
	Project extends ControllerRuntimeProject = ControllerRuntimeProject,
	History extends ControllerRuntimeHistory<Project> = ControllerRuntimeHistory<Project>,
	LoadedProject = Project,
	ConsumerProject = Project,
> = Omit<ControllerProjectRuntime<Project, History, LoadedProject, ConsumerProject>, 'prepareTrackDuplicateCarrier'>
	& Partial<Pick<ControllerProjectRuntime<Project, History, LoadedProject, ConsumerProject>, 'prepareTrackDuplicateCarrier'>>;

type DefaultedRuntimeMethod = 'prepareTrackDuplicateCarrier' | 'projectForEditClipboardConsumers'
	| 'createEditSessionClipboard' | 'prepareEditClipboardPasteCommand';

type AdmittedRuntimeMethods<Runtime> = {
	readonly [Name in DefaultedRuntimeMethod]-?: Name extends keyof Runtime
		? Exclude<Runtime[Name], undefined> | (undefined extends Runtime[Name] ? typeof DEFAULT_RUNTIME[Name] : never)
		: typeof DEFAULT_RUNTIME[Name];
};

/** Keep only admitted runtime ports, retaining the selected owners' signatures. */
export type ControllerProjectRuntimeSnapshot<Runtime extends ControllerProjectRuntimeSelection> =
	unknown extends Runtime ? Readonly<ControllerProjectRuntime> : Readonly<
		Omit<ControllerProjectRuntime, keyof Runtime | DefaultedRuntimeMethod>
		& Pick<Runtime, Exclude<Extract<keyof ControllerProjectRuntime, keyof Runtime>, DefaultedRuntimeMethod>>
		& AdmittedRuntimeMethods<Runtime>
	>;

export function resolveControllerProjectRuntime(): typeof DEFAULT_RUNTIME;

/** A typed host retains its document model through runtime admission. */
export function resolveControllerProjectRuntime<Runtime extends ControllerProjectRuntimeSelection>(
	value: Runtime,
): ControllerProjectRuntimeSnapshot<Runtime>;
export function resolveControllerProjectRuntime<Runtime extends ControllerProjectRuntimeSelection>(
	value: Runtime | undefined,
): ControllerProjectRuntimeSnapshot<Runtime> | typeof DEFAULT_RUNTIME;
export function resolveControllerProjectRuntime(value?: unknown): Readonly<ControllerProjectRuntime>;

/** Snapshot either the unchanged V17 owner or one complete selected runtime. */
export function resolveControllerProjectRuntime(
	value?: unknown,
): Readonly<object> {
	if (value === undefined) return DEFAULT_RUNTIME;
	if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
		throw new TypeError('A complete controller project runtime is required.');
	}
	const runtime = value as Record<string, unknown>;
	const snapshot: Record<string, unknown> = {};
	const assistanceAssetCommands = Object.getOwnPropertyDescriptor(runtime, 'assistanceAssetCommands');
	if (assistanceAssetCommands === undefined) snapshot.assistanceAssetCommands = false;
	else if (!Object.hasOwn(assistanceAssetCommands, 'value')
		|| typeof assistanceAssetCommands.value !== 'boolean') {
		throw new TypeError('Controller project runtime assistanceAssetCommands must be boolean.');
	} else snapshot.assistanceAssetCommands = assistanceAssetCommands.value;
	for (const name of METHOD_NAMES) {
		const descriptor = Object.getOwnPropertyDescriptor(runtime, name);
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
			throw new TypeError(`A complete controller project runtime requires ${name}.`);
		}
		snapshot[name] = descriptor.value;
	}
	for (const name of OPTIONAL_METHOD_NAMES) {
		const descriptor = Object.getOwnPropertyDescriptor(runtime, name);
		if (!descriptor) continue;
		if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
			throw new TypeError(`Controller project runtime ${name} must be a function.`);
		}
		snapshot[name] = descriptor.value;
	}
	const loadProject = Object.getOwnPropertyDescriptor(runtime, 'loadProject');
	if (!loadProject || !Object.hasOwn(loadProject, 'value') || typeof loadProject.value !== 'function') {
		throw new TypeError('A complete controller project runtime requires loadProject.');
	}
	snapshot.loadProject = loadProject.value;
	const duplicateCarrier = Object.getOwnPropertyDescriptor(runtime, 'prepareTrackDuplicateCarrier');
	if (duplicateCarrier === undefined) {
		snapshot.prepareTrackDuplicateCarrier = DEFAULT_RUNTIME.prepareTrackDuplicateCarrier;
	} else if (!Object.hasOwn(duplicateCarrier, 'value') || typeof duplicateCarrier.value !== 'function') {
		throw new TypeError('Controller project runtime prepareTrackDuplicateCarrier must be a method.');
	} else {
		snapshot.prepareTrackDuplicateCarrier = duplicateCarrier.value;
	}
	for (const name of [
		'projectForEditClipboardConsumers',
		'createEditSessionClipboard',
		'prepareEditClipboardPasteCommand',
	] as const) {
		const descriptor = Object.getOwnPropertyDescriptor(runtime, name);
		if (descriptor === undefined) snapshot[name] = DEFAULT_RUNTIME[name];
		else if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
			throw new TypeError(`Controller project runtime ${name} must be a method.`);
		} else snapshot[name] = descriptor.value;
	}
	return Object.freeze(snapshot);
}

/** Bind clipboard product hooks to the canonical project hidden behind common consumers. */
export function bindControllerEditClipboardRuntime(
	runtime: ControllerEditClipboardRuntimeBindings,
	getProject: () => unknown,
): ControllerEditClipboardRuntimeBindings {
	const createClipboard = runtime.createEditSessionClipboard;
	const preparePaste = runtime.prepareEditClipboardPasteCommand;
	return Object.freeze({
		...(createClipboard === undefined ? {} : {
			createEditSessionClipboard: (_project: unknown, descriptor: AudioEditorClipboard) => (
				createClipboard(getProject(), descriptor)
			),
		}),
		...(preparePaste === undefined ? {} : {
			prepareEditClipboardPasteCommand: (
				_project: unknown,
				clipboard: ControllerEditSessionClipboardCarrier,
				command: AudioEditorCommand,
				createId: (prefix?: string) => string,
			) => preparePaste(getProject(), clipboard, command, createId),
		}),
	});
}

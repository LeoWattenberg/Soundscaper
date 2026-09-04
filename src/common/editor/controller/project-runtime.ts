/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard, AudioEditorCommand } from '../commands/protocol.ts';
import { applyEditorCommand } from '../commands.js';
import {
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

const METHOD_NAMES = [
	'createProject', 'cloneProject', 'projectForCommandConsumers',
	'projectForRuntimeConsumers', 'prepareEditClipboardDescriptor',
	'createHistory', 'executeCommand', 'applyCommand', 'undo', 'redo', 'canUndo', 'canRedo',
] as const;

export interface ControllerRuntimeProject extends Record<string, unknown> {
	readonly id: string;
	readonly schemaVersion: number;
}

export interface ControllerRuntimeHistory {
	readonly present: ControllerRuntimeProject;
	readonly undoStack: readonly unknown[];
	readonly redoStack: readonly unknown[];
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

export interface ControllerEditSessionClipboardCarrier extends Readonly<Record<string, unknown>> {
	readonly descriptor: AudioEditorClipboard;
	readonly sources?: readonly Readonly<{ readonly id: string }>[];
	readonly originProjectId?: string;
}

export interface ControllerProjectRuntime {
	/** Whether this exact product command owner accepts assistance-asset compounds. */
	readonly assistanceAssetCommands: boolean;
	readonly createProject: (options?: Readonly<Record<string, unknown>>) => ControllerRuntimeProject;
	readonly cloneProject: (project: unknown) => ControllerRuntimeProject;
	readonly loadProject: (project: unknown) => Readonly<{
		readonly project: ControllerRuntimeProject;
		readonly readOnly: boolean;
		readonly intrinsicReadOnly?: boolean;
		readonly reason?: string | null;
	}>;
	readonly projectForCommandConsumers: (project: unknown) => ControllerRuntimeProject;
	readonly projectForRuntimeConsumers: (project: unknown) => ControllerRuntimeProject;
	readonly projectForEditClipboardConsumers?: (project: unknown) => ControllerRuntimeProject;
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
	readonly createHistory: (project: unknown) => ControllerRuntimeHistory;
	readonly executeCommand: (
		history: ControllerRuntimeHistory,
		command: AudioEditorCommand,
		options?: Readonly<{ now?: Date | string }>,
	) => ControllerRuntimeHistory;
	readonly applyCommand: (
		project: unknown,
		command: AudioEditorCommand,
		options?: Readonly<{ now?: Date | string }>,
	) => ControllerRuntimeProject;
	/**
	 * Fold everything a macro committed since a depth into one undo entry.
	 *
	 * Optional, because only a product that runs macros needs it: the capability
	 * is fenced on `audioMacros`, and a runtime without these two simply cannot
	 * open a macro transaction.
	 */
	readonly collapseHistory?: (
		history: ControllerRuntimeHistory,
		depth: number,
		command: AudioEditorCommand,
	) => ControllerRuntimeHistory;
	/** Put a failed macro's project back and drop what it committed. */
	readonly rollbackHistory?: (
		history: ControllerRuntimeHistory,
		depth: number,
		options?: Readonly<{ now?: Date | string }>,
	) => ControllerRuntimeHistory;
	readonly undo: (
		history: ControllerRuntimeHistory,
		options?: Readonly<{ now?: Date | string }>,
	) => ControllerRuntimeHistory;
	readonly redo: (
		history: ControllerRuntimeHistory,
		options?: Readonly<{ now?: Date | string }>,
	) => ControllerRuntimeHistory;
	readonly canUndo: (history: ControllerRuntimeHistory) => boolean;
	readonly canRedo: (history: ControllerRuntimeHistory) => boolean;
}

export type ControllerEditClipboardRuntimeBindings = Readonly<Pick<
	ControllerProjectRuntime,
	'createEditSessionClipboard' | 'prepareEditClipboardPasteCommand'
>>;

const DEFAULT_RUNTIME = Object.freeze({
	assistanceAssetCommands: false,
	createProject: createCurrentAudioEditorProject,
	cloneProject,
	loadProject: loadCurrentAudioEditorProject,
	projectForCommandConsumers,
	projectForRuntimeConsumers: (project: ControllerRuntimeProject) => (
		projectForRuntimeConsumers(project as never) as ControllerRuntimeProject
	),
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
	createHistory: createEditorHistory,
	executeCommand: executeEditorCommand,
	applyCommand: applyEditorCommand,
	collapseHistory: collapseEditorHistory,
	rollbackHistory: rollbackEditorHistory,
	undo: undoEditorCommand,
	redo: redoEditorCommand,
	canUndo,
	canRedo,
}) as unknown as ControllerProjectRuntime;

/** Snapshot either the unchanged V17 owner or one complete selected runtime. */
export function resolveControllerProjectRuntime(
	value?: ControllerProjectRuntime | unknown,
): Readonly<ControllerProjectRuntime> {
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
	return Object.freeze(snapshot) as unknown as ControllerProjectRuntime;
}

/** Bind clipboard product hooks to the canonical project hidden behind common consumers. */
export function bindControllerEditClipboardRuntime(
	runtime: Readonly<ControllerProjectRuntime>,
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

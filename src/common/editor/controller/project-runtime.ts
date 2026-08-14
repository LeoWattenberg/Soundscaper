/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard, AudioEditorCommand } from '../commands/protocol.ts';
import { applyEditorCommand } from '../commands.js';
import {
	canRedo,
	canUndo,
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../history.js';
import { migrateAudioEditorProject } from '../migration.js';
import { cloneProject } from '../project.js';
import { createCurrentAudioEditorProject } from '../project-current.ts';
import { projectForCommandConsumers, projectForRuntimeConsumers } from '../project-current-runtime.ts';

const METHOD_NAMES = [
	'createProject', 'cloneProject', 'migrateProject', 'projectForCommandConsumers',
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

export interface ControllerProjectRuntime {
	readonly createProject: (options?: Readonly<Record<string, unknown>>) => ControllerRuntimeProject;
	readonly cloneProject: (project: unknown) => ControllerRuntimeProject;
	readonly migrateProject: (project: unknown) => Readonly<{
		readonly project: ControllerRuntimeProject;
		readonly readOnly: boolean;
		readonly intrinsicReadOnly?: boolean;
		readonly reason?: string | null;
	}>;
	readonly projectForCommandConsumers: (project: unknown) => ControllerRuntimeProject;
	readonly projectForRuntimeConsumers: (project: unknown) => ControllerRuntimeProject;
	readonly prepareEditClipboardDescriptor: (
		project: unknown,
		descriptor: AudioEditorClipboard,
	) => AudioEditorClipboard;
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

const DEFAULT_RUNTIME = Object.freeze({
	createProject: createCurrentAudioEditorProject,
	cloneProject,
	migrateProject: migrateAudioEditorProject,
	projectForCommandConsumers,
	projectForRuntimeConsumers: (project: ControllerRuntimeProject) => (
		projectForRuntimeConsumers(project as never) as ControllerRuntimeProject
	),
	prepareEditClipboardDescriptor: (_project: unknown, descriptor: AudioEditorClipboard) => descriptor,
	prepareTrackDuplicateCarrier: (_project: unknown, request: ControllerTrackDuplicateRequest) => ({
		sourceTrackId: request.sourceTrackId,
		effectIds: request.effectIds,
	}),
	createHistory: createEditorHistory,
	executeCommand: executeEditorCommand,
	applyCommand: applyEditorCommand,
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
	for (const name of METHOD_NAMES) {
		const descriptor = Object.getOwnPropertyDescriptor(runtime, name);
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
			throw new TypeError(`A complete controller project runtime requires ${name}.`);
		}
		snapshot[name] = descriptor.value;
	}
	const duplicateCarrier = Object.getOwnPropertyDescriptor(runtime, 'prepareTrackDuplicateCarrier');
	if (duplicateCarrier === undefined) {
		snapshot.prepareTrackDuplicateCarrier = DEFAULT_RUNTIME.prepareTrackDuplicateCarrier;
	} else if (!Object.hasOwn(duplicateCarrier, 'value') || typeof duplicateCarrier.value !== 'function') {
		throw new TypeError('Controller project runtime prepareTrackDuplicateCarrier must be a method.');
	} else {
		snapshot.prepareTrackDuplicateCarrier = duplicateCarrier.value;
	}
	return Object.freeze(snapshot) as unknown as ControllerProjectRuntime;
}

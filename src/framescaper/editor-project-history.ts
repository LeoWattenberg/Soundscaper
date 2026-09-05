/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	createEditorProjectHistory,
	executeEditorProjectCommand,
	redoEditorProjectCommand,
	undoEditorProjectCommand,
	validateEditorProjectHistory,
	type EditorHistoryDocument,
	type EditorProjectHistoryRevision,
	type EditorProjectHistoryState,
} from '../common/editor/project-history-mechanics.ts';
import {
	applyFramescaperProjectCommand,
	snapshotFramescaperProjectCommand,
	type FramescaperProjectCommand,
	type FramescaperProjectCommandOptions,
} from './editor-project-commands.ts';
import {
	cloneFramescaperProject,
	validateFramescaperProject,
	type FramescaperProject,
} from './editor-project.ts';

/**
 * Undo history for the Framescaper baseline document.
 *
 * The stack mechanics are shared (src/common/editor/project-history-mechanics.ts);
 * this module says what the baseline document is — how to validate, clone,
 * snapshot and apply against a runtime profile — and which reading of the stored
 * shape it keeps: an exact record, and a limit no larger than the shared one.
 */

export interface FramescaperProjectHistoryEntry {
	readonly project: FramescaperProject;
	readonly command: FramescaperProjectCommand;
}

export interface FramescaperProjectHistory {
	readonly limit: number;
	readonly present: FramescaperProject;
	readonly undoStack: readonly FramescaperProjectHistoryEntry[];
	readonly redoStack: readonly FramescaperProjectHistoryEntry[];
}

type Mechanics = EditorProjectHistoryRevision<FramescaperProjectCommand, FramescaperProjectCommandOptions>;

const document = (project: FramescaperProject): EditorHistoryDocument => (
	project as unknown as EditorHistoryDocument
);

const asHistory = (
	state: EditorProjectHistoryState<FramescaperProjectCommand>,
): FramescaperProjectHistory => state as unknown as FramescaperProjectHistory;

function revisionFor(profile: unknown): Mechanics {
	return {
		label: 'Framescaper',
		shape: 'exact',
		maximumLimit: AUDIO_EDITOR_HISTORY_LIMIT,
		validateProject: (project) => { validateFramescaperProject(profile, project); },
		cloneProject: (project) => document(cloneFramescaperProject(profile, project)),
		snapshotCommand: (command) => snapshotFramescaperProjectCommand(command),
		applyCommand: (project, command, options) => document(
			applyFramescaperProjectCommand(profile, project, command, options),
		),
	};
}

export function createFramescaperProjectHistory(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistory {
	return asHistory(createEditorProjectHistory(
		project, revisionFor(profile), AUDIO_EDITOR_HISTORY_LIMIT, options,
	));
}

export function validateFramescaperProjectHistory(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistory {
	validateEditorProjectHistory(history, revisionFor(profile));
	return true;
}

export function executeFramescaperProjectCommand(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptions = {},
): FramescaperProjectHistory {
	return asHistory(executeEditorProjectCommand(history, command, revisionFor(profile), options));
}

export function undoFramescaperProjectCommand(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptions = {},
): FramescaperProjectHistory {
	return asHistory(undoEditorProjectCommand(history, revisionFor(profile), options));
}

export function redoFramescaperProjectCommand(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptions = {},
): FramescaperProjectHistory {
	return asHistory(redoEditorProjectCommand(history, revisionFor(profile), options));
}

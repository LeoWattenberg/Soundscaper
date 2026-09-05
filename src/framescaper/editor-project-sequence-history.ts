/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	cloneEditorProjectHistory,
	createEditorProjectHistory,
	executeEditorProjectCommand,
	redoEditorProjectCommand,
	undoEditorProjectCommand,
	validateEditorProjectHistory,
	type EditorHistoryDocument,
	type EditorProjectHistoryRevision,
	type EditorProjectHistoryState,
} from '../common/editor/project-history-mechanics.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { assertFramescaperProjectSequenceProfile } from './editor-domain-runtime-profile.ts';
import {
	applyFramescaperProjectCommandSequence,
	type FramescaperProjectCommandOptionsSequence,
} from './editor-project-sequence-commands.ts';
import {
	cloneFramescaperProjectSequence,
	validateFramescaperProjectSequence,
	type FramescaperProjectSequence,
} from './editor-project-sequence.ts';
import type { FramescaperProjectCommandSequence } from './editor-project-sequence-subsequence.ts';

/**
 * Undo history for the Framescaper sequence document.
 *
 * The stack mechanics are shared (src/common/editor/project-history-mechanics.ts);
 * this module says what the sequence document is and keeps the two readings the
 * sequence document settled for itself: a stored history is read openly rather
 * than as a closed record, and a command is carried by structural copy because
 * the sequence command surface has no snapshot of its own.
 */

export interface FramescaperProjectHistoryEntrySequence {
	readonly project: FramescaperProjectSequence;
	readonly command: FramescaperProjectCommandSequence;
}

export interface FramescaperProjectHistorySequence {
	readonly limit: number;
	readonly present: FramescaperProjectSequence;
	readonly undoStack: readonly FramescaperProjectHistoryEntrySequence[];
	readonly redoStack: readonly FramescaperProjectHistoryEntrySequence[];
}

type Mechanics = EditorProjectHistoryRevision<
	FramescaperProjectCommandSequence, FramescaperProjectCommandOptionsSequence
>;

const document = (project: FramescaperProjectSequence): EditorHistoryDocument => (
	project as unknown as EditorHistoryDocument
);

const asHistory = (
	state: EditorProjectHistoryState<FramescaperProjectCommandSequence>,
): FramescaperProjectHistorySequence => state as unknown as FramescaperProjectHistorySequence;

/** A sequence command is inert data, so a structural copy is its whole snapshot. */
function snapshotCommand(command: unknown): FramescaperProjectCommandSequence {
	if (!command || typeof command !== 'object'
		|| typeof (command as Readonly<{ type?: unknown }>).type !== 'string') {
		throw new TypeError('Every Framescaper sequence history entry requires a command.');
	}
	return structuredClone(command) as FramescaperProjectCommandSequence;
}

function revisionFor(profile: EditorProjectRuntimeProfile | unknown): Mechanics {
	return {
		label: 'Framescaper sequence',
		snapshotPushedProject: false,
		validateProject: (project) => { validateFramescaperProjectSequence(profile, project); },
		cloneProject: (project) => document(cloneFramescaperProjectSequence(profile, project)),
		snapshotCommand,
		applyCommand: (project, command, options) => document(
			applyFramescaperProjectCommandSequence(profile, project, command, options),
		),
	};
}

export function createFramescaperProjectHistorySequence(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectSequence | unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistorySequence {
	assertFramescaperProjectSequenceProfile(profile);
	return asHistory(createEditorProjectHistory(
		project, revisionFor(profile), AUDIO_EDITOR_HISTORY_LIMIT, options,
	));
}

export function validateFramescaperProjectHistorySequence(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistorySequence | unknown,
): history is FramescaperProjectHistorySequence {
	assertFramescaperProjectSequenceProfile(profile);
	validateEditorProjectHistory(history, revisionFor(profile));
	return true;
}

export function cloneFramescaperProjectHistorySequence(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistorySequence | unknown,
): FramescaperProjectHistorySequence {
	assertFramescaperProjectSequenceProfile(profile);
	return asHistory(cloneEditorProjectHistory(history, revisionFor(profile)));
}

export function executeFramescaperProjectCommandSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistorySequence | unknown,
	command: FramescaperProjectCommandSequence,
	options: FramescaperProjectCommandOptionsSequence = {},
): FramescaperProjectHistorySequence {
	assertFramescaperProjectSequenceProfile(profile);
	return asHistory(executeEditorProjectCommand(history, command, revisionFor(profile), options));
}

export function undoFramescaperProjectCommandSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistorySequence | unknown,
	options: FramescaperProjectCommandOptionsSequence = {},
): FramescaperProjectHistorySequence {
	assertFramescaperProjectSequenceProfile(profile);
	return asHistory(undoEditorProjectCommand(history, revisionFor(profile), options));
}

export function redoFramescaperProjectCommandSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistorySequence | unknown,
	options: FramescaperProjectCommandOptionsSequence = {},
): FramescaperProjectHistorySequence {
	assertFramescaperProjectSequenceProfile(profile);
	return asHistory(redoEditorProjectCommand(history, revisionFor(profile), options));
}

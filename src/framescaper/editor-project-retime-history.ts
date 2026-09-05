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
import {
	reconcileFramescaperProjectFeatureRequirementsRetime,
} from './editor-project-feature-requirements-retime.ts';
import {
	applyFramescaperProjectCommandRetime,
	snapshotFramescaperProjectCommandRetime,
	type FramescaperProjectCommandOptionsRetime,
	type FramescaperProjectCommandRetime,
} from './editor-project-retime-commands.ts';
import {
	assertFramescaperProjectRetimeProfile,
	type FramescaperProjectRetimeProfile,
} from './editor-domain-runtime-profile.ts';
import {
	validateFramescaperProjectRetime,
	type FramescaperProjectRetime,
} from './editor-project-retime-validation.ts';
import {
	admitFramescaperProjectHistoryRetimeStructure,
} from './editor-project-retime-history-admission.ts';

/**
 * Undo history for the Framescaper retime document.
 *
 * The stack mechanics are shared (src/common/editor/project-history-mechanics.ts);
 * this module says what the retime document is — how to validate, snapshot and
 * apply against a runtime profile, and how its feature requirements settle on a
 * restored document — together with the two readings of the stored shape it
 * keeps: the whole graph is bounded once before any per-entry work, and every
 * record is then read closed, without accessors or inherited state.
 */

export interface FramescaperProjectHistoryEntryRetime {
	readonly project: FramescaperProjectRetime;
	readonly command: FramescaperProjectCommandRetime;
}

export interface FramescaperProjectHistoryRetime {
	readonly limit: number;
	readonly present: FramescaperProjectRetime;
	readonly undoStack: readonly FramescaperProjectHistoryEntryRetime[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryRetime[];
}

type Mechanics = EditorProjectHistoryRevision<
	FramescaperProjectCommandRetime, FramescaperProjectCommandOptionsRetime
>;

const asHistory = (
	state: EditorProjectHistoryState<FramescaperProjectCommandRetime>,
): FramescaperProjectHistoryRetime => state as unknown as FramescaperProjectHistoryRetime;

/** A retime document is snapshotted by validating it either side of the copy. */
function snapshotProject(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: unknown,
): EditorHistoryDocument {
	validateFramescaperProjectRetime(profile, project);
	const snapshot = structuredClone(project) as FramescaperProjectRetime;
	validateFramescaperProjectRetime(profile, snapshot);
	return snapshot as unknown as EditorHistoryDocument;
}

function revisionFor(profile: FramescaperProjectRetimeProfile | unknown): Mechanics {
	return {
		label: 'Framescaper retime',
		shape: 'closed',
		maximumLimit: AUDIO_EDITOR_HISTORY_LIMIT,
		admitStructure: (history) => { admitFramescaperProjectHistoryRetimeStructure(history); },
		validateProject: (project) => { validateFramescaperProjectRetime(profile, project); },
		cloneProject: (project) => snapshotProject(profile, project),
		snapshotCommand: (command) => snapshotFramescaperProjectCommandRetime(command),
		applyCommand: (project, command, options) => (
			applyFramescaperProjectCommandRetime(profile, project, command, options) as unknown as EditorHistoryDocument
		),
		reconcileRestoredProject: (project) => {
			project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsRetime(profile, project);
		},
	};
}

export function createFramescaperProjectHistoryRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: FramescaperProjectRetime | unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryRetime {
	assertFramescaperProjectRetimeProfile(profile);
	return asHistory(createEditorProjectHistory(
		project, revisionFor(profile), AUDIO_EDITOR_HISTORY_LIMIT, options,
	));
}

export function validateFramescaperProjectHistoryRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	history: FramescaperProjectHistoryRetime | unknown,
): history is FramescaperProjectHistoryRetime {
	assertFramescaperProjectRetimeProfile(profile);
	validateEditorProjectHistory(history, revisionFor(profile));
	return true;
}

export function cloneFramescaperProjectHistoryRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	history: FramescaperProjectHistoryRetime | unknown,
): FramescaperProjectHistoryRetime {
	assertFramescaperProjectRetimeProfile(profile);
	return asHistory(cloneEditorProjectHistory(history, revisionFor(profile)));
}

export function executeFramescaperProjectCommandRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	history: FramescaperProjectHistoryRetime | unknown,
	command: FramescaperProjectCommandRetime,
	options: FramescaperProjectCommandOptionsRetime = {},
): FramescaperProjectHistoryRetime {
	assertFramescaperProjectRetimeProfile(profile);
	return asHistory(executeEditorProjectCommand(history, command, revisionFor(profile), options));
}

export function undoFramescaperProjectCommandRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	history: FramescaperProjectHistoryRetime | unknown,
	options: FramescaperProjectCommandOptionsRetime = {},
): FramescaperProjectHistoryRetime {
	assertFramescaperProjectRetimeProfile(profile);
	return asHistory(undoEditorProjectCommand(history, revisionFor(profile), options));
}

export function redoFramescaperProjectCommandRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	history: FramescaperProjectHistoryRetime | unknown,
	options: FramescaperProjectCommandOptionsRetime = {},
): FramescaperProjectHistoryRetime {
	assertFramescaperProjectRetimeProfile(profile);
	return asHistory(redoEditorProjectCommand(history, revisionFor(profile), options));
}

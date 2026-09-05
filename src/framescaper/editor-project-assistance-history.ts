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
	reconcileFramescaperProjectFeatureRequirementsAssistance,
} from './editor-project-feature-requirements-assistance.ts';
import {
	applyFramescaperProjectCommandAssistance,
	snapshotFramescaperProjectCommandAssistance,
	type FramescaperProjectCommandOptionsAssistance,
	type FramescaperProjectCommandAssistance,
} from './editor-project-assistance-commands.ts';
import { assertFramescaperProjectAssistanceProfile } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectAssistance,
	validateFramescaperProjectAssistance,
	type FramescaperProjectAssistance,
} from './editor-project-assistance.ts';

/**
 * Undo history for the Framescaper assistance document.
 *
 * The stack mechanics are shared (src/common/editor/project-history-mechanics.ts);
 * this module says what the assistance document is — how to validate, clone,
 * snapshot and apply against a runtime profile, and how its feature requirements
 * settle on a restored document — together with the reading of the stored shape
 * it keeps: an exact record, and a limit no larger than the shared one.
 */

export interface FramescaperProjectHistoryEntryAssistance {
	readonly project: FramescaperProjectAssistance;
	readonly command: FramescaperProjectCommandAssistance;
}

export interface FramescaperProjectHistoryAssistance {
	readonly limit: number;
	readonly present: FramescaperProjectAssistance;
	readonly undoStack: readonly FramescaperProjectHistoryEntryAssistance[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryAssistance[];
}

type Mechanics = EditorProjectHistoryRevision<
	FramescaperProjectCommandAssistance, FramescaperProjectCommandOptionsAssistance
>;

const document = (project: FramescaperProjectAssistance): EditorHistoryDocument => (
	project as unknown as EditorHistoryDocument
);

const asHistory = (
	state: EditorProjectHistoryState<FramescaperProjectCommandAssistance>,
): FramescaperProjectHistoryAssistance => state as unknown as FramescaperProjectHistoryAssistance;

function revisionFor(profile: unknown): Mechanics {
	return {
		label: 'Framescaper assistance',
		shape: 'exact',
		maximumLimit: AUDIO_EDITOR_HISTORY_LIMIT,
		validateProject: (project) => { validateFramescaperProjectAssistance(profile, project); },
		cloneProject: (project) => document(cloneFramescaperProjectAssistance(profile, project)),
		snapshotCommand: (command) => snapshotFramescaperProjectCommandAssistance(command),
		applyCommand: (project, command, options) => document(
			applyFramescaperProjectCommandAssistance(profile, project, command, options),
		),
		reconcileRestoredProject: (project) => {
			project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsAssistance(profile, project);
		},
	};
}

export function createFramescaperProjectHistoryAssistance(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryAssistance {
	assertFramescaperProjectAssistanceProfile(profile);
	return asHistory(createEditorProjectHistory(
		project, revisionFor(profile), AUDIO_EDITOR_HISTORY_LIMIT, options,
	));
}

export function validateFramescaperProjectHistoryAssistance(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryAssistance {
	assertFramescaperProjectAssistanceProfile(profile);
	validateEditorProjectHistory(history, revisionFor(profile));
	return true;
}

export function executeFramescaperProjectCommandAssistance(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsAssistance = {},
): FramescaperProjectHistoryAssistance {
	assertFramescaperProjectAssistanceProfile(profile);
	return asHistory(executeEditorProjectCommand(history, command, revisionFor(profile), options));
}

export function undoFramescaperProjectCommandAssistance(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsAssistance = {},
): FramescaperProjectHistoryAssistance {
	assertFramescaperProjectAssistanceProfile(profile);
	return asHistory(undoEditorProjectCommand(history, revisionFor(profile), options));
}

export function redoFramescaperProjectCommandAssistance(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsAssistance = {},
): FramescaperProjectHistoryAssistance {
	assertFramescaperProjectAssistanceProfile(profile);
	return asHistory(redoEditorProjectCommand(history, revisionFor(profile), options));
}

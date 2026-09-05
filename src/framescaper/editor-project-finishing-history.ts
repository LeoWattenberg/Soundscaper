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
	reconcileFramescaperProjectFeatureRequirementsFinishing,
} from './editor-project-feature-requirements-finishing.ts';
import {
	applyFramescaperProjectCommandFinishing,
	snapshotFramescaperProjectCommandFinishing,
	type FramescaperProjectCommandOptionsFinishing,
	type FramescaperProjectCommandFinishing,
} from './editor-project-finishing-commands.ts';
import { assertFramescaperProjectFinishingProfile } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectFinishing,
	type FramescaperProjectFinishing,
} from './editor-project-finishing.ts';
import { validateFramescaperProjectFinishing } from './editor-project-finishing-validation.ts';

/**
 * Undo history for the Framescaper finishing document.
 *
 * The stack mechanics are shared (src/common/editor/project-history-mechanics.ts);
 * this module says what the finishing document is — how to validate, clone,
 * snapshot and apply against a runtime profile, and how its feature requirements
 * settle on a restored document — together with the reading of the stored shape
 * it keeps: an exact record, and a limit no larger than the shared one.
 */

export interface FramescaperProjectHistoryEntryFinishing {
	readonly project: FramescaperProjectFinishing;
	readonly command: FramescaperProjectCommandFinishing;
}

export interface FramescaperProjectHistoryFinishing {
	readonly limit: number;
	readonly present: FramescaperProjectFinishing;
	readonly undoStack: readonly FramescaperProjectHistoryEntryFinishing[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryFinishing[];
}

type Mechanics = EditorProjectHistoryRevision<
	FramescaperProjectCommandFinishing, FramescaperProjectCommandOptionsFinishing
>;

const document = (project: FramescaperProjectFinishing): EditorHistoryDocument => (
	project as unknown as EditorHistoryDocument
);

const asHistory = (
	state: EditorProjectHistoryState<FramescaperProjectCommandFinishing>,
): FramescaperProjectHistoryFinishing => state as unknown as FramescaperProjectHistoryFinishing;

function revisionFor(profile: unknown): Mechanics {
	return {
		label: 'Framescaper finishing',
		shape: 'exact',
		maximumLimit: AUDIO_EDITOR_HISTORY_LIMIT,
		validateProject: (project) => { validateFramescaperProjectFinishing(profile, project); },
		cloneProject: (project) => document(cloneFramescaperProjectFinishing(profile, project)),
		snapshotCommand: (command) => snapshotFramescaperProjectCommandFinishing(command),
		applyCommand: (project, command, options) => document(
			applyFramescaperProjectCommandFinishing(profile, project, command, options),
		),
		reconcileRestoredProject: (project) => {
			project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsFinishing(profile, project);
		},
	};
}

export function createFramescaperProjectHistoryFinishing(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryFinishing {
	assertFramescaperProjectFinishingProfile(profile);
	return asHistory(createEditorProjectHistory(
		project, revisionFor(profile), AUDIO_EDITOR_HISTORY_LIMIT, options,
	));
}

export function validateFramescaperProjectHistoryFinishing(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryFinishing {
	assertFramescaperProjectFinishingProfile(profile);
	validateEditorProjectHistory(history, revisionFor(profile));
	return true;
}

export function executeFramescaperProjectCommandFinishing(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsFinishing = {},
): FramescaperProjectHistoryFinishing {
	assertFramescaperProjectFinishingProfile(profile);
	return asHistory(executeEditorProjectCommand(history, command, revisionFor(profile), options));
}

export function undoFramescaperProjectCommandFinishing(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsFinishing = {},
): FramescaperProjectHistoryFinishing {
	assertFramescaperProjectFinishingProfile(profile);
	return asHistory(undoEditorProjectCommand(history, revisionFor(profile), options));
}

export function redoFramescaperProjectCommandFinishing(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsFinishing = {},
): FramescaperProjectHistoryFinishing {
	assertFramescaperProjectFinishingProfile(profile);
	return asHistory(redoEditorProjectCommand(history, revisionFor(profile), options));
}

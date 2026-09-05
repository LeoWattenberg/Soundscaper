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
import {
	reconcileFramescaperProjectFeatureRequirementsComposition,
} from './editor-project-feature-requirements-composition.ts';
import {
	applyFramescaperProjectCommandComposition,
	snapshotFramescaperProjectCommandComposition,
	type FramescaperProjectCommandOptionsComposition,
	type FramescaperProjectCommandComposition,
} from './editor-project-composition-commands.ts';
import { cloneFramescaperProjectComposition } from './editor-project-composition.ts';
import { assertFramescaperProjectCompositionProfile } from './editor-domain-runtime-profile.ts';
import {
	validateFramescaperProjectComposition,
	type FramescaperProjectComposition,
} from './editor-project-composition-validation.ts';

/**
 * Undo history for the Framescaper composition document.
 *
 * The stack mechanics are shared (src/common/editor/project-history-mechanics.ts);
 * this module says what the composition document is — how to validate, clone,
 * snapshot and apply against a runtime profile, and how its feature requirements
 * settle on a restored document — together with the reading of the stored shape
 * it keeps: a closed record, read without invoking accessors or inherited state.
 */

export interface FramescaperProjectHistoryEntryComposition {
	readonly project: FramescaperProjectComposition;
	readonly command: FramescaperProjectCommandComposition;
}

export interface FramescaperProjectHistoryComposition {
	readonly limit: number;
	readonly present: FramescaperProjectComposition;
	readonly undoStack: readonly FramescaperProjectHistoryEntryComposition[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryComposition[];
}

type Mechanics = EditorProjectHistoryRevision<
	FramescaperProjectCommandComposition, FramescaperProjectCommandOptionsComposition
>;

const document = (project: FramescaperProjectComposition): EditorHistoryDocument => (
	project as unknown as EditorHistoryDocument
);

const asHistory = (
	state: EditorProjectHistoryState<FramescaperProjectCommandComposition>,
): FramescaperProjectHistoryComposition => state as unknown as FramescaperProjectHistoryComposition;

function revisionFor(profile: EditorProjectRuntimeProfile | unknown): Mechanics {
	return {
		label: 'Framescaper composition',
		shape: 'closed',
		validateProject: (project) => { validateFramescaperProjectComposition(profile, project); },
		cloneProject: (project) => document(cloneFramescaperProjectComposition(profile, project)),
		snapshotCommand: (command) => snapshotFramescaperProjectCommandComposition(
			command as FramescaperProjectCommandComposition,
		),
		applyCommand: (project, command, options) => document(
			applyFramescaperProjectCommandComposition(profile, project, command, options),
		),
		reconcileRestoredProject: (project) => {
			project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsComposition(profile, project);
		},
	};
}

export function createFramescaperProjectHistoryComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectComposition | unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryComposition {
	assertFramescaperProjectCompositionProfile(profile);
	return asHistory(createEditorProjectHistory(
		project, revisionFor(profile), AUDIO_EDITOR_HISTORY_LIMIT, options,
	));
}

export function validateFramescaperProjectHistoryComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryComposition | unknown,
): history is FramescaperProjectHistoryComposition {
	assertFramescaperProjectCompositionProfile(profile);
	validateEditorProjectHistory(history, revisionFor(profile));
	return true;
}

export function cloneFramescaperProjectHistoryComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryComposition | unknown,
): FramescaperProjectHistoryComposition {
	assertFramescaperProjectCompositionProfile(profile);
	return asHistory(cloneEditorProjectHistory(history, revisionFor(profile)));
}

export function executeFramescaperProjectCommandComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryComposition | unknown,
	command: FramescaperProjectCommandComposition,
	options: FramescaperProjectCommandOptionsComposition = {},
): FramescaperProjectHistoryComposition {
	assertFramescaperProjectCompositionProfile(profile);
	return asHistory(executeEditorProjectCommand(history, command, revisionFor(profile), options));
}

export function undoFramescaperProjectCommandComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryComposition | unknown,
	options: FramescaperProjectCommandOptionsComposition = {},
): FramescaperProjectHistoryComposition {
	assertFramescaperProjectCompositionProfile(profile);
	return asHistory(undoEditorProjectCommand(history, revisionFor(profile), options));
}

export function redoFramescaperProjectCommandComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryComposition | unknown,
	options: FramescaperProjectCommandOptionsComposition = {},
): FramescaperProjectHistoryComposition {
	assertFramescaperProjectCompositionProfile(profile);
	return asHistory(redoEditorProjectCommand(history, revisionFor(profile), options));
}

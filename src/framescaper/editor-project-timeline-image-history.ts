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
	reconcileFramescaperProjectFeatureRequirementsTimelineImage,
} from './editor-project-feature-requirements-timeline-image.ts';
import {
	applyFramescaperProjectCommandTimelineImage,
	snapshotFramescaperProjectCommandTimelineImage,
	type FramescaperProjectCommandOptionsTimelineImage,
	type FramescaperProjectCommandTimelineImage,
} from './editor-project-timeline-image-commands.ts';
import { assertFramescaperProjectTimelineImageProfile } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImage,
} from './editor-project-timeline-image.ts';
import { validateFramescaperProjectTimelineImage } from './editor-project-timeline-image-validation.ts';

/**
 * Undo history for the Framescaper timelineImage document.
 *
 * The stack mechanics are shared (src/common/editor/project-history-mechanics.ts);
 * this module says what the timelineImage document is — how to validate, clone,
 * snapshot and apply against a runtime profile, and how its feature requirements
 * settle on a restored document — together with the reading of the stored shape
 * it keeps: an exact record, and a limit no larger than the shared one.
 */

export interface FramescaperProjectHistoryEntryTimelineImage {
	readonly project: FramescaperProjectTimelineImage;
	readonly command: FramescaperProjectCommandTimelineImage;
}

export interface FramescaperProjectHistoryTimelineImage {
	readonly limit: number;
	readonly present: FramescaperProjectTimelineImage;
	readonly undoStack: readonly FramescaperProjectHistoryEntryTimelineImage[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryTimelineImage[];
}

type Mechanics = EditorProjectHistoryRevision<
	FramescaperProjectCommandTimelineImage, FramescaperProjectCommandOptionsTimelineImage
>;

const document = (project: FramescaperProjectTimelineImage): EditorHistoryDocument => (
	project as unknown as EditorHistoryDocument
);

const asHistory = (
	state: EditorProjectHistoryState<FramescaperProjectCommandTimelineImage>,
): FramescaperProjectHistoryTimelineImage => state as unknown as FramescaperProjectHistoryTimelineImage;

function revisionFor(profile: unknown): Mechanics {
	return {
		label: 'Framescaper timelineImage',
		shape: 'exact',
		maximumLimit: AUDIO_EDITOR_HISTORY_LIMIT,
		validateProject: (project) => { validateFramescaperProjectTimelineImage(profile, project); },
		cloneProject: (project) => document(cloneFramescaperProjectTimelineImage(profile, project)),
		snapshotCommand: (command) => snapshotFramescaperProjectCommandTimelineImage(command),
		applyCommand: (project, command, options) => document(
			applyFramescaperProjectCommandTimelineImage(profile, project, command, options),
		),
		reconcileRestoredProject: (project) => {
			project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsTimelineImage(profile, project);
		},
	};
}

export function createFramescaperProjectHistoryTimelineImage(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryTimelineImage {
	assertFramescaperProjectTimelineImageProfile(profile);
	return asHistory(createEditorProjectHistory(
		project, revisionFor(profile), AUDIO_EDITOR_HISTORY_LIMIT, options,
	));
}

export function validateFramescaperProjectHistoryTimelineImage(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryTimelineImage {
	assertFramescaperProjectTimelineImageProfile(profile);
	validateEditorProjectHistory(history, revisionFor(profile));
	return true;
}

export function executeFramescaperProjectCommandTimelineImage(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsTimelineImage = {},
): FramescaperProjectHistoryTimelineImage {
	assertFramescaperProjectTimelineImageProfile(profile);
	return asHistory(executeEditorProjectCommand(history, command, revisionFor(profile), options));
}

export function undoFramescaperProjectCommandTimelineImage(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsTimelineImage = {},
): FramescaperProjectHistoryTimelineImage {
	assertFramescaperProjectTimelineImageProfile(profile);
	return asHistory(undoEditorProjectCommand(history, revisionFor(profile), options));
}

export function redoFramescaperProjectCommandTimelineImage(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsTimelineImage = {},
): FramescaperProjectHistoryTimelineImage {
	assertFramescaperProjectTimelineImageProfile(profile);
	return asHistory(redoEditorProjectCommand(history, revisionFor(profile), options));
}

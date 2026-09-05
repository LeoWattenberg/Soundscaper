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
	reconcileFramescaperProjectFeatureRequirementsNativeMedia,
} from './editor-project-feature-requirements-native-media.ts';
import {
	applyFramescaperProjectCommandNativeMedia,
	snapshotFramescaperProjectCommandNativeMedia,
	type FramescaperProjectCommandOptionsNativeMedia,
	type FramescaperProjectCommandNativeMedia,
} from './editor-project-native-media-commands.ts';
import { assertFramescaperProjectNativeMediaProfile } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectNativeMedia,
	type FramescaperProjectNativeMedia,
} from './editor-project-native-media.ts';
import { validateFramescaperProjectNativeMedia } from './editor-project-native-media-validation.ts';

/**
 * Undo history for the Framescaper nativeMedia document.
 *
 * The stack mechanics are shared (src/common/editor/project-history-mechanics.ts);
 * this module says what the nativeMedia document is — how to validate, clone,
 * snapshot and apply against a runtime profile, and how its feature requirements
 * settle on a restored document — together with the reading of the stored shape
 * it keeps: an exact record, and a limit no larger than the shared one.
 */

export interface FramescaperProjectHistoryEntryNativeMedia {
	readonly project: FramescaperProjectNativeMedia;
	readonly command: FramescaperProjectCommandNativeMedia;
}

export interface FramescaperProjectHistoryNativeMedia {
	readonly limit: number;
	readonly present: FramescaperProjectNativeMedia;
	readonly undoStack: readonly FramescaperProjectHistoryEntryNativeMedia[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryNativeMedia[];
}

type Mechanics = EditorProjectHistoryRevision<
	FramescaperProjectCommandNativeMedia, FramescaperProjectCommandOptionsNativeMedia
>;

const document = (project: FramescaperProjectNativeMedia): EditorHistoryDocument => (
	project as unknown as EditorHistoryDocument
);

const asHistory = (
	state: EditorProjectHistoryState<FramescaperProjectCommandNativeMedia>,
): FramescaperProjectHistoryNativeMedia => state as unknown as FramescaperProjectHistoryNativeMedia;

function revisionFor(profile: unknown): Mechanics {
	return {
		label: 'Framescaper nativeMedia',
		shape: 'exact',
		maximumLimit: AUDIO_EDITOR_HISTORY_LIMIT,
		validateProject: (project) => { validateFramescaperProjectNativeMedia(profile, project); },
		cloneProject: (project) => document(cloneFramescaperProjectNativeMedia(profile, project)),
		snapshotCommand: (command) => snapshotFramescaperProjectCommandNativeMedia(command),
		applyCommand: (project, command, options) => document(
			applyFramescaperProjectCommandNativeMedia(profile, project, command, options),
		),
		reconcileRestoredProject: (project) => {
			project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsNativeMedia(profile, project);
		},
	};
}

export function createFramescaperProjectHistoryNativeMedia(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryNativeMedia {
	assertFramescaperProjectNativeMediaProfile(profile);
	return asHistory(createEditorProjectHistory(
		project, revisionFor(profile), AUDIO_EDITOR_HISTORY_LIMIT, options,
	));
}

export function validateFramescaperProjectHistoryNativeMedia(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryNativeMedia {
	assertFramescaperProjectNativeMediaProfile(profile);
	validateEditorProjectHistory(history, revisionFor(profile));
	return true;
}

export function executeFramescaperProjectCommandNativeMedia(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsNativeMedia = {},
): FramescaperProjectHistoryNativeMedia {
	assertFramescaperProjectNativeMediaProfile(profile);
	return asHistory(executeEditorProjectCommand(history, command, revisionFor(profile), options));
}

export function undoFramescaperProjectCommandNativeMedia(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsNativeMedia = {},
): FramescaperProjectHistoryNativeMedia {
	assertFramescaperProjectNativeMediaProfile(profile);
	return asHistory(undoEditorProjectCommand(history, revisionFor(profile), options));
}

export function redoFramescaperProjectCommandNativeMedia(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsNativeMedia = {},
): FramescaperProjectHistoryNativeMedia {
	assertFramescaperProjectNativeMediaProfile(profile);
	return asHistory(redoEditorProjectCommand(history, revisionFor(profile), options));
}

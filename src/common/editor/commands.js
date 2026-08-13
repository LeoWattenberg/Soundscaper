/* SPDX-License-Identifier: AGPL-3.0-only */

import { commitProject } from './project.js';
import { dispatchEditorCommand } from './commands/registry.ts';
import { createEditorCommandRuntime } from './commands/runtime-registry.ts';
import { pruneMissingProjectSelections } from './commands/shared-runtime.js';
import { isFoundationProjectSchema, projectForCommandConsumers } from './project-current-runtime.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	isTrackFolderProjectSchema,
} from './project-schema-version.ts';
import { brandRuntimeProjectProjection } from './runtime-clip-projection.ts';
import {
	FOUNDATION_EDIT_OPERATION,
	LEGACY_TRACK_STRUCTURE_EDIT,
} from './commands/command-projection-transients.ts';
import { createTrackLockAdmission } from './commands/track-lock-admission.ts';
import {
	createVideoRetimePreservationAdmission,
} from './commands/video-retime-preservation-admission.ts';

export {
	collectClipTransformIds,
	collectClipTrimIds,
	collectRelatedClipIds,
	resolveEditingSelection,
} from './commands/clip-basic-runtime.js';
export {
	prepareOverwriteClipCommand,
	prepareTransformClipsCommand,
} from './commands/clip-transform-runtime.js';
export {
	prepareGroupClipsCommand,
	prepareLinkedSplitCommand,
	prepareLinkAvCommand,
	prepareSplitCommand,
	prepareUnlinkAvCommand,
} from './commands/clip-link-runtime.js';
export {
	createClipboardDescriptor,
	prepareCut,
	preparePasteCommand,
} from './commands/clipboard-runtime.js';
export {
	prepareDisjointRangeDeleteCommand,
	prepareKeepRangeCommand,
	preparePunchCommand,
	prepareRangeDeleteCommand,
	prepareRangeReplacementCommand,
} from './commands/range-runtime.js';
export {
	createAddClipCommand,
	createAddLabelCommand,
	createAddLabelTrackCommand,
	createAddSignatureEventCommand,
	createAddSourceCommand,
	createAddTempoEventCommand,
	createAddTimelineAnnotationCommand,
	createAddTrackCommand,
	createAddTrackFolderCommand,
	createAddVideoEffectCommand,
	createBypassVideoEffectCommand,
	createBatchSetTimelineAnnotationsCommand,
	createConvertTimelineAnnotationCommand,
	createMoveTimelineAnnotationsCommand,
	createMoveTrackNodeCommand,
	createRemoveTimelineAnnotationsCommand,
	createRemoveTrackFolderCommand,
	createRemoveVideoEffectCommand,
	createRemoveSignatureEventCommand,
	createRemoveTempoEventCommand,
	createReorderVideoEffectCommand,
	createReplaceClipSourceCommand,
	createResizeTimelineAnnotationCommand,
	createSetTempoMapModeCommand,
	createSetVideoKeyframesCommand,
	createUpdateSequenceTimingCommand,
	createUpdateSignatureEventCommand,
	createUpdateTempoEventCommand,
	createUpdateTimelineAnnotationsCommand,
	createUpdateTrackFolderCommand,
	createUpdateVideoEffectCommand,
} from './commands/factories.ts';

/**
 * @typedef {import('./commands/protocol.ts').AudioEditorCommand} AudioEditorCommand
 */

/**
 * @typedef {
 *   import('./project-v2.js').AudioEditorProjectV2
 *   | import('./project-v3.js').AudioEditorProjectV3
 *   | import('./project-v4.js').AudioEditorProjectV4
 *   | import('./project-v5.js').AudioEditorProjectV5
 *   | import('./project-v6.ts').AudioEditorProjectV6
 *   | import('./project-v7.ts').AudioEditorProjectV7
 *   | import('./project-v8.ts').AudioEditorProjectV8
 *   | import('./project-v9.ts').AudioEditorProjectV9
 *   | import('./project-v10.ts').AudioEditorProjectV10
 *   | import('./project-v11.ts').AudioEditorProjectV11
 *   | import('./project-v12.ts').AudioEditorProjectV12
 *   | import('./project-v13.ts').AudioEditorProjectV13
 *   | import('./project-v14.ts').AudioEditorProjectV14
 *   | import('./project-v15.ts').AudioEditorProjectV15
 *   | import('./project-v16.ts').AudioEditorProjectV16
 *   | import('./project-v17.ts').AudioEditorProjectV17
 * } CurrentAudioEditorProject
 */

/**
 * Apply one serializable command through the exhaustive runtime registry.
 * Batches recurse into the same mutable draft and therefore produce one commit.
 *
 * @template {CurrentAudioEditorProject} Project
 * @param {Project} project
 * @param {AudioEditorCommand} command
 * @returns {Project}
 */
export function applyEditorCommand(project, command, options = {}) {
	if (!Number.isSafeInteger(project?.schemaVersion)
		|| project.schemaVersion < 2
		|| project.schemaVersion > AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		throw new RangeError('Editor commands require a current audio editor project.');
	}
	if (!command || typeof command.type !== 'string') {
		throw new TypeError('A serializable editor command is required.');
	}
	const commandProject = projectForCommandConsumers(project);
	const admission = createCommandAdmission(project, commandProject);
	const mutate = createCommandMutator(admission);
	const result = /** @type {Project} */ (commitProject(commandProject, (draft) => {
		if (isFoundationProjectSchema(project.schemaVersion)) {
			brandRuntimeProjectProjection(draft);
		}
		mutate(draft, command);
		pruneMissingProjectSelections(draft);
	}, { ...options, persistedBase: project }));
	admission.assertPersistedResult(result);
	return result;
}

function createCommandAdmission(persistedProject, commandProject) {
	const admissions = [
		createTrackLockAdmission(persistedProject, commandProject),
		createVideoRetimePreservationAdmission(persistedProject, commandProject),
	];
	return Object.freeze({
		beforeCommand: (project, command) => {
			for (const admission of admissions) admission.beforeCommand(project, command);
		},
		afterCommand: (project) => {
			for (const admission of admissions) admission.afterCommand(project);
		},
		assertPersistedResult: (project) => {
			for (const admission of admissions) admission.assertPersistedResult(project);
		},
	});
}

function createCommandMutator(admission) {
	let handlers;
	const mutate = (project, command) => mutateCommand(project, command, handlers, admission);
	handlers = createEditorCommandRuntime(mutate);
	return mutate;
}

function mutateCommand(project, command, handlers, admission) {
	const isChild = command.type !== 'batch';
	if (isChild) admission.beforeCommand(project, command);
	if (isTrackFolderProjectSchema(project.schemaVersion)
		&& (command.type === 'track/add' || command.type === 'track/remove' || command.type === 'track/reorder')
		&& !(Array.isArray(project.trackFolders) && project.trackFolders.length > 0)) {
		project[LEGACY_TRACK_STRUCTURE_EDIT] = true;
	}
	if (isFoundationProjectSchema(project.schemaVersion) && isChild) {
		const before = new Map(project.clips.map((clip) => [clip.id, commandTimingSignature(clip)]));
		dispatchEditorCommand(handlers, project, command);
		const operation = {};
		for (const clip of project.clips) {
			const previous = before.get(clip.id);
			if (previous != null && previous !== commandTimingSignature(clip)) {
				clip[FOUNDATION_EDIT_OPERATION] = operation;
			}
		}
		admission.afterCommand(project);
		return;
	}
	dispatchEditorCommand(handlers, project, command);
	if (isChild) admission.afterCommand(project);
}

function commandTimingSignature(clip) {
	return [
		clip.timelineStartFrame,
		clip.durationFrames,
		clip.sourceStartFrame,
		clip.sourceDurationFrames,
	].map((value) => `${typeof value}:${String(value)}`).join('|');
}

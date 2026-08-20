/* SPDX-License-Identifier: AGPL-3.0-only */

import { commitProject } from './project.js';
import { projectForCommandConsumers } from './project-current-runtime.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
} from './project-schema-version.ts';
import { createEditorCommandMutationTransaction } from './commands/mutation-transaction.ts';

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

/** @typedef {import('./project-v17.ts').AudioEditorProjectV17} CurrentAudioEditorProject */

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
	if (project?.schemaVersion !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		throw new RangeError('Editor commands require a current audio editor project.');
	}
	if (!command || typeof command.type !== 'string') {
		throw new TypeError('A serializable editor command is required.');
	}
	const commandProject = projectForCommandConsumers(project);
	const transaction = createEditorCommandMutationTransaction(project, commandProject);
	const result = /** @type {Project} */ (commitProject(commandProject, (draft) => {
		transaction.mutate(draft, command);
	}, { ...options, persistedBase: project }));
	transaction.assertPersistedResult(result);
	return result;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { commitProject } from './project.js';
import { dispatchEditorCommand } from './commands/registry.ts';
import { createEditorCommandRuntime } from './commands/runtime-registry.ts';
import { pruneMissingProjectSelections } from './commands/shared-runtime.js';
import { projectForCommandConsumers } from './project-current-runtime.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
import { brandRuntimeProjectProjection } from './runtime-clip-projection.ts';
import { FOUNDATION_EDIT_OPERATION } from './commands/command-projection-transients.ts';

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
	createAddTrackCommand,
	createAddVideoEffectCommand,
	createBypassVideoEffectCommand,
	createRemoveVideoEffectCommand,
	createRemoveSignatureEventCommand,
	createRemoveTempoEventCommand,
	createReorderVideoEffectCommand,
	createReplaceClipSourceCommand,
	createSetTempoMapModeCommand,
	createUpdateSignatureEventCommand,
	createUpdateTempoEventCommand,
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
	return /** @type {Project} */ (commitProject(commandProject, (draft) => {
		if (project.schemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
			brandRuntimeProjectProjection(draft);
		}
		mutateCommand(draft, command);
		pruneMissingProjectSelections(draft);
	}, { ...options, persistedBase: project }));
}

const editorCommandHandlers = createEditorCommandRuntime(mutateCommand);

function mutateCommand(project, command) {
	if (project.schemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION && command.type !== 'batch') {
		const before = new Map(project.clips.map((clip) => [clip.id, commandTimingSignature(clip)]));
		dispatchEditorCommand(editorCommandHandlers, project, command);
		const operation = {};
		for (const clip of project.clips) {
			const previous = before.get(clip.id);
			if (previous != null && previous !== commandTimingSignature(clip)) {
				clip[FOUNDATION_EDIT_OPERATION] = operation;
			}
		}
		return;
	}
	dispatchEditorCommand(editorCommandHandlers, project, command);
}

function commandTimingSignature(clip) {
	return [
		clip.timelineStartFrame,
		clip.durationFrames,
		clip.sourceStartFrame,
		clip.sourceDurationFrames,
	].map((value) => `${typeof value}:${String(value)}`).join('|');
}

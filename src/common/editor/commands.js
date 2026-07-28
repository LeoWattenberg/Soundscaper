/* SPDX-License-Identifier: AGPL-3.0-only */

import { commitProject } from './project.js';
import { dispatchEditorCommand } from './commands/registry.ts';
import { createEditorCommandRuntime } from './commands/runtime-registry.ts';
import { pruneMissingProjectSelections } from './commands/shared-runtime.js';

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
	createAddSourceCommand,
	createAddTrackCommand,
	createAddVideoEffectCommand,
	createBypassVideoEffectCommand,
	createRemoveVideoEffectCommand,
	createReorderVideoEffectCommand,
	createReplaceClipSourceCommand,
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
	if (![2, 3, 4, 5, 6].includes(project?.schemaVersion)) {
		throw new RangeError('Editor commands require a current audio editor project.');
	}
	if (!command || typeof command.type !== 'string') {
		throw new TypeError('A serializable editor command is required.');
	}
	return /** @type {Project} */ (commitProject(project, (draft) => {
		mutateCommand(draft, command);
		pruneMissingProjectSelections(draft);
	}, options));
}

const editorCommandHandlers = createEditorCommandRuntime(mutateCommand);

function mutateCommand(project, command) {
	dispatchEditorCommand(editorCommandHandlers, project, command);
}

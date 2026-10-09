/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateFrameResourceProjectFoundationV2 } from '../project-v17-validation.ts';
import { projectForCommandConsumers, preparePersistedProjectCommandDraft } from '../project-current-runtime.ts';
import { createEditorCommandMutationTransactionForFrameV2 } from './mutation-transaction.ts';
import { applyDefaultClipMicrofades } from './default-microfades.ts';
import type { CurrentAudioEditorMutationCommandV2 } from './clipboard-command-v2.ts';

/** A named transient current Frame owner. The public V17 command/validation
 * routes remain unchanged and refuse resource leaves. The ordinary transaction
 * retains track-lock, retime, timing reconciliation and selection authority. */
export function applyFrameResourceFoundationCommandV2<Project extends Record<string, unknown>>(project: Project,
	command: CurrentAudioEditorMutationCommandV2, options: Readonly<{ now?: Date | string; microfadeNewClips?: boolean }> = {}): Project {
	validateFrameResourceProjectFoundationV2(project);
	if (!command || typeof command.type !== 'string') throw new TypeError('A serializable editor command is required.');
	const commandProject = projectForCommandConsumers(project);
	const transaction = createEditorCommandMutationTransactionForFrameV2(project, commandProject);
	const draft = structuredClone(commandProject) as Project;
	transaction.mutate(draft, command);
	if (options.microfadeNewClips === true) applyDefaultClipMicrofades(
		commandProject as unknown as Parameters<typeof applyDefaultClipMicrofades>[0],
		draft as unknown as Parameters<typeof applyDefaultClipMicrofades>[1],
	);
	const date = options.now === undefined ? new Date() : new Date(options.now);
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid timestamp is required.');
	const mutable = draft as Record<string, unknown>;
	mutable.revision = Number(project.revision) + 1;
	mutable.updatedAt = date.toISOString();
	preparePersistedProjectCommandDraft(mutable, project);
	validateFrameResourceProjectFoundationV2(draft);
	transaction.assertPersistedResult(draft);
	return draft;
}

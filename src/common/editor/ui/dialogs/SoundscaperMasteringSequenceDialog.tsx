/* SPDX-License-Identifier: AGPL-3.0-only */

import '../audio-editor-design-system/12a-dialog-mastering-sequences.css';

import React from 'react';

import {
	createDocumentMasteringSequenceSnapshot,
	type DocumentMasteringSequenceDocumentSnapshot,
} from '../../controller/document-mastering-sequence-snapshot.ts';
import { hasMasteringSequenceProjectAuthority } from '../../project-schema-version.ts';
import { createStableId } from '../../stable-id.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { audioEditorProjectSampleRate } from '../AudioEditorTimeCodeInput.tsx';
import {
	AUDIO_EDITOR_EDIT_BLOCK_REASONS,
	selectAudioEditorEditBlock,
	type AudioEditorEditBlockingSnapshot,
} from '../edit-blocking.ts';
import type { SoundscaperMasteringSequenceCopy } from '../soundscaper-mastering-sequence-copy.ts';
import { useProjectOwnedDialogOperation } from '../useProjectOwnedDialogOperation.ts';
import SoundscaperMasteringSequenceEditor from './SoundscaperMasteringSequenceEditor.tsx';
import type { MasteringSequenceDialogOperation } from './soundscaper-mastering-sequence-operation.ts';

export interface SoundscaperMasteringSequenceDialogProps {
	readonly isOpen?: boolean;
	readonly controller: Readonly<{
		readonly actions: Readonly<{
			readonly edit: Readonly<{
				commit(operation: MasteringSequenceDialogOperation): unknown;
			}>;
		}>;
	}>;
	readonly snapshot: AudioEditorEditBlockingSnapshot & Readonly<{
		readonly project?: unknown;
		readonly masteringSequences?: DocumentMasteringSequenceDocumentSnapshot;
	}>;
	readonly copy: SoundscaperMasteringSequenceCopy;
	readonly locale?: string;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

/** Focused authoring surface for the document's mastering sequence commands. */
export default function SoundscaperMasteringSequenceDialog({
	isOpen = true,
	controller,
	snapshot,
	copy,
	run,
	onClose,
}: SoundscaperMasteringSequenceDialogProps) {
	const project = snapshot.project;
	const document = snapshot.masteringSequences
		?? createDocumentMasteringSequenceSnapshot(project);
	const editBlock = selectAudioEditorEditBlock(snapshot);
	const supported = hasMasteringSequenceProjectAuthority(project);
	const blocked = !supported || editBlock.blocked;
	const operation = useProjectOwnedDialogOperation<MasteringSequenceDialogOperation>({
		project,
		blocked,
		success: copy.operationComplete,
		execute: (command) => controller.actions.edit.commit(command),
		run,
		onProjectChange: () => undefined,
	});
	const blockedMessage = !supported
		? copy.unsupported
		: editBlock.reason === AUDIO_EDITOR_EDIT_BLOCK_REASONS.READ_ONLY
			? copy.readOnly
			: editBlock.blocked ? copy.busy : '';
	const feedback = operation.error
		|| (operation.pending ? `${copy.masteringSequencesTitle}…` : operation.status)
		|| blockedMessage;

	return <AudioEditorDialogShell
		isOpen={isOpen}
		title={copy.masteringSequencesTitle}
		onClose={onClose}
		width={920}
		initialFocus="[data-mastering-sequence-picker]"
		className="soundscaper-mastering-sequence-dialog"
		dataAttributes={{ 'data-soundscaper-mastering-sequence-dialog': true }}
	>
		<SoundscaperMasteringSequenceEditor
			copy={copy}
			disabled={operation.disabled}
			sequences={document.sequences}
			regions={document.regions}
			primarySequenceId={document.primarySequenceId}
			sampleRate={audioEditorProjectSampleRate(project)}
			createId={() => createStableId('mastering-sequence')}
			onOperation={(command) => operation.perform('mastering-sequence', () => command)}
		/>
		<div role="status" aria-live="polite" aria-atomic="true">{feedback}</div>
	</AudioEditorDialogShell>;
}

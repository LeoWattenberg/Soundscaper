/* SPDX-License-Identifier: AGPL-3.0-only */

import { planClipSpreadsheetEdits, type ClipSpreadsheetEdit } from '../../../clip-spreadsheet.ts';
import { selectAudioEditorControllerEditBlock, type AudioEditorControllerEditState } from '../../../edit-blocking.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';

interface ClipSpreadsheetActionDependencies {
	readonly state: AudioEditorControllerEditState;
	getProject(): Readonly<{ id: string }> | null;
	commit(command: AudioEditorCommand): unknown;
}

/** A paste is one commit, with the same edit admission as every timeline mutation. */
export function createClipSpreadsheetAction(dependencies: ClipSpreadsheetActionDependencies) {
	return (projectId: string, edits: readonly ClipSpreadsheetEdit[]): unknown => {
		const project = dependencies.getProject();
		if (!project || project.id !== projectId) throw new RangeError('The spreadsheet project is no longer open.');
		if (selectAudioEditorControllerEditBlock(dependencies.state).blocked) throw new RangeError('Clip editing is currently unavailable.');
		const command = planClipSpreadsheetEdits(project, edits);
		return command ? dependencies.commit(command) : null;
	};
}

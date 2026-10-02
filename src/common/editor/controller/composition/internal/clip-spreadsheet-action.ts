/* SPDX-License-Identifier: AGPL-3.0-only */

import { planClipSpreadsheetEdits, type ClipSpreadsheetEdit } from '../../../clip-spreadsheet.ts';
import { selectAudioEditorControllerEditBlock, type AudioEditorControllerEditState } from '../../../edit-blocking.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';

interface ClipSpreadsheetActionDependencies {
	readonly state: AudioEditorControllerEditState & Readonly<{ missingSourceIds?: ReadonlySet<string> }>;
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
		if (command) assertSourcesAvailable(command, dependencies.state.missingSourceIds);
		return command ? dependencies.commit(command) : null;
	};
}

function assertSourcesAvailable(command: AudioEditorCommand, missingSourceIds?: ReadonlySet<string>): void {
	if (!missingSourceIds?.size) return;
	if (command.type === 'batch') {
		for (const child of command.commands) assertSourcesAvailable(child, missingSourceIds);
	} else if (command.type === 'clip/transform-many') {
		for (const { changes } of command.transforms) {
			const sourceId = changes.sourceId;
			if (typeof sourceId === 'string' && missingSourceIds.has(sourceId)) {
				throw new RangeError(`Relink the missing source before editing clips: ${sourceId}`);
			}
		}
	}
}

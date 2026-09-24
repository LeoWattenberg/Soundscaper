/* SPDX-License-Identifier: AGPL-3.0-only */

import { applyEditorCommand, createAddSourceCommand, preparePunchCommand } from '../../../commands.js';

/** Prepare successive punches against the clips created by preceding punches. */
export function prepareRecordingPunchSequence(project, segments) {
	let draft = project;
	const commands = [];
	for (const { source, punch } of segments) {
		const addSource = createAddSourceCommand(source);
		const replaceRange = preparePunchCommand(draft, punch);
		commands.push(addSource, replaceRange);
		draft = applyEditorCommand(draft, { type: 'batch', commands: [addSource, replaceRange] });
	}
	return commands;
}

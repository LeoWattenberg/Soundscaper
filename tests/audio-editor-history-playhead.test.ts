/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	collapseEditorHistory,
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	rollbackEditorHistory,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import {
	createSoundscaperProjectHistory,
	executeSoundscaperProjectCommand,
	undoSoundscaperProjectCommand,
	validateSoundscaperProjectHistory,
} from '../src/soundscaper/editor-project-history.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const CREATED_AT = '2026-09-06T10:00:00.000Z';

const rename = (title: string): AudioEditorCommand => ({ type: 'project/rename', title });

function history() {
	return createEditorHistory(createCurrentAudioEditorProject({ now: CREATED_AT }));
}

test('undo puts the playhead back where it was before the command it undoes', () => {
	const first = executeEditorCommand(history(), rename('First'), { playheadFrame: 48_000 });
	const second = executeEditorCommand(first, rename('Second'), { playheadFrame: 96_000 });
	assert.equal(second.playheadFrame, 96_000, 'a command records where it was run from');

	const undone = undoEditorCommand(second, { playheadFrame: 120_000 });
	assert.equal(undone.playheadFrame, 96_000);

	const undoneAgain = undoEditorCommand(undone, { playheadFrame: 96_000 });
	assert.equal(undoneAgain.playheadFrame, 48_000, 'each step back restores that step’s position');
});

test('redo puts the playhead back where the undo left it', () => {
	const executed = executeEditorCommand(history(), rename('Edited'), { playheadFrame: 48_000 });
	const undone = undoEditorCommand(executed, { playheadFrame: 120_000 });

	const redone = redoEditorCommand(undone, { playheadFrame: 48_000 });

	assert.equal(redone.playheadFrame, 120_000);
	assert.equal(undoEditorCommand(redone, { playheadFrame: 120_000 }).playheadFrame, 48_000);
});

test('a history never told where the playhead is restores the document alone', () => {
	const executed = executeEditorCommand(history(), rename('Edited'));

	assert.equal(executed.playheadFrame, undefined);
	assert.equal(executed.undoStack[0]?.playheadFrame, undefined);
	assert.equal(undoEditorCommand(executed).playheadFrame, undefined, 'no position is not position zero');
});

test('a command that cannot see the transport keeps the position undo would restore', () => {
	const executed = executeEditorCommand(history(), rename('First'), { playheadFrame: 48_000 });

	const second = executeEditorCommand(executed, rename('Second'));

	assert.equal(second.playheadFrame, 48_000);
	assert.equal(undoEditorCommand(second).playheadFrame, 48_000);
});

test('a macro restores the playhead the run started from, however it settles', () => {
	const opened = executeEditorCommand(history(), rename('Before'), { playheadFrame: 24_000 });
	const first = executeEditorCommand(opened, rename('Step one'), { playheadFrame: 48_000 });
	const second = executeEditorCommand(first, rename('Step two'), { playheadFrame: 72_000 });
	const depth = opened.dropped + opened.undoStack.length;

	const collapsed = collapseEditorHistory(second, depth, { type: 'macro/run', name: 'Steps' });
	assert.equal(collapsed.undoStack.length, depth + 1);
	assert.equal(undoEditorCommand(collapsed, { playheadFrame: 96_000 }).playheadFrame, 48_000);

	assert.equal(rollbackEditorHistory(second, depth).playheadFrame, 48_000);
});

test('a stored playhead that is not a frame is refused with the history', () => {
	const executed = executeSoundscaperProjectCommand(
		createSoundscaperProjectHistory(createSoundscaperProject({ now: CREATED_AT })),
		{ type: 'project/rename', title: 'Edited' },
		{ playheadFrame: 48_000 },
	);

	assert.equal(undoSoundscaperProjectCommand(executed, { playheadFrame: 96_000 }).playheadFrame, 48_000);
	assert.throws(
		() => validateSoundscaperProjectHistory({ ...executed, playheadFrame: -1 }),
		/playhead frame must be a non-negative safe integer/u,
	);
	assert.throws(
		() => validateSoundscaperProjectHistory({
			...executed,
			undoStack: [{ ...executed.undoStack[0]!, playheadFrame: 1.5 }],
		}),
		/playhead frame must be a non-negative safe integer/u,
	);
});

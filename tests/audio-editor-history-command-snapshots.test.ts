/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperProjectHistorySequence,
	executeFramescaperProjectCommandSequence,
	redoFramescaperProjectCommandSequence,
	undoFramescaperProjectCommandSequence,
} from '../src/framescaper/editor-project-sequence-history.ts';
import { createFramescaperProjectSequence } from '../src/framescaper/editor-project-sequence.ts';
import {
	createSoundscaperProjectHistory,
	executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand,
	undoSoundscaperProjectCommand,
} from '../src/soundscaper/editor-project-history.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const CREATED_AT = '2026-08-28T10:00:00.000Z';
const EDITED_AT = '2026-08-28T10:01:00.000Z';
const UNDONE_AT = '2026-08-28T10:02:00.000Z';
const REDONE_AT = '2026-08-28T10:03:00.000Z';

test('common history snapshots commands at every history ownership boundary', () => {
	const command: AudioEditorCommand = { type: 'project/rename', title: 'Edited' };
	const initial = createEditorHistory(createCurrentAudioEditorProject({ now: CREATED_AT }));
	const executed = executeEditorCommand(initial, command, { now: EDITED_AT });
	assert.notStrictEqual(executed.undoStack[0]?.command, command);

	const undone = undoEditorCommand(executed, { now: UNDONE_AT });
	assert.notStrictEqual(undone.redoStack[0]?.command, executed.undoStack[0]?.command);

	const redone = redoEditorCommand(undone, { now: REDONE_AT });
	assert.notStrictEqual(redone.undoStack[0]?.command, undone.redoStack[0]?.command);
});

test('Soundscaper production history snapshots commands when moving between stacks', () => {
	const command = { type: 'project/rename', title: 'Edited' } as const;
	const initial = createSoundscaperProjectHistory(createSoundscaperProject({ now: CREATED_AT }));
	const executed = executeSoundscaperProjectCommand(initial, command, { now: EDITED_AT });
	assert.notStrictEqual(executed.undoStack[0]?.command, command);

	const undone = undoSoundscaperProjectCommand(executed, { now: UNDONE_AT });
	assert.notStrictEqual(undone.redoStack[0]?.command, executed.undoStack[0]?.command);

	const redone = redoSoundscaperProjectCommand(undone, { now: REDONE_AT });
	assert.notStrictEqual(redone.undoStack[0]?.command, undone.redoStack[0]?.command);
});

test('Framescaper sequence history snapshots commands when moving between stacks', () => {
	const command: AudioEditorCommand = { type: 'project/rename', title: 'Edited' };
	const project = createFramescaperProjectSequence(
		FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
		{ now: CREATED_AT },
	);
	const initial = createFramescaperProjectHistorySequence(
		FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
		project,
	);
	const executed = executeFramescaperProjectCommandSequence(
		FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
		initial,
		command,
		{ now: EDITED_AT },
	);
	assert.notStrictEqual(executed.undoStack[0]?.command, command);

	const undone = undoFramescaperProjectCommandSequence(
		FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
		executed,
		{ now: UNDONE_AT },
	);
	assert.notStrictEqual(undone.redoStack[0]?.command, executed.undoStack[0]?.command);

	const redone = redoFramescaperProjectCommandSequence(
		FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
		undone,
		{ now: REDONE_AT },
	);
	assert.notStrictEqual(redone.undoStack[0]?.command, undone.redoStack[0]?.command);
});

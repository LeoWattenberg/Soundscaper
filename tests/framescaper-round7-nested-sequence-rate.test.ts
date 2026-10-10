/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperNestedSequenceMenuItems } from '../src/common/editor/ui/framescaper-nested-sequence-menu.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { validateFramescaperSubsequencesSequence } from '../src/framescaper/editor-project-sequence-subsequence.ts';

const copy = { nestedSequences: 'Nested sequences', createSequence: 'Create shared sequence', addNestedSequence: 'Add nested placement',
	updateNestedSequence: 'Move nested sequence', removeNestedSequence: 'Remove nested sequence', deleteSequence: 'Delete shared sequence' };

for (const sequenceId of ['main', 'shared-sequence-1']) test(`Project properties can change the rate of a referenced nested sequence: ${sequenceId}`, () => {
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	let history = runtime.createHistory(createFramescaperProject(PROFILE, { id: 'programme',
		sequences: [{ id: 'main', name: 'Main', rate: { num: 30, den: 1 }, trackIds: [] }], primarySequenceId: 'main' }));
	const menu = () => createFramescaperNestedSequenceMenuItems({ productId: 'framescaper', project: history.present, editingBlocked: false, copy }, {
		execute(command) { history = runtime.executeCommand(history, command as never); },
	});
	menu()?.items[0]?.onClick();
	history = runtime.executeCommand(history, { type: 'sequence/update', sequenceId: 'shared-sequence-1', changes: { rate: { num: 25, den: 1 } } });
	assert.deepEqual(history.present.sequences.find(sequence => sequence.id === 'shared-sequence-1')?.rate, { num: 25, den: 1 },
		'the ordinary rate control succeeds before the menu placement exists');
	menu()?.items[1]?.onClick();
	assert.equal(validateFramescaperSubsequencesSequence(PROFILE, history.present).length, 1);
	history = runtime.executeCommand(history, { type: 'sequence/update', sequenceId, changes: { name: 'Nested timing review' } });
	menu()?.items[2]?.onClick();
	const before = history;
	const placement = validateFramescaperSubsequencesSequence(PROFILE, before.present)[0];
	const rate = sequenceId === 'main' ? { num: 24, den: 1 } : { num: 30, den: 1 };
	history = runtime.executeCommand(history, { type: 'sequence/update', sequenceId, changes: { rate } });
	assert.deepEqual(history.present.sequences.find(sequence => sequence.id === sequenceId)?.rate, rate);
	assert.deepEqual(validateFramescaperSubsequencesSequence(PROFILE, history.present)[0], { ...placement,
		...(sequenceId === 'main' ? { sequenceStartFrame: 24, sequenceFrameCount: 24 } : { sourceFrameCount: 30 }) });
	assert.equal(history.undoStack.length, before.undoStack.length + 1);
	const undone = runtime.undo(history);
	assert.deepEqual(validateFramescaperSubsequencesSequence(PROFILE, undone.present), [placement]);
	assert.deepEqual(undone.present.sequences, before.present.sequences);
	assert.deepEqual(validateFramescaperSubsequencesSequence(PROFILE, runtime.redo(undone).present),
		validateFramescaperSubsequencesSequence(PROFILE, history.present));
	assert.throws(() => runtime.executeCommand(history, { type: 'sequence/update', sequenceId,
		changes: { rate: { num: 30_000, den: 1_001 } } }), /off its exact frame grid/u,
		'a rate with no exact representation of the existing one-second placement still refuses instead of changing its duration');
	assert.deepEqual(validateFramescaperSubsequencesSequence(PROFILE, history.present)[0], { ...placement,
		...(sequenceId === 'main' ? { sequenceStartFrame: 24, sequenceFrameCount: 24 } : { sourceFrameCount: 30 }) });
});

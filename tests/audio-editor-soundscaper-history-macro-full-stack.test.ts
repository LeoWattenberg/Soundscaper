/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAddTrackCommand } from '../src/common/editor/commands/factories.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import {
	collapseSoundscaperProjectHistory,
	createSoundscaperProjectHistory,
	executeSoundscaperProjectCommand,
	rollbackSoundscaperProjectHistory,
	undoSoundscaperProjectCommand,
	type SoundscaperProjectHistory,
} from '../src/soundscaper/editor-project-history.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const NOW = '2026-09-05T09:00:00.000Z';
const LIMIT = 4;

/**
 * Where a macro opens, read the way the macro transaction reads it
 * (src/common/editor/controller/project-mutation-service.ts): a position in the
 * whole sequence of commits, so the bounded stack shifting underneath it while
 * the macro runs cannot make it name a different entry.
 */
function macroDepth(history: SoundscaperProjectHistory): number {
	const value = history as unknown as Readonly<{ dropped?: unknown }>;
	return (typeof value.dropped === 'number' ? value.dropped : 0) + history.undoStack.length;
}

function trackNames(history: SoundscaperProjectHistory): readonly string[] {
	return history.present.tracks.map(({ name }) => String(name));
}

function commit(history: SoundscaperProjectHistory, name: string): SoundscaperProjectHistory {
	return executeSoundscaperProjectCommand(
		history,
		createAddTrackCommand(createAudioTrack({ id: name, name, clipIds: [] })),
		{ now: NOW },
	);
}

function historyWith(names: readonly string[]): SoundscaperProjectHistory {
	let history = createSoundscaperProjectHistory(createSoundscaperProject({
		id: 'macro-full-stack-project',
		title: 'Macro full stack',
		now: NOW,
		tracks: [createAudioTrack({ id: 'voice', name: 'voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
	}), { limit: LIMIT });
	for (const name of names) history = commit(history, name);
	return history;
}

test('a macro that opens on a full undo stack still collapses to one entry', () => {
	const before = historyWith(['user-a', 'user-b', 'user-c', 'user-d']);
	assert.equal(before.undoStack.length, LIMIT, 'the stack is at its limit before the macro runs');
	const depth = macroDepth(before);
	const started = trackNames(before);

	let history = before;
	for (const name of ['macro-1', 'macro-2']) history = commit(history, name);
	assert.equal(history.undoStack.length, LIMIT, 'the macro pushed the oldest entries off the end');

	const collapsed = collapseSoundscaperProjectHistory(history, depth, { type: 'macro/run', name: 'Restoration' });
	assert.deepEqual(trackNames(collapsed), trackNames(history), 'collapsing changes the history, never the project');
	assert.equal(collapsed.undoStack.length, LIMIT - 1, 'the two macro entries became one');
	assert.deepEqual(collapsed.undoStack.at(-1)?.command, { type: 'macro/run', name: 'Restoration' });

	const undone = undoSoundscaperProjectCommand(collapsed, { now: NOW });
	assert.deepEqual(trackNames(undone), started, 'one undo reverts the whole macro');
	assert.equal(undone.undoStack.length, LIMIT - 2, 'the user\'s own surviving history is untouched');
});

test('a macro that opens on a full undo stack rolls back to the project it began from', () => {
	const before = historyWith(['user-a', 'user-b', 'user-c', 'user-d']);
	const depth = macroDepth(before);
	const started = trackNames(before);

	let history = before;
	for (const name of ['macro-1', 'macro-2']) history = commit(history, name);

	const rolled = rollbackSoundscaperProjectHistory(history, depth, { now: NOW });
	assert.deepEqual(trackNames(rolled), started, 'the work the macro applied is gone');
	assert.equal(rolled.undoStack.length, LIMIT - 2, 'and so are the entries it committed');
	assert.deepEqual(rolled.redoStack, []);
	assert.equal(Number(rolled.present.revision), Number(history.present.revision) + 1);
});

test('a macro that fills the last free slot rolls back past its own steps', () => {
	const before = historyWith(['user-a', 'user-b', 'user-c']);
	assert.equal(before.undoStack.length, LIMIT - 1, 'one slot short of the limit');
	const depth = macroDepth(before);
	const started = trackNames(before);

	let history = before;
	for (const name of ['macro-1', 'macro-2', 'macro-3']) history = commit(history, name);

	const rolled = rollbackSoundscaperProjectHistory(history, depth, { now: NOW });
	assert.deepEqual(trackNames(rolled), started, 'rollback restores the pre-macro project, not a mid-macro one');
	assert.equal(rolled.undoStack.length, LIMIT - 3);
});

test('a macro that committed nothing still collapses and rolls back to nothing', () => {
	const history = historyWith(['user-a', 'user-b', 'user-c', 'user-d']);
	const depth = macroDepth(history);
	assert.strictEqual(collapseSoundscaperProjectHistory(history, depth, { type: 'macro/run' }), history);
	assert.strictEqual(rollbackSoundscaperProjectHistory(history, depth), history);
	assert.throws(() => collapseSoundscaperProjectHistory(history, -1, { type: 'macro/run' }), /non-negative/u);
	assert.throws(() => rollbackSoundscaperProjectHistory(history, 1.5), /non-negative/u);
});

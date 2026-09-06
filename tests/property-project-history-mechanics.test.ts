/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Property coverage for the shared undo/redo mechanics.
 *
 * One implementation carries the undo stack for every document either product
 * edits, so its invariants are worth stating over arbitrary op sequences rather
 * than a scripted one: the stacks stay inside the limit, a commit clears redo,
 * undo and redo are inverses of one another, and the dropped count keeps naming
 * a position in the whole run of commits even after the limit has eaten into it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import {
	collapseEditorProjectHistory,
	createEditorProjectHistory,
	executeEditorProjectCommand,
	redoEditorProjectCommand,
	rollbackEditorProjectHistory,
	undoEditorProjectCommand,
	validateEditorProjectHistory,
	type EditorHistoryDocument,
	type EditorProjectHistoryRevision,
	type EditorProjectHistoryState,
} from '../src/common/editor/project-history-mechanics.ts';

const SEED = 20_260_906;
const RUNS = 200;

interface StepCommand {
	readonly step: number;
}

type History = EditorProjectHistoryState<StepCommand>;

const REVISION: EditorProjectHistoryRevision<StepCommand> = {
	label: 'Property',
	tracksDropped: true,
	validateProject: (project) => {
		const document = project as EditorHistoryDocument | null;
		if (!document || typeof document !== 'object') throw new TypeError('A document is required.');
		if (document.id !== 'property-document') throw new RangeError('A document keeps its ID.');
		if (!Number.isSafeInteger(document.revision)) throw new RangeError('A document revision is an integer.');
		if (!Array.isArray(document.payload)) throw new RangeError('A document carries its payload.');
	},
	cloneProject: (project) => structuredClone(project) as EditorHistoryDocument,
	snapshotCommand: (command) => ({ step: Number((command as StepCommand).step) }),
	applyCommand: (project, command) => ({
		...project,
		revision: Number(project.revision) + 1,
		payload: [...(project.payload as number[]), command.step],
	}),
};

function origin(): EditorHistoryDocument {
	return { id: 'property-document', revision: 0, updatedAt: '2026-09-06T00:00:00.000Z', payload: [] };
}

function payloadOf(history: History): number[] {
	return history.present.payload as number[];
}

function commit(history: History, step: number): History {
	return executeEditorProjectCommand(history, { step }, REVISION, {});
}

function admit(history: History, limit: number): void {
	assert.equal(validateEditorProjectHistory(history, REVISION), true);
	assert.ok(history.undoStack.length <= limit, `the undo stack reached ${String(history.undoStack.length)}`);
	assert.ok(history.redoStack.length <= limit, `the redo stack reached ${String(history.redoStack.length)}`);
	assert.ok(Number.isSafeInteger(history.dropped) && (history.dropped as number) >= 0);
}

const limitArbitrary = fc.integer({ min: 1, max: 12 });
const opsArbitrary = fc.array(fc.constantFrom('commit', 'undo', 'redo'), {
	minLength: 0,
	maxLength: 30,
	size: 'max',
});

test('no sequence of commits, undos and redos escapes the history limit', () => {
	fc.assert(
		fc.property(limitArbitrary, opsArbitrary, (limit, ops) => {
			let history = createEditorProjectHistory(origin(), REVISION, limit, { limit });
			admit(history, limit);
			let step = 0;
			let dropped = history.dropped as number;
			for (const op of ops) {
				if (op === 'commit') {
					step += 1;
					history = commit(history, step);
					assert.equal(history.redoStack.length, 0, 'a fresh commit leaves nothing to redo');
				} else if (op === 'undo') history = undoEditorProjectCommand(history, REVISION, {});
				else history = redoEditorProjectCommand(history, REVISION, {});
				admit(history, limit);
				assert.ok((history.dropped as number) >= dropped, 'the dropped count never runs backwards');
				dropped = history.dropped as number;
			}
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('undo and redo undo one another from wherever the history stands', () => {
	fc.assert(
		fc.property(limitArbitrary, opsArbitrary, (limit, ops) => {
			let history = createEditorProjectHistory(origin(), REVISION, limit, { limit });
			let step = 0;
			for (const op of ops) {
				if (op === 'commit') {
					step += 1;
					history = commit(history, step);
				} else if (op === 'undo') history = undoEditorProjectCommand(history, REVISION, {});
				else history = redoEditorProjectCommand(history, REVISION, {});
			}
			const present = payloadOf(history);
			if (history.undoStack.length > 0) {
				const roundTripped = redoEditorProjectCommand(
					undoEditorProjectCommand(history, REVISION, {}),
					REVISION,
					{},
				);
				assert.deepEqual(payloadOf(roundTripped), present, 'undo then redo restores the present');
			}
			if (history.redoStack.length > 0) {
				const roundTripped = undoEditorProjectCommand(
					redoEditorProjectCommand(history, REVISION, {}),
					REVISION,
					{},
				);
				assert.deepEqual(payloadOf(roundTripped), present, 'redo then undo restores the present');
			}
			// An exhausted stack is a no-op rather than an error, so a command that
			// cannot move the history hands the very same state back.
			if (history.undoStack.length === 0) {
				assert.equal(undoEditorProjectCommand(history, REVISION, {}), history);
			}
			if (history.redoStack.length === 0) {
				assert.equal(redoEditorProjectCommand(history, REVISION, {}), history);
			}
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('n commits, n undos and n redos land back on the same present', () => {
	fc.assert(
		fc.property(fc.array(fc.integer({ min: 1, max: 99 }), { minLength: 1, maxLength: 20, size: 'max' }), (steps) => {
			const limit = steps.length + 4;
			let history = createEditorProjectHistory(origin(), REVISION, limit, { limit });
			for (const step of steps) history = commit(history, step);
			const committed = payloadOf(history);
			assert.deepEqual(committed, steps);

			for (let index = 0; index < steps.length; index += 1) {
				history = undoEditorProjectCommand(history, REVISION, {});
			}
			assert.deepEqual(payloadOf(history), [], 'undoing every commit is back at the original document');
			assert.equal(history.undoStack.length, 0);

			for (let index = 0; index < steps.length; index += 1) {
				history = redoEditorProjectCommand(history, REVISION, {});
			}
			assert.deepEqual(payloadOf(history), committed, 'redoing every undo restores the same present');
			assert.equal(history.redoStack.length, 0);

			// A commit at that point is what actually discards the redo branch.
			const branched = commit(undoEditorProjectCommand(history, REVISION, {}), 1000);
			assert.equal(branched.redoStack.length, 0, 'a new commit clears the redo branch');
			assert.deepEqual(payloadOf(branched), [...committed.slice(0, -1), 1000]);
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('the bounded stack keeps the newest commits and counts the rest as dropped', () => {
	fc.assert(
		fc.property(limitArbitrary, fc.integer({ min: 0, max: 30 }), (limit, commits) => {
			let history = createEditorProjectHistory(origin(), REVISION, limit, { limit });
			for (let step = 1; step <= commits; step += 1) history = commit(history, step);
			assert.equal(history.undoStack.length, Math.min(commits, limit));
			assert.equal(history.dropped, Math.max(0, commits - limit));
			assert.equal((history.dropped as number) + history.undoStack.length, commits);
			assert.deepEqual(payloadOf(history), Array.from({ length: commits }, (_, index) => index + 1));

			// Undo runs back exactly as far as the retained stack, and no further.
			for (let index = 0; index < commits + 2; index += 1) {
				history = undoEditorProjectCommand(history, REVISION, {});
			}
			assert.equal(history.undoStack.length, 0);
			assert.deepEqual(
				payloadOf(history),
				Array.from({ length: Math.max(0, commits - limit) }, (_, index) => index + 1),
			);
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('a depth names the same commit whether or not the limit has eaten into the stack', () => {
	fc.assert(
		fc.property(
			limitArbitrary,
			fc.integer({ min: 1, max: 24 }),
			fc.integer({ min: 0, max: 24 }),
			(limit, commits, depth) => {
				let history = createEditorProjectHistory(origin(), REVISION, limit, { limit });
				for (let step = 1; step <= commits; step += 1) history = commit(history, step);
				const committed = payloadOf(history);
				const dropped = history.dropped as number;
				// A depth below what the limit has already dropped clamps to the oldest
				// entry the stack still holds.
				const reachable = Math.min(Math.max(depth, dropped), commits);

				const rolledBack = rollbackEditorProjectHistory(history, depth, REVISION, {});
				admit(rolledBack, limit);
				assert.deepEqual(
					payloadOf(rolledBack),
					depth >= commits ? committed : committed.slice(0, reachable),
					'rollback puts the project back as it stood at that depth',
				);
				if (depth < commits) assert.equal(rolledBack.redoStack.length, 0, 'rollback drops the redo branch');

				const collapsed = collapseEditorProjectHistory(history, depth, { step: -1 }, REVISION);
				admit(collapsed, limit);
				assert.deepEqual(payloadOf(collapsed), committed, 'collapsing folds entries without moving the present');
				if (depth < commits) {
					assert.equal(collapsed.undoStack.length, Math.min(reachable - dropped + 1, limit));
					assert.deepEqual(
						payloadOf(undoEditorProjectCommand(collapsed, REVISION, {})),
						committed.slice(0, reachable),
						'the folded entry undoes the whole macro in one step',
					);
				}
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistorySourceCompactor } from '../src/common/editor/history-source-compaction.ts';

interface Project { readonly id: string; readonly sources: readonly string[] }
interface Entry { readonly project: Project; readonly command: string }

test('unchanged undo and redo snapshots are compacted once while live clipboard roots stay current', () => {
	const calls = new Map<Project, number>();
	const compact = createHistorySourceCompactor<Project>((project: Project, preserve: Iterable<string>) => {
		calls.set(project, (calls.get(project) ?? 0) + 1);
		return { ...project, sources: [...preserve] };
	});
	const previous: Project = { id: 'previous', sources: ['unused'] };
	const present: Project = { id: 'present', sources: ['clipboard'] };
	const entry: Entry = { project: previous, command: 'edit' };
	let history = { present, undoStack: [entry], redoStack: [entry], limit: 200 };
	history = compact(history, { preservePresentSourceIds: ['clipboard'] });
	assert.equal(calls.get(previous), 1);
	assert.deepEqual(history.present.sources, ['clipboard']);
	const retained = history.undoStack[0]?.project;
	assert.ok(retained);
	history = compact(history, { preservePresentSourceIds: [] });
	assert.equal(calls.get(retained), undefined, 'the compacted snapshot must also be memoized');
	assert.deepEqual(history.present.sources, [], 'clearing the clipboard must remove its live root');
	assert.equal(history.limit, 200);
	assert.equal(history.undoStack[0]?.command, 'edit');
});

test('new history snapshots are visited and compactor instances do not share cache ownership', () => {
	let scans = 0;
	const compactProject = (value: Project) => { scans += 1; return value; };
	const first = createHistorySourceCompactor(compactProject);
	const second = createHistorySourceCompactor(compactProject);
	const project: Project = { id: 'project', sources: [] };
	const history = { present: project, undoStack: [{ project }], redoStack: [] };
	assert.equal(first(history), history);
	assert.equal(first(history), history);
	assert.equal(scans, 3, 'live present is checked each time, immutable past only once');
	second(history);
	assert.equal(scans, 5);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createIncrementalHistoryRoots, createSessionRetentionIndex } from '../src/common/editor/session-retention-index.ts';

interface Project { readonly ids: readonly string[] }
interface History {
	readonly present: Project;
	readonly undoStack: readonly { readonly project: Project }[];
	readonly redoStack: readonly { readonly project: Project }[];
}

function history(present: Project, past: readonly Project[] = [], future: readonly Project[] = []): History {
	return { present, undoStack: past.map((project) => ({ project })), redoStack: future.map((project) => ({ project })) };
}

test('a full undo history collects only the newly admitted project on each edit', () => {
	const documents = Array.from({ length: 200 }, (_, index) => ({ ids: Array.from({ length: 1_000 },
		(_value, source) => `source-${String(source)}-${String(index % 2)}`) }));
	let collections = 0;
	let visitedIds = 0;
	const initial = documents[199]!;
	const index = createIncrementalHistoryRoots(history(initial, documents.slice(0, -1)), (project) => {
		collections += 1;
		visitedIds += project.ids.length;
		return project.ids;
	});
	assert.equal(index.getRoots().size, 2_000);
	assert.equal(collections, 200);
	const next = { ids: ['new-source'] };
	index.update(history(next, documents));
	assert.equal(collections, 201);
	assert.equal(visitedIds, 200_001);
	assert.equal(index.getRoots().has('new-source'), true);
	index.getRoots().clear();
	assert.equal(index.getRoots().size, 2_001);
});

test('undo and redo reuse projected documents and shared roots survive dropped entries', () => {
	const first = { ids: ['shared', 'first'] };
	const second = { ids: ['shared', 'second'] };
	const third = { ids: ['third'] };
	let collections = 0;
	const index = createIncrementalHistoryRoots(history(third, [first, second]), (project) => {
		collections += 1;
		return project.ids;
	});
	index.update(history(second, [first], [third]));
	assert.equal(collections, 3);
	assert.deepEqual([...index.getRoots()].sort(), ['first', 'second', 'shared', 'third']);
	index.update(history(second));
	assert.deepEqual([...index.getRoots()].sort(), ['second', 'shared']);
	index.update(history(first, [], [second]));
	assert.equal(collections, 3);
	assert.deepEqual([...index.getRoots()].sort(), ['first', 'second', 'shared']);
});

test('duplicate project references and repeated roots contribute only once per project', () => {
	const first = { ids: ['shared', 'shared', 'first'] };
	const second = { ids: ['shared', 'second'] };
	const index = createIncrementalHistoryRoots(history(first, [first, second], [second]), (project) => project.ids);
	index.update(history(second));
	assert.deepEqual([...index.getRoots()].sort(), ['second', 'shared']);
	index.update(history({ ids: [] }));
	assert.equal(index.getRoots().size, 0);
});

test('failed projection preserves prior roots and a retry admits the replacement', () => {
	const first = { ids: ['first'] };
	const second = { ids: ['second'] };
	let rejects = true;
	const index = createIncrementalHistoryRoots(history(first), (project) => {
		if (project === second && rejects) throw new Error('Rejected projection');
		return project.ids;
	});
	assert.throws(() => index.update(history(second)), /Rejected projection/u);
	assert.deepEqual([...index.getRoots()], ['first']);
	rejects = false;
	index.update(history(second));
	assert.deepEqual([...index.getRoots()], ['second']);
});

test('optional retention views stay lazy and release discarded clip, assistance and storage roots', () => {
	const first = {
		id: 'project', schemaVersion: 17, schemaFamily: 'soundscaper', tracks: [],
		sources: [{ id: 'audio', kind: 'audio', storageKey: 'storage-audio' }, { id: 'assistance', kind: 'audio' }],
		clips: [{ id: 'clip', sourceId: 'audio', kind: 'audio' }],
		assistanceAssets: [{ sourceId: 'assistance', body: { storageKey: 'assistance-body' } }],
	};
	const next = { ...first, clips: [], sources: [], assistanceAssets: [] };
	const index = createSessionRetentionIndex({ present: first });
	assert.deepEqual([...index.getRetentionRoots().clipIds], ['clip']);
	assert.deepEqual([...index.getRetentionRoots().assistanceSourceIds], ['assistance']);
	assert.deepEqual([...index.getStorageKeys()].sort(), ['assistance', 'assistance-body', 'storage-audio']);
	assert.deepEqual([...index.getLinkedOriginalKeys()].sort(), ['audio:assistance', 'audio:audio']);
	index.update({ present: next, undoStack: [{ project: first }] });
	assert.deepEqual([...index.getSourceIds()].sort(), ['assistance', 'audio']);
	index.update({ present: next });
	assert.equal(index.getSourceIds().size, 0);
	assert.equal(index.getRetentionRoots().clipIds.size, 0);
	assert.equal(index.getRetentionRoots().assistanceSourceIds.size, 0);
	assert.equal(index.getStorageKeys().size, 0);
	assert.equal(index.getLinkedOriginalKeys().size, 0);
	// A storage-only identity rejection still happens on the optional storage query.
	index.update({ present: { ...next, schemaFamily: 'framescaper', schemaVersion: 1 } });
	assert.equal(index.getSourceIds().size, 0);
	assert.throws(() => index.getStorageKeys(), /must be an array/u);
});

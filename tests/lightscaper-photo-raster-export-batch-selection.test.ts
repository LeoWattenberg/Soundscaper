/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePhotoRasterBatchSelection, preparePhotoRasterBatchSelection } from '../src/lightscaper/controller/photo-raster-export-batch-selection.ts';
import type { ExecutePhotoDevelopCurrent } from '../src/common/editor/ui/lightscaper/photo-library-workflow-develop.ts';
import type { PhotoLibraryDevelopSnapshotV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function fixture() {
	let current = true; const reads: string[] = [], held = deferred<void>(); let hold = false;
	const snapshots = new Map(['one', 'two'].map((id, index) => [id, { schemaVersion: 2 as const, catalogId: 'catalog', photoId: id,
		revision: index + 3, activeVersionId: `version:${index}`, versionId: `version:${index}`, versions: [],
		develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] } satisfies PhotoLibraryDevelopSnapshotV2]));
	const execute: ExecutePhotoDevelopCurrent = async (action, signal) => {
		const stop = signal ?? new AbortController().signal;
		await action({ signal: stop, isCurrent: () => current, refresh: async () => undefined, acquire: async () => ({ schemaVersion: 2,
			read: async request => { reads.push(request.photoId); if (hold) await held.promise; return snapshots.get(request.photoId)!; },
			apply: async () => assert.fail('Selection must never edit'),
		}) }); return current ? 'completed' : 'stale';
	};
	return { execute, snapshots, reads, held, setCurrent: (value: boolean) => { current = value; }, setHold: () => { hold = true; } };
}
const rows = () => [{ photoId: 'two', fileName: 'Second.png' }, { photoId: 'one', fileName: 'First.png' }];
test('menu selection detaches page order and captures the active versions/revisions in one catalog', async () => {
	const f = fixture(), input = rows(), selected = capturePhotoRasterBatchSelection(input); input.reverse(); input[0]!.fileName = 'changed';
	const prepared = await preparePhotoRasterBatchSelection(selected, f.execute, new AbortController().signal);
	assert.equal(prepared.catalogId, 'catalog'); assert.deepEqual(f.reads, ['two', 'one']);
	assert.deepEqual(prepared.members, [{ photoId: 'two', versionId: 'version:1', expectedRevision: 4, sourceFileName: 'Second.png' },
		{ photoId: 'one', versionId: 'version:0', expectedRevision: 3, sourceFileName: 'First.png' }]);
	assert.equal(Object.isFrozen(selected[0]), true); assert.equal(Object.isFrozen(prepared.members[0]), true);
});
test('abort during a held read joins the actual read and refuses late stale publication', async () => {
	const f = fixture(), stop = new AbortController(); f.setHold();
	const reason = Symbol('catalog replaced'), work = preparePhotoRasterBatchSelection(capturePhotoRasterBatchSelection(rows()), f.execute, stop.signal);
	const failed = work.catch((error: unknown) => error); await remainsPending(work); stop.abort(reason); f.setCurrent(false);
	await remainsPending(failed); f.held.resolve(); assert.equal(await failed, reason); assert.deepEqual(f.reads, ['two']);
});
test('mixed catalogs, nonactive snapshots and unsuccessful generation results refuse', async () => {
	for (const kind of ['catalog', 'version', 'generation'] as const) {
		const f = fixture(), snapshot = f.snapshots.get('one')!;
		if (kind === 'catalog') f.snapshots.set('one', { ...snapshot, catalogId: 'other' });
		if (kind === 'version') f.snapshots.set('one', { ...snapshot, activeVersionId: 'other' });
		if (kind === 'generation') f.setCurrent(false);
		await assert.rejects(preparePhotoRasterBatchSelection(capturePhotoRasterBatchSelection(rows()), f.execute, new AbortController().signal));
	}
});
test('invalid, duplicate, sparse, oversized and accessor selection refuses without getter calls', () => {
	let getters = 0;
	const bad = Object.defineProperty({ photoId: 'one' }, 'fileName', { enumerable: true, get() { getters++; return 'First.png'; } });
	for (const input of [[], new Array(2), Array.from({ length: 65 }, () => rows()[0]), [rows()[0], rows()[0]], [bad], [{ photoId: ' bad', fileName: 'First.png' }]]) {
		assert.throws(() => capturePhotoRasterBatchSelection(input));
	}
	assert.equal(getters, 0);
});

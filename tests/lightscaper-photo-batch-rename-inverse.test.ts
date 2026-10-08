/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCommandOwnerV1 } from '../src/lightscaper/controller/photo-command-owner.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoBatchRenameUndoV1, applyPhotoBatchRenameUndoItemV1,
	PHOTO_BATCH_RENAME_UNDO_MAXIMUM_BYTES_V1 } from '../src/lightscaper/controller/photo-batch-rename-inverse-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const inverse = () => ({ schemaVersion: 1, kind: 'photo-batch-rename-undo', catalogId: 'catalog-1', items: [
	{ index: 2, photoId: 'photo-1', expectedRevision: 1, fileName: 'New.png', previousDisplayName: 'Old.png' },
] });

function fixture() {
	const source = photoArchiveFixture().photo;
	let durable = normalizePhotoDocumentV1({ ...source, revision: 1, metadata: { ...source.metadata, fileName: 'New.png' } });
	let writes = 0, afterSave = () => undefined;
	const owner = new PhotoCommandOwnerV1({ loadPhoto: async () => durable, savePhoto: async (value, revision) => {
		assert.equal(revision, durable.revision);
		durable = normalizePhotoDocumentV1({ ...normalizePhotoDocumentV1(value), revision: revision + 1 }); writes++; afterSave();
		return durable;
	} }, durable);
	return { owner, before: durable, current: () => durable, writes: () => writes, afterSave: (run: () => undefined) => { afterSave = run; } };
}

test('inverse admission detaches closed scalar fences and retains selected-slot gaps', () => {
	const input = inverse(), packet = normalizePhotoBatchRenameUndoV1(input);
	input.items[0]!.previousDisplayName = 'Changed.png';
	assert.equal(packet.items[0]?.previousDisplayName, 'Old.png'); assert.equal(packet.items[0]?.index, 2);
	assert.equal(Object.isFrozen(packet), true); assert.ok(packet.items.every(Object.isFrozen));
	assert.deepEqual(normalizePhotoBatchRenameUndoV1(JSON.parse(JSON.stringify(packet)) as unknown), packet);
});

test('future, duplicate, unordered, sparse, no-op and hostile inverse values refuse without executing getters', () => {
	let getters = 0;
	const accessor = Object.defineProperty({}, 'fileName', { enumerable: true, get: () => { getters++; throw new Error('getter'); } });
	for (const value of [
		{ ...inverse(), schemaVersion: 2 }, { ...inverse(), kind: 'other' }, { ...inverse(), extra: true },
		{ ...inverse(), items: [] }, { ...inverse(), items: new Array(1) }, { ...inverse(), items: [accessor] },
		{ ...inverse(), items: [...inverse().items, ...inverse().items] },
		{ ...inverse(), items: [{ ...inverse().items[0], expectedRevision: 0 }] },
		{ ...inverse(), items: [{ ...inverse().items[0], index: 64 }] },
		{ ...inverse(), items: [{ ...inverse().items[0], previousDisplayName: 'New.png' }] },
		{ ...inverse(), items: [inverse().items[0], { ...inverse().items[0], index: 1, photoId: 'photo-2' }] },
	]) assert.throws(() => normalizePhotoBatchRenameUndoV1(value));
	const items = new Proxy(inverse().items, { get: () => { getters++; throw new Error('array get trap'); } });
	const input = new Proxy({ ...inverse(), items }, { get: () => { getters++; throw new Error('record get trap'); } });
	assert.deepEqual(normalizePhotoBatchRenameUndoV1(input), inverse()); assert.equal(getters, 0);
});

test('all64 maximum Unicode inverse bindings fit the whole 256KiB budget', () => {
	const packet = normalizePhotoBatchRenameUndoV1({ ...inverse(), catalogId: 'c'.repeat(128), items: Array.from({ length: 64 }, (_, index) => ({
		index, photoId: `${'p'.repeat(125)}${String(index).padStart(3, '0')}`, expectedRevision: Number.MAX_SAFE_INTEGER,
		fileName: '\ud800'.repeat(256), previousDisplayName: '\ud801'.repeat(256),
	})) });
	const bytes = new TextEncoder().encode(JSON.stringify(packet)).byteLength;
	assert.equal(PHOTO_BATCH_RENAME_UNDO_MAXIMUM_BYTES_V1, 256 * 1024); assert.ok(bytes < PHOTO_BATCH_RENAME_UNDO_MAXIMUM_BYTES_V1, String(bytes));
	assert.equal(bytes, 211_459);
});

test('inverse applies an ordinary metadata command/history and preserves immutable source and develop facts', async () => {
	const f = fixture();
	try {
		const ack = await applyPhotoBatchRenameUndoItemV1(f.owner, inverse(), 0);
		assert.deepEqual(ack, { index: 2, photoId: 'photo-1', previousDisplayName: 'New.png', fileName: 'Old.png', revision: 2, status: 'restored' });
		assert.equal(f.writes(), 1); assert.equal(f.owner.history.past.length, 1);
		assert.deepEqual(f.current().original, f.before.original); assert.deepEqual(f.current().extractedMetadata, f.before.extractedMetadata);
		assert.deepEqual(f.current().versions, f.before.versions);
		await f.owner.undo(); assert.equal(f.current().metadata.fileName, 'New.png');
	} finally { await f.owner.close(); }
});

test('stale revision, catalog, identity and current display name refuse before any restore or history entry', async () => {
	for (const patch of [{ expectedRevision: 2 }, { photoId: 'photo-2' }, { fileName: 'Different.png' }]) {
		const f = fixture();
		try { await assert.rejects(applyPhotoBatchRenameUndoItemV1(f.owner, { ...inverse(), items: [{ ...inverse().items[0], ...patch }] }, 0));
			assert.equal(f.writes(), 0); assert.equal(f.owner.history.past.length, 0);
		} finally { await f.owner.close(); }
	}
	const f = fixture();
	try { await assert.rejects(applyPhotoBatchRenameUndoItemV1(f.owner, { ...inverse(), catalogId: 'other' }, 0)); assert.equal(f.writes(), 0); }
	finally { await f.owner.close(); }
});

test('inverse admission and native cancellation precede owner access, while late abort retains the durable restore', async () => {
	let reads = 0, getters = 0;
	const owner = Object.defineProperty({}, 'history', { get: () => { reads++; throw new Error('owner'); } }) as PhotoCommandOwnerV1;
	await assert.rejects(applyPhotoBatchRenameUndoItemV1(owner, { ...inverse(), schemaVersion: 2 }, 0));
	const pre = new AbortController(); pre.abort();
	Object.defineProperty(pre.signal, 'throwIfAborted', { get: () => { getters++; return () => undefined; } });
	await assert.rejects(applyPhotoBatchRenameUndoItemV1(owner, inverse(), 0, { signal: pre.signal }), { name: 'AbortError' });
	assert.equal(reads, 0); assert.equal(getters, 0);
	const late = new AbortController(), f = fixture(); f.afterSave(() => { late.abort(); return undefined; });
	try { const ack = await applyPhotoBatchRenameUndoItemV1(f.owner, inverse(), 0, { signal: late.signal });
		assert.equal(ack.status, 'restored'); assert.equal(ack.revision, 2); assert.equal(f.owner.history.past.length, 1);
	} finally { await f.owner.close(); }
});

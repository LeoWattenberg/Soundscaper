/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { admitPhotoLibraryBackupRequestV1 } from '../src/lightscaper/controller/photo-library-backup-request.ts';

test('closed scalar backup options detach caller data and preserve the shared512MiB maximum', () => {
	const input = { maximumBlobBytes: 8192 }, admitted = admitPhotoLibraryBackupRequestV1(input);
	input.maximumBlobBytes = 1;
	assert.equal(admitted.maximumBlobBytes, 8192); assert.equal(Object.isFrozen(admitted), true);
	assert.equal(admitPhotoLibraryBackupRequestV1().maximumBlobBytes, 512 * 1024 * 1024);
	for (const value of [{ extra: true }, { maximumBlobBytes: 0 }, { maximumBlobBytes: 512 * 1024 * 1024 + 1 },
		{ maximumBlobBytes: NaN }, { maximumBlobBytes: Infinity }, { maximumBlobBytes: 1.5 }]) assert.throws(() => admitPhotoLibraryBackupRequestV1(value));
});

test('option getters and native cancellation overrides are never evaluated during admission', () => {
	let getters = 0;
	assert.throws(() => admitPhotoLibraryBackupRequestV1(Object.defineProperty({}, 'writable', { enumerable: true,
		get: () => { getters++; throw new Error('option getter'); } })));
	const pre = new AbortController(); pre.abort();
	Object.defineProperty(pre.signal, 'throwIfAborted', { get: () => { getters++; return () => undefined; } });
	assert.throws(() => admitPhotoLibraryBackupRequestV1({ signal: pre.signal }), { name: 'AbortError' });
	const input = new Proxy({ maximumBlobBytes: 1 }, { get: () => { getters++; throw new Error('proxy get'); } });
	assert.equal(admitPhotoLibraryBackupRequestV1(input).maximumBlobBytes, 1); assert.equal(getters, 0);
});

test('native writable admission borrows an unlocked stream without acquiring or cleaning its destination', async () => {
	let writes = 0, aborts = 0, closes = 0;
	const writable = new WritableStream<Uint8Array>({ write: () => { writes++; }, abort: () => { aborts++; }, close: () => { closes++; } });
	assert.equal(admitPhotoLibraryBackupRequestV1({ writable }).writable, writable);
	assert.equal(writable.locked, false); assert.deepEqual([writes, aborts, closes], [0, 0, 0]);
	const writer = writable.getWriter();
	try { assert.throws(() => admitPhotoLibraryBackupRequestV1({ writable }), /locked/iu); }
	finally { writer.releaseLock(); }
	await writable.abort(); assert.equal(aborts, 1);
});

test('writable subclasses and own native-method getters refuse without acquiring a writer', () => {
	let getters = 0;
	const writable = new WritableStream<Uint8Array>();
	Object.defineProperty(writable, 'getWriter', { get: () => { getters++; throw new Error('writer getter'); } });
	assert.throws(() => admitPhotoLibraryBackupRequestV1({ writable }));
	class ForeignWritable extends WritableStream<Uint8Array> {}
	assert.throws(() => admitPhotoLibraryBackupRequestV1({ writable: new ForeignWritable() }));
	assert.throws(() => admitPhotoLibraryBackupRequestV1({ writable: {} }));
	assert.equal(getters, 0);
});

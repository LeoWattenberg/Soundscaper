/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectMediaAssetBinaryRecord, type MediaAssetBinaryInspectionPorts } from '../src/common/editor/storage/media-asset-binary-inspection.ts';
import { mediaAssetChunkKey, type MediaAssetChunkRead } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE, MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../src/common/editor/storage/media-asset-chunk-schema.ts';
import type { OpfsBinaryInspection } from '../src/common/editor/storage/opfs-binary-inspection.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';

const TOKEN = 'retained-chunk-token', SOURCE = 'original-asset';
function row(bytes: number): StorageRecord {
	return { sourceId: SOURCE, storage: MEDIA_ASSET_CHUNK_STORAGE_TYPE, mediaChunkToken: TOKEN,
		mediaChunkBytes: MEDIA_ASSET_STREAM_CHUNK_BYTES, mediaChunkCount: Math.ceil(bytes / MEDIA_ASSET_STREAM_CHUNK_BYTES),
		size: bytes, mimeType: 'IMAGE/PNG' };
}
function chunk(index: number, body: Blob): MediaAssetChunkRead {
	const key = mediaAssetChunkKey(TOKEN, index);
	return { primaryKey: key, value: { key, sourceId: SOURCE, mediaChunkToken: TOKEN, index,
		byteLength: body.size, payload: body, createdAt: 1 } };
}
function fixture(records: readonly MediaAssetChunkRead[] = [], probe?: () => Promise<OpfsBinaryInspection>) {
	const calls: string[] = [];
	const ports: MediaAssetBinaryInspectionPorts = {
		opfs: { inspectBinaryRecord: async () => { calls.push('probe'); if (!probe) throw new Error('Unexpected OPFS probe.'); return probe(); } },
		chunks: { async *chunks(token) { calls.push(`chunks:${token}`); for (const record of records) yield record; } },
	};
	return { ports, calls };
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(accept => { resolve = accept; });
	return { promise, resolve };
}

test('strict chunk inspection assembles canonical bounded parts without reading any payload bytes', async () => {
	const first = new Blob([new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES)]), last = new Blob(['last']);
	for (const body of [first, last]) Object.defineProperty(body, 'arrayBuffer', { value: () => { throw new Error('No payload read.'); } });
	const { ports, calls } = fixture([chunk(0, first), chunk(1, last)]);
	const inspected = await inspectMediaAssetBinaryRecord(row(first.size + last.size), ports);
	assert.equal(inspected.status, 'present');
	if (inspected.status !== 'present') assert.fail('Expected present chunks.');
	assert.equal(inspected.body.size, first.size + last.size);
	assert.equal(inspected.body.type, 'image/png');
	assert.equal(new TextDecoder().decode(await inspected.body.slice(first.size).arrayBuffer()), 'last');
	assert.deepEqual(calls, [`chunks:${TOKEN}`]);
});

test('missing canonical chunks remain distinct from malformed existing chunk records', async t => {
	for (const records of [[], [{ primaryKey: mediaAssetChunkKey(TOKEN, 0), value: undefined }]]) {
		await t.test(`missing ${records.length}`, async () => {
			assert.deepEqual(await inspectMediaAssetBinaryRecord(row(1), fixture(records).ports), { status: 'missing', reason: 'chunk' });
		});
	}
	for (const value of [null, {}, { payloadEncoding: 'unknown' }, { payload: new Blob(['x']) }]) {
		await assert.rejects(inspectMediaAssetBinaryRecord(row(1), fixture([{ primaryKey: mediaAssetChunkKey(TOKEN, 0), value }]).ports), TypeError);
	}
});

test('a missing trailing part is reported after valid earlier parts without manufacturing bytes', async () => {
	const first = new Blob([new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES)]);
	assert.deepEqual(await inspectMediaAssetBinaryRecord(row(first.size + 1), fixture([chunk(0, first)]).ports),
		{ status: 'missing', reason: 'chunk' });
});

test('chunk geometry, token, source and real primary keys must agree exactly', async () => {
	const valid = chunk(0, new Blob(['x'])), value = valid.value as Record<string, unknown>;
	for (const change of [{ sourceId: 'other' }, { mediaChunkToken: 'other' }, { index: 1 }, { key: 'other' },
		{ byteLength: 2 }, { payload: new Blob(['xx']), byteLength: 2 }]) {
		await assert.rejects(inspectMediaAssetBinaryRecord(row(1), fixture([{ ...valid, value: { ...value, ...change } }]).ports), TypeError);
	}
	await assert.rejects(inspectMediaAssetBinaryRecord(row(1), fixture([{ ...valid, primaryKey: 'other' }]).ports), TypeError);
	await assert.rejects(inspectMediaAssetBinaryRecord(row(1), fixture([valid, chunk(1, new Blob(['x']))]).ports), TypeError);
});

test('invalid chunk locator metadata rejects before backend acquisition', async () => {
	for (const change of [{ size: -1 }, { size: NaN }, { size: Number.MAX_SAFE_INTEGER + 1 }, { sourceId: '' },
		{ mediaChunkToken: '' }, { mediaChunkBytes: 1 }, { mediaChunkCount: 2 }, { mediaChunkCount: NaN }]) {
		const { ports, calls } = fixture();
		await assert.rejects(inspectMediaAssetBinaryRecord({ ...row(1), ...change }, ports), TypeError);
		assert.deepEqual(calls, []);
	}
});

test('zero byte chunked media has an empty body only when no chunks exist', async () => {
	const inspected = await inspectMediaAssetBinaryRecord(row(0), fixture().ports);
	assert.equal(inspected.status, 'present');
	if (inspected.status === 'present') assert.equal(inspected.body.size, 0);
	await assert.rejects(inspectMediaAssetBinaryRecord(row(0), fixture([chunk(0, new Blob())]).ports), TypeError);
});

test('OPFS and inline outcomes and backend failure identities are forwarded unchanged', async () => {
	for (const storage of ['opfs', 'indexeddb-blob']) {
		const missing = Object.freeze({ status: 'missing', reason: 'file' } as const);
		const { ports, calls } = fixture([], async () => missing);
		assert.equal(await inspectMediaAssetBinaryRecord({ storage }, ports), missing);
		assert.deepEqual(calls, ['probe']);
		const failure = new DOMException('Permission refused', 'NotAllowedError');
		await assert.rejects(inspectMediaAssetBinaryRecord({ storage }, fixture([], () => Promise.reject(failure)).ports), error => error === failure);
	}
});

test('unknown layouts reject before accessing chunk and OPFS backends', async () => {
	for (const storage of [undefined, 'indexeddb-chunked', 'pcm', '']) {
		const { ports, calls } = fixture();
		await assert.rejects(inspectMediaAssetBinaryRecord({ storage }, ports), TypeError);
		assert.deepEqual(calls, []);
	}
});

test('chunk enumeration I/O failure is never converted into an absence result', async () => {
	const failure = new DOMException('IndexedDB read refused', 'UnknownError'), { ports } = fixture();
	const refusing: MediaAssetBinaryInspectionPorts = { ...ports, chunks: { async *chunks() { yield chunk(0, new Blob(['x'])); throw failure; } } };
	await assert.rejects(inspectMediaAssetBinaryRecord(row(1), refusing), error => error === failure);
});

test('abort before acquisition prevents reads; abort during a chunk read waits for native settlement', async () => {
	const cancelled = new AbortController(), { ports, calls } = fixture();
	cancelled.abort(new Error('Cancelled before reading.'));
	await assert.rejects(inspectMediaAssetBinaryRecord(row(1), ports, { signal: cancelled.signal }), error => error === cancelled.signal.reason);
	assert.deepEqual(calls, []);
	const entered = deferred<void>(), held = deferred<void>(), controller = new AbortController();
	let settled = false;
	const slow: MediaAssetBinaryInspectionPorts = { ...ports, chunks: { async *chunks() {
		entered.resolve(); await held.promise; yield chunk(0, new Blob(['x']));
	} } };
	const pending = inspectMediaAssetBinaryRecord(row(1), slow, { signal: controller.signal });
	void pending.then(() => { settled = true; }, () => { settled = true; });
	await entered.promise; controller.abort(new Error('Cancelled while reading.'));
	await Promise.resolve(); assert.equal(settled, false);
	held.resolve();
	await assert.rejects(pending, error => error === controller.signal.reason);
	assert.equal(settled, true);
});

test('cancellation during iterator cleanup joins it and refuses a late missing result', async () => {
	const entered = deferred<void>(), held = deferred<void>(), controller = new AbortController();
	let settled = false;
	const { ports } = fixture();
	const closing: MediaAssetBinaryInspectionPorts = { ...ports, chunks: { async *chunks() {
		try { yield { primaryKey: mediaAssetChunkKey(TOKEN, 0), value: undefined }; }
		finally { entered.resolve(); await held.promise; }
	} } };
	const pending = inspectMediaAssetBinaryRecord(row(1), closing, { signal: controller.signal });
	void pending.then(() => { settled = true; }, () => { settled = true; });
	await entered.promise; controller.abort(new Error('Cancelled during iterator cleanup.'));
	await Promise.resolve(); assert.equal(settled, false);
	held.resolve();
	await assert.rejects(pending, error => error === controller.signal.reason);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createFramescaperNativeOpfsFramePackCollector,
	releaseFramescaperNativeOpfsSpool,
} from '../src/framescaper/native-render-opfs-spool.ts';

test('selected V28 OPFS collector applies bounded write backpressure and releases after staging', async () => {
	const fake = opfsFixture();
	const signal = new AbortController().signal;
	const collector = await createFramescaperNativeOpfsFramePackCollector(32, 70, signal, {
		root: fake.root, mintName: () => 'carrier-0123456789abcdef0123456789abcdef.bin',
	});
	const first = Uint8Array.from({ length: 40 }, (_, index) => index);
	const second = Uint8Array.from({ length: 30 }, (_, index) => 100 + index);
	await collector.append(first);
	await collector.append(second);
	const result = await collector.complete('application/x-test-carrier');
	const expected = new Uint8Array([...first, ...second]);
	assert.equal(result.byteLength, expected.byteLength);
	assert.equal(result.sha256, createHash('sha256').update(expected).digest('hex'));
	assert.equal(result.chunkCount, 3);
	assert.equal(fake.maximumConcurrentWrites(), 1);
	assert.deepEqual(new Uint8Array(await result.bytes.arrayBuffer()), expected);
	assert.equal(await releaseFramescaperNativeOpfsSpool(result.bytes), true);
	assert.deepEqual(fake.removed(), ['carrier-0123456789abcdef0123456789abcdef.bin']);
	assert.equal(await releaseFramescaperNativeOpfsSpool(result.bytes), false);
});

test('selected V28 OPFS collector removes a cancelled partial spool', async () => {
	const fake = opfsFixture();
	const abort = new AbortController();
	const collector = await createFramescaperNativeOpfsFramePackCollector(32, 64, abort.signal, {
		root: fake.root, mintName: () => 'carrier-fedcba9876543210fedcba9876543210.bin',
	});
	await collector.append(new Uint8Array(32));
	abort.abort(new Error('cancelled by test'));
	await assert.rejects(async () => { await collector.append(new Uint8Array(32)); }, /cancelled by test/u);
	await collector.clear();
	assert.deepEqual(fake.removed(), ['carrier-fedcba9876543210fedcba9876543210.bin']);
});

function opfsFixture() {
	let parts: Uint8Array<ArrayBuffer>[] = [];
	let activeWrites = 0;
	let maximumWrites = 0;
	const removedNames: string[] = [];
	const directory = {
		async getFileHandle(name: string) {
			return {
				async createWritable() {
					parts = [];
					return {
						async write(value: FileSystemWriteChunkType) {
							activeWrites += 1; maximumWrites = Math.max(maximumWrites, activeWrites);
							await Promise.resolve();
							if (!(value instanceof Uint8Array)) throw new TypeError('fixture expects bytes');
							parts.push(Uint8Array.from(value as Uint8Array)); activeWrites -= 1;
						},
						async close() {}, async abort() {},
					};
				},
				async getFile() { return new File(parts.map(({ buffer }) => buffer), name); },
			};
		},
		async removeEntry(name: string) { removedNames.push(name); parts = []; },
	};
	const root = { async getDirectoryHandle() { return directory; } } as unknown as FileSystemDirectoryHandle;
	return Object.freeze({ root, removed: () => [...removedNames], maximumConcurrentWrites: () => maximumWrites });
}

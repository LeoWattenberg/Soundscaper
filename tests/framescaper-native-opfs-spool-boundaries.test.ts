/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createFramescaperNativeOpfsByteSpool,
	releaseFramescaperNativeOpfsSpool,
} from '../src/framescaper/native-render-opfs-spool.ts';

const NAME = 'carrier-0123456789abcdef0123456789abcdef.bin';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

function fixture(options: Readonly<{
	readonly holdWrite?: Promise<void>;
	readonly writeStarted?: () => void;
	readonly failWrite?: boolean;
	readonly failClose?: boolean;
	readonly fileSizeDelta?: number;
	readonly onWritableCreated?: () => void;
	readonly failFirstRemoval?: boolean;
	readonly holdRemoval?: Promise<void>;
}> = {}) {
	const parts: Uint8Array[] = [];
	const removed: string[] = [];
	let writes = 0;
	let closes = 0;
	let aborts = 0;
	let removals = 0;
	const writable = {
		async write(value: FileSystemWriteChunkType) {
			writes += 1;
			options.writeStarted?.();
			if (options.holdWrite) await options.holdWrite;
			if (options.failWrite) throw new Error('write failed');
			if (!(value instanceof Uint8Array)) throw new TypeError('expected bytes');
			parts.push(Uint8Array.from(value));
		},
		async close() {
			closes += 1;
			if (options.failClose) throw new Error('close failed');
		},
		async abort() { aborts += 1; },
	};
	const directory = {
		async getFileHandle() {
			return {
				async createWritable() {
					options.onWritableCreated?.();
					return writable;
				},
				async getFile() {
					const bytes = new Uint8Array(parts.flatMap((part) => [...part]));
					return new File([bytes.subarray(0, bytes.length + (options.fileSizeDelta ?? 0))], NAME);
				},
			};
		},
		async removeEntry(name: string) {
			removals += 1;
			if (options.holdRemoval) await options.holdRemoval;
			if (options.failFirstRemoval && removals === 1) throw new Error('remove failed');
			removed.push(name);
		},
	};
	const root = { async getDirectoryHandle() { return directory; } } as unknown as FileSystemDirectoryHandle;
	const create = (expected: number, signal = new AbortController().signal) =>
		createFramescaperNativeOpfsByteSpool(32, expected, signal, { root, mintName: () => NAME });
	return { create, parts, removed, writes: () => writes, closes: () => closes,
		aborts: () => aborts, removals: () => removals };
}

test('invalid spool bounds are refused before any OPFS allocation', async () => {
	const root = { getDirectoryHandle() { throw new Error('OPFS was opened'); } } as unknown as FileSystemDirectoryHandle;
	for (const [chunkBytes, expectedBytes] of [[31, 1], [32.5, 1], [32, 0], [32, -1],
		[32, Number.MAX_SAFE_INTEGER + 1]]) {
		await assert.rejects(() => createFramescaperNativeOpfsByteSpool(
			chunkBytes!, expectedBytes!, new AbortController().signal, { root }), /bounds are invalid/iu);
	}
});

test('an already aborted spool request never opens OPFS', async () => {
	const controller = new AbortController();
	controller.abort(new Error('stopped'));
	const root = { getDirectoryHandle() { throw new Error('OPFS was opened'); } } as unknown as FileSystemDirectoryHandle;
	await assert.rejects(() => createFramescaperNativeOpfsByteSpool(
		32, 1, controller.signal, { root }), /stopped/u);
});

test('an overrun is refused before writing or changing accepted byte length', async () => {
	const fake = fixture();
	const spool = await fake.create(3);
	await assert.rejects(() => spool.write(Uint8Array.of(1, 2, 3, 4)), /exceeded its exact byte/iu);
	assert.equal(spool.byteLength, 0);
	assert.equal(fake.writes(), 0);
	await spool.write(Uint8Array.of(1, 2, 3));
	const result = await spool.complete('application/octet-stream');
	assert.deepEqual(new Uint8Array(await result.bytes.arrayBuffer()), Uint8Array.of(1, 2, 3));
	await releaseFramescaperNativeOpfsSpool(result.bytes);
});

test('an incomplete spool cannot close and remains abortable', async () => {
	const fake = fixture();
	const spool = await fake.create(3);
	await spool.write(Uint8Array.of(1, 2));
	await assert.rejects(() => spool.complete('application/octet-stream'), /incomplete carrier/iu);
	assert.equal(fake.closes(), 0);
	await spool.abort();
	assert.deepEqual(fake.removed, [NAME]);
});

test('concurrent writes cannot produce a digest for bytes written in a different order', async () => {
	const release = deferred();
	const started = deferred();
	const fake = fixture({ holdWrite: release.promise, writeStarted: started.resolve });
	const spool = await fake.create(4);
	const first = spool.write(Uint8Array.of(1, 2));
	await started.promise;
	const second = spool.write(Uint8Array.of(3, 4));
	const refusal = assert.rejects(second, /write.*progress|busy|concurrent/iu);
	release.resolve();
	await refusal;
	await first;
	await spool.write(Uint8Array.of(3, 4));
	const result = await spool.complete('application/octet-stream');
	const bytes = new Uint8Array(await result.bytes.arrayBuffer());
	assert.deepEqual(bytes, Uint8Array.of(1, 2, 3, 4));
	assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
	await releaseFramescaperNativeOpfsSpool(result.bytes);
});

test('completion cannot close a stream while an accepted write is pending', async () => {
	const release = deferred();
	const started = deferred();
	const fake = fixture({ holdWrite: release.promise, writeStarted: started.resolve });
	const spool = await fake.create(2);
	const writing = spool.write(Uint8Array.of(1, 2));
	await started.promise;
	await assert.rejects(() => spool.complete('application/octet-stream'), /write.*progress|busy|concurrent/iu);
	assert.equal(fake.closes(), 0);
	release.resolve();
	await writing;
	const result = await spool.complete('application/octet-stream');
	assert.equal(result.byteLength, 2);
	await releaseFramescaperNativeOpfsSpool(result.bytes);
});

test('a failed write poisons the carrier and blocks later completion', async () => {
	const fake = fixture({ failWrite: true });
	const spool = await fake.create(2);
	await assert.rejects(() => spool.write(Uint8Array.of(1, 2)), /write failed/u);
	await assert.rejects(() => spool.complete('application/octet-stream'), /failed|closed/iu);
	assert.equal(fake.closes(), 0);
	await spool.abort();
	assert.deepEqual(fake.removed, [NAME]);
});

test('a close failure removes the unpublished OPFS carrier', async () => {
	const fake = fixture({ failClose: true });
	const spool = await fake.create(2);
	await spool.write(Uint8Array.of(1, 2));
	await assert.rejects(() => spool.complete('application/octet-stream'), /close failed/u);
	assert.deepEqual(fake.removed, [NAME]);
});

test('a changed file length removes the unpublished OPFS carrier', async () => {
	const fake = fixture({ fileSizeDelta: -1 });
	const spool = await fake.create(2);
	await spool.write(Uint8Array.of(1, 2));
	await assert.rejects(() => spool.complete('application/octet-stream'), /changed length/u);
	assert.deepEqual(fake.removed, [NAME]);
});

test('abort during writable creation aborts and removes the new carrier', async () => {
	const controller = new AbortController();
	const fake = fixture({ onWritableCreated: () => controller.abort(new Error('stopped during creation')) });
	await assert.rejects(() => fake.create(2, controller.signal), /stopped during creation/u);
	assert.equal(fake.aborts(), 1);
	assert.deepEqual(fake.removed, [NAME]);
});

test('failed release remains retryable and does not lose the cleanup handle', async () => {
	const fake = fixture({ failFirstRemoval: true });
	const spool = await fake.create(1);
	await spool.write(Uint8Array.of(7));
	const result = await spool.complete('application/octet-stream');
	await assert.rejects(() => releaseFramescaperNativeOpfsSpool(result.bytes), /remove failed/u);
	assert.equal(await releaseFramescaperNativeOpfsSpool(result.bytes), true);
	assert.equal(fake.removals(), 2);
});

test('concurrent release requests remove the carrier only once', async () => {
	const release = deferred();
	const fake = fixture({ holdRemoval: release.promise });
	const spool = await fake.create(1);
	await spool.write(Uint8Array.of(7));
	const result = await spool.complete('application/octet-stream');
	const first = releaseFramescaperNativeOpfsSpool(result.bytes);
	const second = releaseFramescaperNativeOpfsSpool(result.bytes);
	release.resolve();
	assert.deepEqual(await Promise.all([first, second]), [true, false]);
	assert.equal(fake.removals(), 1);
});

test('aborting a completed spool invalidates its release token', async () => {
	const fake = fixture();
	const spool = await fake.create(1);
	await spool.write(Uint8Array.of(7));
	const result = await spool.complete('application/octet-stream');
	await spool.abort();
	assert.equal(await releaseFramescaperNativeOpfsSpool(result.bytes), false);
	assert.deepEqual(fake.removed, [NAME]);
});

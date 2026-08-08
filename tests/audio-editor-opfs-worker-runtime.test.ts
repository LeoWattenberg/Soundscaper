/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAXIMUM_OPFS_SYNC_CHUNK_BYTES,
	OpfsSyncWorkerRuntime,
} from '../src/common/editor/storage/opfs-sync-worker-runtime.ts';

interface AccessCall {
	readonly type: string;
	readonly at?: number;
	readonly length?: number;
}

class FakeSyncAccessHandle {
	readonly calls: AccessCall[] = [];
	#bytes: Uint8Array;

	constructor(bytes: Uint8Array) { this.#bytes = bytes.slice(); }

	getSize(): number {
		this.calls.push({ type: 'size' });
		return this.#bytes.byteLength;
	}

	read(target: ArrayBufferView, options: { at: number }): number {
		const output = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
		output.set(this.#bytes.subarray(options.at, options.at + output.byteLength));
		this.calls.push({ type: 'read', at: options.at, length: output.byteLength });
		return output.byteLength;
	}

	write(source: ArrayBufferView, options: { at: number }): number {
		const input = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
		const required = options.at + input.byteLength;
		if (required > this.#bytes.byteLength) {
			const expanded = new Uint8Array(required);
			expanded.set(this.#bytes);
			this.#bytes = expanded;
		}
		this.#bytes.set(input, options.at);
		this.calls.push({ type: 'write', at: options.at, length: input.byteLength });
		return input.byteLength;
	}

	truncate(size: number): void {
		this.#bytes = this.#bytes.slice(0, size);
		this.calls.push({ type: 'truncate', length: size });
	}

	flush(): void { this.calls.push({ type: 'flush' }); }
	close(): void { this.calls.push({ type: 'close' }); }
	bytes(): Uint8Array { return this.#bytes.slice(); }
}

function fakeDirectory(initial: Record<string, Uint8Array> = {}) {
	const files = new Map<string, FakeSyncAccessHandle>(
		Object.entries(initial).map(([path, bytes]) => [path, new FakeSyncAccessHandle(bytes)]),
	);
	const opens: string[] = [];
	const removals: string[] = [];
	const directory = {
		async getFileHandle(path: string, options: { create?: boolean } = {}) {
			opens.push(path);
			let access = files.get(path);
			if (!access && options.create) {
				access = new FakeSyncAccessHandle(new Uint8Array());
				files.set(path, access);
			}
			if (!access) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
			return {
				createSyncAccessHandle: async () => access,
				getFile: async () => {
					const bytes = access.bytes();
					const buffer = new ArrayBuffer(bytes.byteLength);
					new Uint8Array(buffer).set(bytes);
					return new Blob([buffer]);
				},
			};
		},
		async removeEntry(path: string) {
			removals.push(path);
			if (!files.delete(path)) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
		},
	} as unknown as FileSystemDirectoryHandle;
	return { directory, files, opens, removals };
}

test('OPFS worker runtime refuses every operation until sync access capability is detected', async () => {
	const fixture = fakeDirectory({ 'media.blob': Uint8Array.of(1) });
	const runtime = new OpfsSyncWorkerRuntime({ supportsSyncAccessHandles: () => false });

	assert.deepEqual(await runtime.handle({
		id: 'init', type: 'initialize', directory: fixture.directory,
	}), { supported: false });
	await assert.rejects(
		runtime.handle({
			id: 'read', type: 'read', operationId: 'media-asset-chunk-read',
			path: 'media.blob', offset: 0, length: 1,
		}),
		/not initialized/u,
	);
	assert.deepEqual(fixture.opens, []);
});

test('OPFS worker runtime performs exact bounded reads with a short-lived sync handle', async () => {
	const fixture = fakeDirectory({ 'source.scpcm': Uint8Array.of(1, 2, 3, 4, 5) });
	const runtime = new OpfsSyncWorkerRuntime({ supportsSyncAccessHandles: () => true });
	await runtime.handle({ id: 'init', type: 'initialize', directory: fixture.directory });

	const result = await runtime.handle({
		id: 'read', type: 'read', operationId: 'canonical-pcm-chunk-read',
		path: 'source.scpcm', offset: 1, length: 3,
	});

	assert.equal(result.size, 5);
	assert.deepEqual([...new Uint8Array(result.bytes as ArrayBuffer)], [2, 3, 4]);
	assert.deepEqual(fixture.files.get('source.scpcm')?.calls, [
		{ type: 'size' },
		{ type: 'read', at: 1, length: 3 },
		{ type: 'close' },
	]);
	await assert.rejects(
		runtime.handle({
			id: 'past-eof', type: 'read', operationId: 'canonical-pcm-chunk-read',
			path: 'source.scpcm', offset: 4, length: 2,
		}),
		/exceeds the OPFS file/u,
	);
});

test('OPFS worker runtime snapshots genuine Blob content after sync size validation', async () => {
	const fixture = fakeDirectory({ 'media.blob': Uint8Array.of(8, 9, 10) });
	const runtime = new OpfsSyncWorkerRuntime({ supportsSyncAccessHandles: () => true });
	await runtime.handle({ id: 'init', type: 'initialize', directory: fixture.directory });

	const result = await runtime.handle({
		id: 'snapshot', type: 'snapshot', operationId: 'media-asset-chunk-read', path: 'media.blob',
	});
	assert.equal(result.size, 3);
	assert.deepEqual([...new Uint8Array(await (result.file as Blob).arrayBuffer())], [8, 9, 10]);
	assert.deepEqual(fixture.files.get('media.blob')?.calls, [
		{ type: 'size' },
		{ type: 'close' },
	]);
});

test('OPFS worker runtime writes sequential chunks and flushes before close', async () => {
	const fixture = fakeDirectory();
	const runtime = new OpfsSyncWorkerRuntime({ supportsSyncAccessHandles: () => true });
	await runtime.handle({ id: 'init', type: 'initialize', directory: fixture.directory });
	const opened = await runtime.handle({
		id: 'open', type: 'open-writer', operationId: 'media-asset-chunk-write', path: 'media.blob',
	});
	const writerId = opened.writerId as string;

	await runtime.handle({ id: 'write-1', type: 'write', writerId, bytes: Uint8Array.of(4, 5).buffer });
	await runtime.handle({ id: 'write-2', type: 'write', writerId, bytes: Uint8Array.of(6).buffer });
	await runtime.handle({ id: 'close', type: 'close-writer', writerId });

	assert.deepEqual([...fixture.files.get('media.blob')!.bytes()], [4, 5, 6]);
	assert.deepEqual(fixture.files.get('media.blob')?.calls, [
		{ type: 'truncate', length: 0 },
		{ type: 'write', at: 0, length: 2 },
		{ type: 'write', at: 2, length: 1 },
		{ type: 'flush' },
		{ type: 'close' },
	]);
	await assert.rejects(
		runtime.handle({ id: 'late', type: 'write', writerId, bytes: Uint8Array.of(7).buffer }),
		/unknown OPFS writer/u,
	);
});

test('OPFS worker runtime closes and removes an aborted staged writer', async () => {
	const fixture = fakeDirectory();
	const runtime = new OpfsSyncWorkerRuntime({ supportsSyncAccessHandles: () => true });
	await runtime.handle({ id: 'init', type: 'initialize', directory: fixture.directory });
	const { writerId } = await runtime.handle({
		id: 'open', type: 'open-writer', operationId: 'derivative-payload-write', path: 'poster.blob',
	});

	await runtime.handle({ id: 'abort', type: 'abort-writer', writerId });
	assert.deepEqual(fixture.removals, ['poster.blob']);
	assert.equal(fixture.files.has('poster.blob'), false);
});

test('OPFS worker runtime rejects malformed purposes, paths, ranges, and chunks before filesystem I/O', async () => {
	const fixture = fakeDirectory();
	const runtime = new OpfsSyncWorkerRuntime({ supportsSyncAccessHandles: () => true });
	await runtime.handle({ id: 'init', type: 'initialize', directory: fixture.directory });

	for (const request of [
		{ id: 'purpose', type: 'read', operationId: 'unknown', path: 'x', offset: 0, length: 0 },
		{ id: 'path', type: 'read', operationId: 'media-asset-chunk-read', path: '../x', offset: 0, length: 0 },
		{ id: 'range', type: 'read', operationId: 'media-asset-chunk-read', path: 'x', offset: -1, length: 0 },
	]) {
		await assert.rejects(runtime.handle(request), /OPFS/u);
	}
	assert.deepEqual(fixture.opens, []);

	const { writerId } = await runtime.handle({
		id: 'open', type: 'open-writer', operationId: 'canonical-pcm-chunk-write', path: 'source.scpcm',
	});
	await assert.rejects(
		runtime.handle({
			id: 'large', type: 'write', writerId,
			bytes: new ArrayBuffer(MAXIMUM_OPFS_SYNC_CHUNK_BYTES + 1),
		}),
		/exceeds the OPFS worker chunk limit/u,
	);
	assert.deepEqual(fixture.files.get('source.scpcm')?.calls, [{ type: 'truncate', length: 0 }]);
});

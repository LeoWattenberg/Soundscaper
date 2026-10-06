/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { crc32, PCM_ENCODING_RAW_F32LE } from '../src/common/editor/wavpack/index.js';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { OpfsSyncRepositoryBridge } from '../src/common/editor/storage/opfs-sync-repository-bridge.ts';
import { PcmRepository } from '../src/common/editor/storage/pcm-repository.ts';
import {
	syncBinaryWriter,
	syncPcmWriter,
} from '../src/common/editor/storage/opfs-sync-writer-adapters.ts';
import type {
	OpfsSyncReadResult,
	OpfsSyncStoragePort,
	OpfsSyncWriter,
} from '../src/common/editor/storage/opfs-sync-worker-client.ts';
import type { OpfsSyncOperationId } from '../src/common/editor/storage/opfs-sync-worker-protocol.ts';

interface WorkerCall {
	readonly type: string;
	readonly operationId?: OpfsSyncOperationId;
	readonly path?: string;
	readonly length?: number;
}

class MemorySyncWorker implements OpfsSyncStoragePort {
	readonly files = new Map<string, Uint8Array>();
	readonly calls: WorkerCall[] = [];
	closed = 0;
	failReads = false;

	async initialize(_directory: FileSystemDirectoryHandle): Promise<boolean> {
		this.calls.push({ type: 'initialize' });
		return true;
	}

	async read(
		operationId: OpfsSyncOperationId,
		path: string,
		range: Readonly<{ offset: number; length: number }>,
	): Promise<OpfsSyncReadResult> {
		this.calls.push({ type: 'read', operationId, path, length: range.length });
		if (this.failReads) throw new Error('OPFS worker read failed');
		const bytes = this.#file(path);
		if (range.offset + range.length > bytes.byteLength) throw new RangeError('past EOF');
		return { size: bytes.byteLength, bytes: bytes.slice(range.offset, range.offset + range.length) };
	}

	async snapshot(operationId: OpfsSyncOperationId, path: string): Promise<Blob> {
		this.calls.push({ type: 'snapshot', operationId, path });
		return new Blob([exactBuffer(this.#file(path))]);
	}

	async openWriter(operationId: OpfsSyncOperationId, path: string): Promise<OpfsSyncWriter> {
		this.calls.push({ type: 'open-writer', operationId, path });
		this.files.set(path, new Uint8Array());
		let open = true;
		return {
			write: async (bytes) => {
				if (!open) throw new Error('closed');
				this.calls.push({ type: 'write', operationId, path, length: bytes.byteLength });
				const previous = this.#file(path);
				const next = new Uint8Array(previous.byteLength + bytes.byteLength);
				next.set(previous);
				next.set(bytes, previous.byteLength);
				this.files.set(path, next);
			},
			close: async () => {
				if (!open) return;
				open = false;
				this.calls.push({ type: 'close-writer', operationId, path });
			},
			abort: async () => {
				if (!open) return;
				open = false;
				this.calls.push({ type: 'abort-writer', operationId, path });
				this.files.delete(path);
			},
		};
	}

	async remove(path: string): Promise<void> {
		this.calls.push({ type: 'remove', path });
		this.files.delete(path);
	}

	close(): void { this.closed += 1; }

	#file(path: string): Uint8Array {
		const bytes = this.files.get(path);
		if (!bytes) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
		return bytes;
	}
}

test('a canonical positional read view acquires size once and still reads fresh CRC-checked bytes', async () => {
	const worker = new MemorySyncWorker();
	const repository = new OpfsRepository({ preferOpfs: true, opfsRoot: workerOnlyRoot(), syncWorkerClient: worker });
	const writer = await repository.createPcmWriter('retained', { sampleRate: 48_000, chunkFrames: 2 });
	assert.ok(writer);
	const samples = Float32Array.of(0.25, -0.5);
	await writer.write({ encoding: PCM_ENCODING_RAW_F32LE, payload: samples.buffer,
		pcmCrc32: crc32(new Uint8Array(samples.buffer)), frames: 2, channelCount: 1, sampleRate: 48_000, chunkFrames: 2 });
	await writer.close();
	const source = { storage: 'opfs-pcm-v1', path: writer.path, channelCount: 1,
		sampleRate: 48_000, chunkFrames: 2, chunkCount: 1, frameCount: 2 };
	const pcm = new PcmRepository();
	const admission = new AbortController();
	const view = await repository.openPcmContainerReadView(source, pcm.decodeRecord.bind(pcm), admission.signal);
	assert.ok(view);
	admission.abort(new Error('the session admission is finished'));
	worker.calls.length = 0;
	for (let index = 0; index < 10; index += 1) assert.deepEqual([...(await view.chunk(0)).channels[0]!], [...samples]);
	assert.equal(worker.calls.filter((call) => call.length === 0).length, 0, 'the view retains its positional size authority');
	assert.equal(worker.calls.filter((call) => call.type === 'read').length, 10, 'every requested payload is freshly read');
	const request = new AbortController();
	const reason = new Error('withdraw only this packet');
	request.abort(reason);
	await assert.rejects(view.chunk(0, request.signal), (error) => error === reason);
	assert.deepEqual([...(await view.chunk(0)).channels[0]!], [...samples], 'cancelled requests do not poison the retained view');
	const bytes = worker.files.get(writer.path)!;
	// The first PCM payload begins after the container's32-byte header.
	bytes[32] = bytes[32]! ^ 1;
	await assert.rejects(view.chunk(0), /CRC|checksum/iu);
	await view.release();
	await assert.rejects(view.chunk(0), /released/iu);
});

test('canonical positional view admission retains no asynchronous File snapshot', async () => {
	const worker = new MemorySyncWorker();
	worker.files.set('not-a-container', Uint8Array.of(1));
	const directory = { async getFileHandle() { throw new Error('getFile must not run for session admission'); } } as unknown as FileSystemDirectoryHandle;
	const root = { async getDirectoryHandle() { return directory; } } as unknown as FileSystemDirectoryHandle;
	const repository = new OpfsRepository({ preferOpfs: true, opfsRoot: root, syncWorkerClient: null });
	assert.equal(await repository.openPcmContainerReadView({ path: 'not-a-container' }, async () => ({ index: 0, frames: 0, channels: [] })), null);
});

test('OPFS worker read failure falls back to the durable async file', async () => {
	const worker = new MemorySyncWorker();
	worker.files.set('source', Uint8Array.from([1, 2, 3, 4]));
	const directory = {
		async getFileHandle(path: string) {
			return { async getFile() { return new Blob([exactBuffer(worker.files.get(path)!)]); } };
		},
	} as unknown as FileSystemDirectoryHandle;
	const bridge = new OpfsSyncRepositoryBridge({ client: worker });
	const readable = await bridge.readable(directory, 'canonical-pcm-chunk-read', 'source');
	assert.ok(readable);
	worker.failReads = true;
	assert.deepEqual(new Uint8Array(await readable.slice(1, 3).arrayBuffer()), Uint8Array.from([2, 3]));
	assert.equal(await bridge.readable(directory, 'canonical-pcm-chunk-read', 'source'), null);
	worker.files.set('source', Uint8Array.from([1, 2, 3]));
	await assert.rejects(readable.arrayBuffer(), /changed during a bounded read/u);
});

function workerOnlyRoot(): FileSystemDirectoryHandle {
	const directory = {
		getFileHandle() { throw new Error('The async OPFS path must not be used.'); },
		removeEntry() { throw new Error('The async OPFS path must not be used.'); },
	} as unknown as FileSystemDirectoryHandle;
	return {
		async getDirectoryHandle() { return directory; },
	} as unknown as FileSystemDirectoryHandle;
}

test('OPFS repository routes all six frozen operation classes through the detected worker', async () => {
	const worker = new MemorySyncWorker();
	const repository = new OpfsRepository({
		preferOpfs: true,
		opfsRoot: workerOnlyRoot(),
		syncWorkerClient: worker,
	});

	const media = await repository.writeBlob('media', new Blob(['original']));
	assert.ok(media);
	assert.equal(await blobText(
		await repository.loadBinaryRecord({ storage: 'opfs', path: media.path }, 'missing'),
	), 'original');

	const derivative = await repository.writeBlob('poster', new Blob(['preview']), {
		operationId: 'derivative-payload-write',
	});
	assert.ok(derivative);
	assert.equal(await blobText(await repository.loadBinaryRecord(
		{ storage: 'opfs', path: derivative.path },
		'missing',
		'derivative-payload-read',
	)), 'preview');

	const pcm = await repository.createPcmWriter('pcm-token', { sampleRate: 48_000, chunkFrames: 2 });
	assert.ok(pcm);
	const payload = new Float32Array([0.25, -0.5]);
	await pcm.write({
		encoding: PCM_ENCODING_RAW_F32LE,
		payload: payload.buffer,
		pcmCrc32: crc32(new Uint8Array(payload.buffer)),
		frames: 2,
		channelCount: 1,
		sampleRate: 48_000,
		chunkFrames: 2,
	});
	await pcm.close();
	const decoded = await repository.readPcmContainerChunk({
		storage: 'opfs-pcm-v1',
		path: pcm.path,
		channelCount: 1,
		sampleRate: 48_000,
		chunkFrames: 2,
		chunkCount: 1,
		frameCount: 2,
	}, 0, async (record) => ({
		index: Number(record.index),
		frames: Number(record.frames),
		channels: [new Float32Array(binaryBuffer(record.payload))],
	}));
	assert.deepEqual([...decoded.channels[0]], [0.25, -0.5]);

	assert.deepEqual(new Set(worker.calls.flatMap(({ operationId }) => operationId ? [operationId] : [])), new Set([
		'canonical-pcm-chunk-read',
		'canonical-pcm-chunk-write',
		'media-asset-chunk-read',
		'media-asset-chunk-write',
		'derivative-payload-read',
		'derivative-payload-write',
	]));
	repository.close();
	assert.equal(worker.closed, 1);
});

test('OPFS repository preserves the asynchronous correctness path when the worker is unavailable', async () => {
	let stored = new Blob();
	let asyncWrites = 0;
	const directory = {
		async getFileHandle() {
			return {
				async getFile() { return stored; },
				async createWritable() {
					return {
						async write(blob: Blob) { asyncWrites += 1; stored = blob; },
						async close() {},
						async abort() {},
					};
				},
			};
		},
		async removeEntry() { stored = new Blob(); },
	} as unknown as FileSystemDirectoryHandle;
	const worker: OpfsSyncStoragePort = {
		async initialize() { return false; },
		async read() { throw new Error('unavailable'); },
		async snapshot() { throw new Error('unavailable'); },
		async openWriter() { throw new Error('unavailable'); },
		async remove() { throw new Error('unavailable'); },
		close() {},
	};
	const repository = new OpfsRepository({
		preferOpfs: true,
		opfsRoot: { async getDirectoryHandle() { return directory; } } as unknown as FileSystemDirectoryHandle,
		syncWorkerClient: worker,
	});

	const storedFile = await repository.writeBlob('fallback', new Blob(['fallback']));
	assert.ok(storedFile);
	assert.equal(asyncWrites, 1);
	assert.equal(await blobText(await repository.loadBinaryRecord(
		{ storage: 'opfs', path: storedFile.path }, 'missing',
	)), 'fallback');
});

test('OPFS bridge degrades every operation after its initialized worker fails', async () => {
	const directory = {} as FileSystemDirectoryHandle;
	for (const operation of ['snapshot', 'readable', 'write', 'remove'] as const) {
		let available = true;
		const failure = new Error(`${operation} worker failed`);
		const client: OpfsSyncStoragePort & { isAvailable(): boolean } = {
			async initialize() { return true; },
			isAvailable() { return available; },
			async read() { available = false; throw failure; },
			async snapshot() { available = false; throw failure; },
			async openWriter() {
				return {
					async write() { available = false; throw failure; },
					async close() {},
					async abort() {},
				};
			},
			async remove() { available = false; throw failure; },
			close() {},
		};
		const bridge = new OpfsSyncRepositoryBridge({ client });
		if (operation === 'snapshot') {
			assert.equal(await bridge.snapshot(directory, 'media-asset-chunk-read', 'body'), null);
		} else if (operation === 'readable') {
			assert.equal(await bridge.readable(directory, 'media-asset-chunk-read', 'body'), null);
		} else if (operation === 'write') {
			assert.equal(await bridge.writeBlob(
				directory, 'media-asset-chunk-write', 'body', new Blob(['body']),
			), false);
		} else {
			assert.equal(await bridge.remove(directory, 'body'), false);
		}
		assert.equal(await bridge.available(directory), false);
	}
});

test('PCM writer abort remains available after container close fails', async () => {
	const failure = new Error('durable close failed');
	let aborts = 0;
	let removals = 0;
	const writer: OpfsSyncWriter = {
		async write() {},
		async close() { throw failure; },
		async abort() { aborts += 1; },
	};
	const pcm = syncPcmWriter(
		'failed.scpcm', writer, { sampleRate: 48_000, chunkFrames: 2 },
		() => undefined, async () => { removals += 1; },
	);
	const payload = new Float32Array([0.25, -0.5]);
	await pcm.write({
		encoding: PCM_ENCODING_RAW_F32LE,
		payload: payload.buffer,
		pcmCrc32: crc32(new Uint8Array(payload.buffer)),
		frames: 2,
		channelCount: 1,
		sampleRate: 48_000,
		chunkFrames: 2,
	});
	await assert.rejects(pcm.close(), failure);
	await pcm.abort();

	assert.equal(aborts, 1);
	assert.equal(removals, 1);
});

test('sync binary writer abort removes its staged path after close', async () => {
	let aborts = 0;
	let removals = 0;
	const writer: OpfsSyncWriter = {
		async write() {},
		async close() {},
		async abort() { aborts += 1; },
	};
	const binary = syncBinaryWriter(
		'staged.blob', writer, async () => { removals += 1; },
	);
	await binary.write(Uint8Array.of(1, 2, 3));
	await binary.close();
	await binary.abort();

	assert.equal(aborts, 1);
	assert.equal(removals, 1);
});

test('asynchronous PCM writer aborts its stream after container close fails', async () => {
	const failure = new Error('asynchronous durable close failed');
	let aborts = 0;
	let removals = 0;
	const directory = {
		async getFileHandle() {
			return {
				async createWritable() {
					return {
						async write() {},
						async close() { throw failure; },
						async abort() { aborts += 1; },
					};
				},
			};
		},
		async removeEntry() { removals += 1; },
	} as unknown as FileSystemDirectoryHandle;
	const repository = new OpfsRepository({
		preferOpfs: true,
		opfsRoot: { async getDirectoryHandle() { return directory; } } as unknown as FileSystemDirectoryHandle,
		syncWorkerClient: unavailableSyncWorker(),
	});
	const pcm = await repository.createPcmWriter('failed-async', { sampleRate: 48_000, chunkFrames: 2 });
	assert.ok(pcm);
	const payload = new Float32Array([0.25, -0.5]);
	await pcm.write({
		encoding: PCM_ENCODING_RAW_F32LE, payload: payload.buffer,
		pcmCrc32: crc32(new Uint8Array(payload.buffer)), frames: 2,
		channelCount: 1, sampleRate: 48_000, chunkFrames: 2,
	});
	await assert.rejects(pcm.close(), failure);
	await pcm.abort();

	assert.equal(aborts, 1);
	assert.equal(removals, 1);
});

function unavailableSyncWorker(): OpfsSyncStoragePort {
	return {
		async initialize() { return false; },
		async read() { throw new Error('unavailable'); },
		async snapshot() { throw new Error('unavailable'); },
		async openWriter() { throw new Error('unavailable'); },
		async remove() { throw new Error('unavailable'); },
		close() {},
	};
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

function binaryBuffer(value: unknown): ArrayBuffer {
	if (value instanceof ArrayBuffer) return value;
	if (ArrayBuffer.isView(value)) {
		return exactBuffer(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
	}
	throw new TypeError('binary payload required');
}

async function blobText(blob: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<string> {
	return new TextDecoder().decode(await blob.arrayBuffer());
}

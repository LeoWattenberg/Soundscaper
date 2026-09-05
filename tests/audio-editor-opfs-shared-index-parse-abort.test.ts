/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { crc32, PCM_ENCODING_RAW_F32LE } from '../src/common/editor/wavpack/index.js';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';
import type {
	OpfsSyncReadResult,
	OpfsSyncStoragePort,
	OpfsSyncWriter,
} from '../src/common/editor/storage/opfs-sync-worker-client.ts';
import type { OpfsSyncOperationId } from '../src/common/editor/storage/opfs-sync-worker-protocol.ts';

interface ReadCall {
	readonly path: string;
	readonly offset: number;
	readonly length: number;
}

/**
 * A worker port that holds its first non-empty read open until it is released, and that
 * rejects a held read with the requesting signal's reason exactly as the request broker does.
 */
class DeferredReadSyncWorker implements OpfsSyncStoragePort {
	readonly files = new Map<string, Uint8Array>();
	readonly reads: ReadCall[] = [];
	readonly deferredReadStarted: Promise<void>;
	#announceDeferredRead: () => void = () => {};
	#release: (() => void) | null = null;
	#deferralUsed = false;

	constructor() {
		this.deferredReadStarted = new Promise<void>((resolve) => { this.#announceDeferredRead = resolve; });
	}

	async initialize(_directory: FileSystemDirectoryHandle): Promise<boolean> {
		return true;
	}

	async read(
		_operationId: OpfsSyncOperationId,
		path: string,
		range: Readonly<{ offset: number; length: number }>,
		signal?: AbortSignal,
	): Promise<OpfsSyncReadResult> {
		const bytes = this.#file(path);
		if (range.length > 0) {
			this.reads.push({ path, offset: range.offset, length: range.length });
			if (!this.#deferralUsed) {
				this.#deferralUsed = true;
				await this.#hold(signal);
			}
		}
		throwIfAborted(signal);
		if (range.offset + range.length > bytes.byteLength) throw new RangeError('past EOF');
		return { size: bytes.byteLength, bytes: bytes.slice(range.offset, range.offset + range.length) };
	}

	async snapshot(_operationId: OpfsSyncOperationId, path: string): Promise<Blob> {
		return new Blob([exactBuffer(this.#file(path))]);
	}

	async openWriter(_operationId: OpfsSyncOperationId, path: string): Promise<OpfsSyncWriter> {
		this.files.set(path, new Uint8Array());
		return {
			write: async (bytes) => {
				const previous = this.#file(path);
				const next = new Uint8Array(previous.byteLength + bytes.byteLength);
				next.set(previous);
				next.set(bytes, previous.byteLength);
				this.files.set(path, next);
			},
			close: async () => {},
			abort: async () => { this.files.delete(path); },
		};
	}

	async remove(path: string): Promise<void> {
		this.files.delete(path);
	}

	close(): void {}

	releaseDeferredRead(): void {
		this.#release?.();
		this.#release = null;
	}

	#hold(signal?: AbortSignal): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const rejectWithReason = (): void => { reject(signal?.reason); };
			if (signal?.aborted) {
				rejectWithReason();
				return;
			}
			signal?.addEventListener('abort', rejectWithReason, { once: true });
			this.#release = () => {
				signal?.removeEventListener('abort', rejectWithReason);
				resolve();
			};
			this.#announceDeferredRead();
		});
	}

	#file(path: string): Uint8Array {
		const bytes = this.files.get(path);
		if (!bytes) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
		return bytes;
	}
}

test('OPFS repository serves a shared container index parse to readers whose peer aborts', async () => {
	const worker = new DeferredReadSyncWorker();
	const repository = new OpfsRepository({
		preferOpfs: true,
		opfsRoot: workerOnlyRoot(),
		syncWorkerClient: worker,
	});

	const source = await writeOneChunkContainer(repository);
	const abortedReader = new AbortController();
	const liveReader = new AbortController();
	const abortReason = Object.assign(new Error('the first reader stopped'), { name: 'AbortError' });

	const first = repository.readPcmContainerChunk(source, 0, decodeRawChunk, abortedReader.signal);
	const firstSettled = first.catch(() => undefined);
	await worker.deferredReadStarted;
	const second = repository.readPcmContainerChunk(source, 0, decodeRawChunk);
	const secondSettled = second.catch(() => undefined);
	const third = repository.readPcmContainerChunk(source, 0, decodeRawChunk, liveReader.signal);
	const thirdSettled = third.catch(() => undefined);
	await macrotask();

	abortedReader.abort(abortReason);
	worker.releaseDeferredRead();
	await Promise.all([firstSettled, secondSettled, thirdSettled]);

	await assert.rejects(first, (error) => error instanceof Error && error.name === 'AbortError');
	assert.deepEqual([...(await second).channels[0]], [0.25, -0.5]);
	assert.deepEqual([...(await third).channels[0]], [0.25, -0.5]);
	assert.equal(liveReader.signal.aborted, false);
	assert.equal(
		worker.reads.filter(({ path, offset }) => path === source.path && offset === 0).length,
		1,
		'the container header is parsed once and shared by every reader',
	);
});

async function writeOneChunkContainer(repository: OpfsRepository): Promise<StorageRecord> {
	const writer = await repository.createPcmWriter('shared-index', { sampleRate: 48_000, chunkFrames: 2 });
	assert.ok(writer);
	const payload = new Float32Array([0.25, -0.5]);
	await writer.write({
		encoding: PCM_ENCODING_RAW_F32LE,
		payload: payload.buffer,
		pcmCrc32: crc32(new Uint8Array(payload.buffer)),
		frames: 2,
		channelCount: 1,
		sampleRate: 48_000,
		chunkFrames: 2,
	});
	await writer.close();
	return {
		storage: 'opfs-pcm-v1',
		path: writer.path,
		channelCount: 1,
		sampleRate: 48_000,
		chunkFrames: 2,
		chunkCount: 1,
		frameCount: 2,
	};
}

async function decodeRawChunk(record: Record<string, unknown>): Promise<{
	index: number;
	frames: number;
	channels: Float32Array[];
}> {
	return {
		index: Number(record.index),
		frames: Number(record.frames),
		channels: [new Float32Array(binaryBuffer(record.payload))],
	};
}

function workerOnlyRoot(): FileSystemDirectoryHandle {
	const directory = {
		getFileHandle() { throw new Error('The async OPFS path must not be used.'); },
		removeEntry() { throw new Error('The async OPFS path must not be used.'); },
	} as unknown as FileSystemDirectoryHandle;
	return {
		async getDirectoryHandle() { return directory; },
	} as unknown as FileSystemDirectoryHandle;
}

function macrotask(): Promise<void> {
	return new Promise<void>((resolve) => { setTimeout(resolve, 0); });
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason;
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

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PcmContainerWriter,
	compressionStatistics,
} from '../wavpack/index.js';
import type { StorageRecord } from './media-records.ts';
import type { OpfsSyncWriter } from './opfs-sync-worker-client.ts';

interface SyncPcmChunk extends Record<string, unknown> {
	readonly frames: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly chunkFrames: number;
}

interface SyncPcmWriter {
	readonly path: string;
	write(chunk: SyncPcmChunk): Promise<void>;
	close(): Promise<Record<string, unknown>>;
	remove(): Promise<void>;
	abort(): Promise<void>;
}

interface ContainerWriterInstance {
	write(chunk: SyncPcmChunk): Promise<void>;
	close(): Promise<Record<string, unknown>>;
	statistics(): Record<string, unknown>;
}

type ContainerWriterConstructor = new (
	writable: FileSystemWritableFileStream,
	options: {
		readonly channelCount: number;
		readonly sampleRate: number;
		readonly chunkFrames: number;
	},
) => ContainerWriterInstance;

const ContainerWriter = PcmContainerWriter as unknown as ContainerWriterConstructor;

export function syncBinaryWriter(
	path: string,
	writer: OpfsSyncWriter,
	defaultSignal?: AbortSignal,
): Readonly<{
	path: string;
	write(bytes: Uint8Array, options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	close(options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	abort(): Promise<void>;
}> {
	return {
		path,
		write: (bytes, options = {}) => writer.write(bytes, options.signal ?? defaultSignal),
		close: (options = {}) => writer.close(options.signal ?? defaultSignal),
		abort: () => writer.abort(),
	};
}

export function syncPcmWriter(
	path: string,
	writer: OpfsSyncWriter,
	metadata: StorageRecord,
	invalidate: () => void,
	remove: () => Promise<void>,
): SyncPcmWriter {
	const writable = {
		write: (input: unknown) => writer.write(binaryBytes(input)),
		close: () => writer.close(),
	};
	let container: ContainerWriterInstance | null = null;
	let writeClosed = false;
	let finalized = false;
	return {
		path,
		async write(chunk) {
			if (writeClosed) throw new Error('The OPFS source writer is closed.');
			if (!container) {
				container = new ContainerWriter(writable as unknown as FileSystemWritableFileStream, {
					channelCount: chunk.channelCount,
					sampleRate: chunk.sampleRate ?? metadata.sampleRate ?? 48_000,
					chunkFrames: chunk.chunkFrames ?? metadata.chunkFrames ?? chunk.frames,
				});
			}
			await container.write(chunk);
		},
		async close() {
			if (finalized) return container?.statistics() || compressionStatistics();
			if (writeClosed) throw new Error('The OPFS source writer close previously failed.');
			writeClosed = true;
			const statistics = container
				? await container.close()
				: await writer.close().then(() => compressionStatistics());
			finalized = true;
			return statistics;
		},
		async remove() {
			invalidate();
			await remove();
		},
		async abort() {
			if (!finalized) {
				writeClosed = true;
				finalized = true;
				await writer.abort();
			}
			invalidate();
			await remove();
		},
	};
}

function binaryBytes(value: unknown): Uint8Array {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	throw new TypeError('A binary OPFS container write is required.');
}

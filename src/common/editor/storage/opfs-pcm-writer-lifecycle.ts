/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PcmContainerWriter,
	compressionStatistics,
} from '../wavpack/index.js';
import type { StorageRecord } from './media-records.ts';

export interface OpfsPcmChunk extends Record<string, unknown> {
	readonly frames: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly chunkFrames: number;
}

export interface OpfsPcmWriter {
	readonly path: string;
	write(chunk: OpfsPcmChunk): Promise<void>;
	close(): Promise<Record<string, unknown>>;
	remove(): Promise<void>;
	abort(): Promise<void>;
}

interface PcmContainerWritable {
	write(input: unknown): Promise<unknown>;
	close(): Promise<unknown>;
	abort?(reason?: unknown): Promise<unknown>;
}

interface ContainerWriterInstance {
	readonly writableReleased: boolean;
	write(chunk: OpfsPcmChunk): Promise<void>;
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

interface OpfsPcmWriterLifecycleOptions {
	readonly path: string;
	readonly metadata: StorageRecord;
	readonly writable: PcmContainerWritable;
	readonly closeEmpty: () => Promise<unknown>;
	readonly abortOpen: () => Promise<unknown>;
	readonly invalidate: () => void;
	readonly remove: () => Promise<void>;
}

const ContainerWriter = PcmContainerWriter as unknown as ContainerWriterConstructor;

/** Shared container state machine with backend-specific release and removal ports. */
export function createOpfsPcmWriterLifecycle(
	options: OpfsPcmWriterLifecycleOptions,
): OpfsPcmWriter {
	let container: ContainerWriterInstance | null = null;
	let writeClosed = false;
	let finalized = false;
	let writeTail = Promise.resolve();
	let closing: Promise<Record<string, unknown>> | null = null;

	return { path: options.path, write, close, remove, abort };

	function write(chunk: OpfsPcmChunk): Promise<void> {
		if (writeClosed) return Promise.reject(new Error('The OPFS source writer is closed.'));
		container ??= new ContainerWriter(
			options.writable as unknown as FileSystemWritableFileStream,
			{
				channelCount: chunk.channelCount,
				sampleRate: chunk.sampleRate ?? options.metadata.sampleRate ?? 48_000,
				chunkFrames: chunk.chunkFrames ?? options.metadata.chunkFrames ?? chunk.frames,
			},
		);
		const target = container;
		const writing = writeTail.then(() => target.write(chunk));
		writeTail = writing.then(() => undefined, () => undefined);
		return writing;
	}

	function close(): Promise<Record<string, unknown>> {
		if (finalized) return Promise.resolve(statistics());
		if (closing) return closing;
		if (writeClosed) {
			return Promise.reject(new Error('The OPFS source writer close previously failed.'));
		}
		writeClosed = true;
		closing = finishClose();
		return closing;
	}

	async function finishClose(): Promise<Record<string, unknown>> {
		try {
			await writeTail;
			const result = container
				? await container.close()
				: await options.closeEmpty().then(() => compressionStatistics());
			finalized = true;
			return result;
		} finally {
			closing = null;
		}
	}

	async function remove(): Promise<void> {
		options.invalidate();
		await options.remove();
	}

	async function abort(): Promise<void> {
		if (!finalized) {
			writeClosed = true;
			finalized = true;
			if (closing) await closing.catch(() => undefined);
			else await writeTail;
			if (!container?.writableReleased) await options.abortOpen();
		}
		await remove();
	}

	function statistics(): Record<string, unknown> {
		return container?.statistics() || compressionStatistics();
	}
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { containerCodecToEncoding, readPcmContainerPayload } from '../wavpack/index.js';
import type { BlobLike, StorageRecord } from './media-records.ts';
import { positionalReadableWithSignal } from './opfs-sync-repository-bridge.ts';

export interface PcmContainerReadEntry {
	readonly index: number;
	readonly frames: number;
	readonly codec: number;
	readonly pcmCrc32: number;
}

interface PcmChunk {
	readonly index: number;
	readonly frames: number;
	readonly channels: readonly Float32Array[];
}

export type DecodePcmContainerChunk = (
	record: Record<string, unknown>, source: StorageRecord,
	signal: AbortSignal | undefined, priority: string,
) => Promise<PcmChunk>;

export interface OpfsPcmReadView {
	chunk(chunkIndex: number, signal?: AbortSignal, priority?: string): Promise<PcmChunk>;
	release(): Promise<void>;
}

/** Retain only a fresh positional reader; browser File snapshots cannot enter this view. */
export function createOpfsPcmReadView(
	file: BlobLike, index: Readonly<{ entries: readonly PcmContainerReadEntry[] }>,
	source: StorageRecord, decode: DecodePcmContainerChunk,
): OpfsPcmReadView {
	let retainedFile: BlobLike | null = file;
	let retainedIndex: typeof index | null = index;
	return Object.freeze({
		async chunk(chunkIndex: number, signal?: AbortSignal, priority = 'foreground'): Promise<PcmChunk> {
			signal?.throwIfAborted();
			const currentFile = retainedFile && positionalReadableWithSignal(retainedFile, signal);
			if (!currentFile || !retainedIndex) throw new Error('The OPFS PCM read view was released.');
			const entry = retainedIndex.entries[chunkIndex];
			if (!entry) throw new RangeError(`Source storage chunk ${chunkIndex} does not exist.`);
			const payload = await readPcmContainerPayload(currentFile, entry, { signal });
			const chunk = await decode(containerRecord(entry, payload), source, signal, priority);
			signal?.throwIfAborted();
			if (!retainedFile) throw new Error('The OPFS PCM read view was released.');
			return chunk;
		},
		release(): Promise<void> { retainedFile = null; retainedIndex = null; return Promise.resolve(); },
	});
}

export function containerRecord(entry: PcmContainerReadEntry, payload: unknown): Record<string, unknown> {
	return { index: entry.index, frames: entry.frames, encoding: containerCodecToEncoding(entry.codec), payload, pcmCrc32: entry.pcmCrc32 };
}

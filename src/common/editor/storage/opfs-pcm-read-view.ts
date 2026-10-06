/* SPDX-License-Identifier: AGPL-3.0-only */

import { containerCodecToEncoding, pcmRawByteLength, readPcmContainerPayload } from '../wavpack/index.js';
import type { BlobLike, StorageRecord } from './media-records.ts';
import { positionalReadableWithSignal } from './opfs-sync-repository-bridge.ts';

export interface PcmContainerReadEntry {
	readonly index: number;
	readonly frames: number;
	readonly codec: number;
	readonly pcmCrc32: number;
	readonly length: number;
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
	readonly maximumConcurrentReads: 1 | 2;
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
		maximumConcurrentReads: boundedPositionalReadConcurrency(index.entries, Number(source.channelCount)),
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

/** Count encoded input plus two decoded representations before admitting two packets. */
export function boundedPositionalReadConcurrency(entries: readonly PcmContainerReadEntry[], channelCount: number): 1 | 2 {
	const maximumPacketBytes = entries.reduce((maximum, entry) => Math.max(maximum,
		entry.length + 2 * pcmRawByteLength(entry.frames, channelCount)), 0);
	return Number.isSafeInteger(maximumPacketBytes) && maximumPacketBytes > 0
		&& maximumPacketBytes * 2 <= 64 * 1024 ** 2 ? 2 : 1;
}

export function containerRecord(entry: PcmContainerReadEntry, payload: unknown): Record<string, unknown> {
	return { index: entry.index, frames: entry.frames, encoding: containerCodecToEncoding(entry.codec), payload, pcmCrc32: entry.pcmCrc32 };
}

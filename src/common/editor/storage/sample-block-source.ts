/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StorageRecord } from './media-records.ts';
import type { SourceRecordRepository } from './source-record-repository.ts';
import type { SourcePcmChunk } from './source-read-repository.ts';
import { normalizePcmChunkFrames } from './pcm-chunk-geometry.ts';
import { cloneStorageValue } from './storage-clone.ts';
import { createId, PENDING_SOURCE_RETENTION_MS } from './source-write-common.ts';

export const SAMPLE_BLOCK_SOURCE_STORAGE = 'sample-block-sequence';

export interface SampleBlockReference {
	readonly start: number;
	readonly frameCount: number;
	/** Null represents an implicit Audacity silence block. */
	readonly poolStartFrame: number | null;
}

export async function publishSampleBlockSource(
	records: Pick<SourceRecordRepository, 'getMetadata' | 'putDerivedMetadataIfBaseCurrent'>,
	sourceId: string,
	baseSourceId: string,
	channels: readonly (readonly SampleBlockReference[])[],
	metadata: Readonly<Record<string, unknown>>,
): Promise<StorageRecord> {
	if (!sourceId || !baseSourceId || sourceId === baseSourceId) throw new Error('Distinct source and backing source ids are required.');
	const base = await records.getMetadata(baseSourceId);
	if (!base || base.channelCount !== 1 || base.baseSourceId) throw new Error('A physical mono backing source is required.');
	const frameCount = positive(metadata.frameCount);
	const sampleRate = positive(metadata.sampleRate);
	const chunkFrames = normalizePcmChunkFrames(metadata.chunkFrames);
	if (channels.length < 1 || channels.length > 2 || channels.length !== metadata.channelCount) {
		throw new Error('Invalid sample-block source channel layout.');
	}
	const poolFrames = positive(base.frameCount ?? base.frameLength);
	for (const blocks of channels) {
		let end = 0;
		for (const block of blocks) {
			const length = positive(block.frameCount);
			if (block.start !== end || end + length > frameCount || !Number.isSafeInteger(end + length)
				|| (block.poolStartFrame !== null && (!Number.isSafeInteger(block.poolStartFrame)
					|| block.poolStartFrame < 0 || block.poolStartFrame + length > poolFrames))) {
				throw new Error('Invalid sample-block source range.');
			}
			end += length;
		}
	}
	const record: StorageRecord = {
		...cloneStorageValue(metadata), id: sourceId, baseSourceId,
		storage: SAMPLE_BLOCK_SOURCE_STORAGE, sourceToken: `${sourceId}:blocks:${createId('write')}`,
		sampleBlockChannels: cloneStorageValue(channels), frameCount, frameLength: frameCount,
		sampleRate, channelCount: channels.length, chunkFrames, chunkCount: Math.ceil(frameCount / chunkFrames),
		uncompressedBytes: 0, storedBytes: 0,
		committedAt: new Date().toISOString(),
		pendingProjectUntil: new Date(Date.now() + PENDING_SOURCE_RETENTION_MS).toISOString(),
	};
	const result = await records.putDerivedMetadataIfBaseCurrent(record, base);
	if (result !== 'published') throw new Error(`Sample-block source publication was refused: ${result}.`);
	return cloneStorageValue(record);
}

/** Assemble only the requested output window, retaining at most its backing chunks. */
export async function readSampleBlockSourceChunk(
	source: StorageRecord,
	base: StorageRecord,
	chunkIndex: number,
	read: (chunkIndex: number) => Promise<SourcePcmChunk>,
): Promise<SourcePcmChunk> {
	const frameCount = positive(source.frameCount ?? source.frameLength);
	const chunkFrames = normalizePcmChunkFrames(source.chunkFrames);
	const offset = chunkIndex * chunkFrames;
	const frames = Math.min(chunkFrames, frameCount - offset);
	if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || frames <= 0) throw new RangeError('Sample-block chunk does not exist.');
	const poolChunkFrames = normalizePcmChunkFrames(base.chunkFrames);
	const channelBlocks = source.sampleBlockChannels as readonly (readonly SampleBlockReference[])[];
	if (!Array.isArray(channelBlocks) || channelBlocks.length !== source.channelCount) throw new Error('Invalid stored sample-block layout.');
	const channels: Float32Array[] = [];
	// A tiny cache helps stereo references without retaining a fragmented window's entire pool.
	const cache = new Map<number, SourcePcmChunk>();
	for (const blocks of channelBlocks) {
		const output = new Float32Array(frames);
		let index = firstOverlappingBlock(blocks, offset);
		for (; index < blocks.length; index += 1) {
			const block = blocks[index]!;
			if (block.start >= offset + frames) break;
			if (block.poolStartFrame === null) continue;
			const start = Math.max(offset, block.start);
			const end = Math.min(offset + frames, block.start + block.frameCount);
			for (let position = start; position < end;) {
				const poolFrame = block.poolStartFrame + position - block.start;
				const poolIndex = Math.floor(poolFrame / poolChunkFrames);
				let chunk = cache.get(poolIndex);
				if (!chunk) {
					chunk = await read(poolIndex);
					if (cache.size >= 4) cache.delete(cache.keys().next().value!);
					cache.set(poolIndex, chunk);
				}
				const inChunk = poolFrame % poolChunkFrames;
				const count = Math.min(end - position, chunk.frames - inChunk);
				if (count <= 0 || chunk.channels.length !== 1) throw new Error('Incomplete sample-block backing PCM.');
				output.set(chunk.channels[0]!.subarray(inChunk, inChunk + count), position - offset);
				position += count;
			}
		}
		channels.push(output);
	}
	return { index: chunkIndex, frames, channels };
}

function firstOverlappingBlock(blocks: readonly SampleBlockReference[], offset: number): number {
	let low = 0, high = blocks.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2), block = blocks[middle]!;
		if (block.start + block.frameCount <= offset) low = middle + 1;
		else high = middle;
	}
	return low;
}

function positive(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('Sample-block geometry must be a positive safe integer.');
	return Number(value);
}

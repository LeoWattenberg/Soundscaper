/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StorageRecord } from '../../src/common/editor/storage/media-records.ts';
import { SourceReadRepository } from '../../src/common/editor/storage/source-read-repository.ts';

export function copyOnWriteFixture() {
	return sourceFixture([
		sourceRecord('derived', 'derived-token', {
			storage: 'copy-on-write', baseSourceId: 'base', chunkCount: 2,
		}),
		sourceRecord('base', 'base-token', { chunkCount: 2 }),
	], [
		chunkRecord('derived-token', 0, -0.5),
		chunkRecord('base-token', 0, 0.25),
		chunkRecord('base-token', 1, 0.75),
	]);
}

export function sourceFixture(
	sources: readonly StorageRecord[],
	chunks: readonly Readonly<Record<string, unknown>>[],
	options: Readonly<{
		afterDecode?: () => void;
		fallback?: ConstructorParameters<typeof SourceReadRepository>[0]['fallback'];
		opfs?: ConstructorParameters<typeof SourceReadRepository>[0]['opfs'];
	}> = {},
) {
	const metadata = new Map(sources.map((source) => [String(source.id), clone(source)]));
	const storedChunks = new Map(chunks.map((chunk) => [String(chunk.key), clone(chunk)]));
	const decoded: string[] = [];
	const metadataReads: string[] = [];
	const metadataBatches: string[][] = [];
	const records = {
		async getMetadata(sourceId: string) {
			metadataReads.push(sourceId);
			const value = metadata.get(sourceId);
			return value ? clone(value) : null;
		},
		async getMetadataMany(sourceIds: readonly string[]) {
			metadataBatches.push([...sourceIds]);
			return sourceIds.map((sourceId) => {
				const value = metadata.get(sourceId);
				return value ? clone(value) : null;
			});
		},
		async chunk(sourceToken: string, chunkIndex: number) {
			const value = storedChunks.get(chunkKey(sourceToken, chunkIndex));
			return value ? clone(value) : null;
		},
		async *chunks(sourceToken: string) {
			for (const value of [...storedChunks.values()]
				.filter((chunk) => chunk.sourceToken === sourceToken)
				.sort((left, right) => Number(left.index) - Number(right.index))) {
				yield clone(value);
			}
		},
	};
	const reader = new SourceReadRepository({
		records: records as never,
		pcm: {
			async decodeRecord(record: Readonly<Record<string, unknown>>) {
				decoded.push(`${String(record.sourceToken)}:${String(record.index)}`);
				const channels = (record.channels as readonly Float32Array[]).map((channel) => channel.slice());
				options.afterDecode?.();
				return { index: record.index, frames: Number(record.frames), channels };
			},
		} as never,
		opfs: options.opfs ?? {
			readPcmContainerChunk: async () => { throw new Error('Unexpected OPFS PCM-container read.'); },
			readLegacyChunk: async () => { throw new Error('Unexpected legacy OPFS read.'); },
		} as never,
		fallback: options.fallback,
	});
	return { decoded, metadata, metadataReads, metadataBatches, reader, records };
}

export function sourceRecord(
	id: string,
	sourceToken: string,
	overrides: Readonly<Record<string, unknown>> = {},
): StorageRecord {
	return Object.freeze({
		id,
		storage: 'indexeddb-chunks',
		sourceToken,
		baseSourceId: null,
		path: null,
		pcmEncodingVersion: 1,
		frameCount: 1,
		frameLength: 1,
		channelCount: 1,
		sampleRate: 48_000,
		chunkFrames: 1,
		chunkCount: 1,
		...overrides,
	});
}

export function chunkRecord(sourceToken: string, index: number, sample: number) {
	return Object.freeze({
		key: chunkKey(sourceToken, index),
		sourceToken,
		index,
		frames: 1,
		channels: [Float32Array.of(sample)],
	});
}

function chunkKey(sourceToken: string, index: number): string {
	return `${sourceToken}:${String(index).padStart(10, '0')}`;
}

function clone<Value>(value: Value): Value {
	return structuredClone(value);
}

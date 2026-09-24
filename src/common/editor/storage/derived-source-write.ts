/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_ENCODING_WAVPACK_F32_V1,
	compressionStatistics,
	packPlanarFloat32,
} from '../wavpack/index.js';
import { normalizeChannels, type StorageRecord } from './media-records.ts';
import { normalizePcmChunkFrames } from './pcm-chunk-geometry.ts';
import type { PcmRepository } from './pcm-repository.ts';
import type { SourceChunkRecord, SourceRecordRepository } from './source-record-repository.ts';
import {
	PENDING_SOURCE_RETENTION_MS,
	cleanupFailure,
	clone,
	createId,
	positiveInteger,
} from './source-write-common.ts';

interface DerivedSourceWriteOptions {
	readonly records: Pick<SourceRecordRepository,
		'getMetadata' | 'chunks' | 'writeChunk' | 'deleteChunks' | 'putDerivedMetadataIfBaseCurrent' | 'deleteMetadataIfCurrent'>;
	readonly pcm: Pick<PcmRepository, 'encode' | 'decodeRecord'>;
	readonly database: () => Promise<IDBDatabase | null>;
}

// Rebase a sparse overlay onto its physical root before reads need a long ancestry walk.
const MATERIALIZE_AT_DEPENDENCY_COUNT = 16;

export async function writeDerivedSource(
	options: DerivedSourceWriteOptions,
	sourceId: string,
	baseSourceId: string,
	replacementChunks: readonly unknown[],
	metadata: Record<string, unknown> = {},
): Promise<StorageRecord> {
	if (!sourceId || !baseSourceId || sourceId === baseSourceId) throw new Error('Distinct source and base source ids are required.');
	if (!Array.isArray(replacementChunks) || !replacementChunks.length) throw new Error('At least one replacement source chunk is required.');
	const incomingChunks = replacementChunks.map((value) => {
		const input = asRecord(value);
		return { index: input?.index, channels: normalizeChannels(input?.channels).map((channel) => channel.slice()) };
	});
	const base = await options.records.getMetadata(baseSourceId);
	if (!base) throw new Error('The immutable base source could not be found.');
	if (await options.records.getMetadata(sourceId)) throw new Error('Immutable source ids cannot be overwritten.');
	const dependencies = await sourceDependencies(options.records, base);
	const materialize = dependencies.length >= MATERIALIZE_AT_DEPENDENCY_COUNT;
	const physicalBase = dependencies.at(-1) as StorageRecord;
	const channelCount = positiveInteger(base.channelCount, 64);
	const frameCount = positiveInteger(base.frameCount ?? base.frameLength, Number.MAX_SAFE_INTEGER);
	const chunkFrames = normalizePcmChunkFrames(metadata.chunkFrames ?? base.chunkFrames ?? 65_536);
	const expectedChunkCount = Math.ceil(frameCount / chunkFrames);
	const token = `${sourceId}:cow:${createId('write')}`;
	const seenIndices = new Set<number>();
	const chunks = incomingChunks.map((input, replacementIndex) => {
		const index = nonNegativeInteger(input.index, -1);
		if (index < 0 || index >= expectedChunkCount || seenIndices.has(index)) throw new Error('A derived source contains an invalid replacement chunk index.');
		seenIndices.add(index);
		if (input.channels.length !== channelCount) throw new Error('A derived source replacement has the wrong channel count.');
		const expectedFrames = index === expectedChunkCount - 1 ? frameCount - index * chunkFrames : chunkFrames;
		if (input.channels[0]?.length !== expectedFrames) throw new Error('A derived source replacement has the wrong frame count.');
		return { ...input, index, frames: expectedFrames, createdAt: Date.now() + replacementIndex };
	});
	const database = await options.database();
	let uncompressedBytes = 0;
	let storedBytes = 0;
	let wavpackChunkCount = 0;
	let rawChunkCount = 0;
	try {
		const writeChunk = async (
			chunk: Readonly<{ index: number; frames: number; channels: readonly Float32Array[]; createdAt: number }>,
		): Promise<void> => {
			let record: SourceChunkRecord;
			if (database) {
				const stored = await options.pcm.encode(packPlanarFloat32(chunk.channels), {
					frames: chunk.frames,
					channelCount,
					sampleRate: Number(metadata.sampleRate ?? base.sampleRate ?? 48_000),
					priority: 'foreground',
					allowRawOnFailure: true,
				});
				record = chunkRecord(token, chunk.index, chunk.frames, chunk.createdAt, stored);
				uncompressedBytes += stored.uncompressedBytes;
				storedBytes += stored.storedBytes;
				if (stored.encoding === PCM_ENCODING_WAVPACK_F32_V1) wavpackChunkCount += 1;
				else rawChunkCount += 1;
			} else {
				record = {
					key: chunkKey(token, chunk.index), sourceToken: token, index: chunk.index,
					frames: chunk.frames,
					channels: chunk.channels.map((channel) => channel.buffer.slice(0)),
					createdAt: chunk.createdAt,
				};
				const rawBytes = chunk.frames * channelCount * Float32Array.BYTES_PER_ELEMENT;
				uncompressedBytes += rawBytes;
				storedBytes += rawBytes;
				rawChunkCount += 1;
			}
			await options.records.writeChunk(record);
		};
		for (const chunk of chunks) await writeChunk(chunk);
		if (materialize) {
			for (const owner of dependencies) {
				if (owner.storage !== 'copy-on-write') break;
				if (!owner.sourceToken) throw new Error('A derived source has no storage token.');
				const ownerIndices = new Set<number>();
				for await (const stored of options.records.chunks(owner.sourceToken)) {
					const index = nonNegativeInteger(stored.index, -1);
					if (index < 0 || index >= expectedChunkCount || ownerIndices.has(index)) {
						throw new Error('A derived source contains an invalid stored replacement chunk index.');
					}
					ownerIndices.add(index);
					if (seenIndices.has(index)) continue;
					const decoded = await options.pcm.decodeRecord(stored, owner);
					const expectedFrames = index === expectedChunkCount - 1
						? frameCount - index * chunkFrames : chunkFrames;
					if (decoded.frames !== expectedFrames || decoded.channels.length !== channelCount) {
						throw new Error('A derived source replacement has incompatible PCM geometry.');
					}
					await writeChunk({
						index, frames: expectedFrames, channels: decoded.channels, createdAt: Date.now(),
					});
					seenIndices.add(index);
				}
				if (owner.overrideChunkCount !== undefined
					&& Number(owner.overrideChunkCount) !== ownerIndices.size) {
					throw new Error('A derived source is missing stored replacement chunks.');
				}
			}
		}
	} catch (error) {
		await options.records.deleteChunks(token);
		throw error;
	}
	const record: StorageRecord = {
		...clone(metadata),
		id: sourceId,
		storage: 'copy-on-write',
		baseSourceId: materialize ? physicalBase.id : baseSourceId,
		sourceToken: token,
		channelCount,
		frameLength: frameCount,
		frameCount,
		chunkFrames,
		chunkCount: expectedChunkCount,
		overrideChunkCount: seenIndices.size,
		sampleRate: metadata.sampleRate ?? base.sampleRate,
		pcmEncodingVersion: database ? 1 : undefined,
		...compressionStatistics({ uncompressedBytes, storedBytes, wavpackChunkCount, rawChunkCount }),
		committedAt: new Date().toISOString(),
		pendingProjectUntil: new Date(Date.now() + PENDING_SOURCE_RETENTION_MS).toISOString(),
	};
	let definitelyRefused = false;
	try {
		const publication = await options.records.putDerivedMetadataIfBaseCurrent(
			record, base, materialize ? dependencies : undefined,
		);
		if (publication === 'target-exists') {
			definitelyRefused = true;
			throw new Error(`Immutable source ${sourceId} already exists and cannot be overwritten.`);
		}
		if (publication === 'base-changed') {
			definitelyRefused = true;
			throw new Error('The immutable base source changed or could not be found before derived source publication.');
		}
	} catch (error) {
		try {
			if (!definitelyRefused) await options.records.deleteMetadataIfCurrent(record);
			await options.records.deleteChunks(token);
		} catch (cleanupError) {
			throw cleanupFailure(error, cleanupError);
		}
		throw error;
	}
	return clone(record);
}

async function sourceDependencies(
	records: Pick<SourceRecordRepository, 'getMetadata'>,
	base: StorageRecord,
): Promise<StorageRecord[]> {
	const dependencies = [base];
	const seen = new Set<string>();
	let source = base;
	while (source.storage === 'copy-on-write') {
		if (!source.id || seen.has(source.id)) {
			throw new Error('The immutable source dependency graph contains a cycle.');
		}
		seen.add(source.id);
		if (!source.baseSourceId) throw new Error('A copy-on-write source has no immutable base source.');
		const parent = await records.getMetadata(source.baseSourceId);
		if (!parent) throw new Error(`Copy-on-write source dependency ${source.baseSourceId} is missing.`);
		if (parent.id !== source.baseSourceId) {
			throw new Error('Owned source metadata does not match its requested identity.');
		}
		source = parent;
		dependencies.push(source);
	}
	return dependencies;
}

function chunkRecord(
	token: string,
	index: number,
	frames: number,
	createdAt: number,
	stored: Awaited<ReturnType<PcmRepository['encode']>>,
): SourceChunkRecord {
	return {
		key: chunkKey(token, index), sourceToken: token, index, frames,
		encoding: stored.encoding, payload: stored.payload, pcmCrc32: stored.pcmCrc32, createdAt,
	};
}

function chunkKey(token: string, index: number): string {
	return `${token}:${String(index).padStart(10, '0')}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortGuard } from '../abort-error.ts';
import { mediaAssetChunkKey, mediaAssetChunkRecord, type MediaAssetChunkRecords } from './media-asset-chunk-records.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE, MEDIA_ASSET_STREAM_CHUNK_BYTES } from './media-asset-chunk-schema.ts';
import type { OpfsBinaryInspection } from './opfs-binary-inspection.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { StorageRecord } from './media-records.ts';

export type MediaAssetBinaryInspection = OpfsBinaryInspection | Readonly<{ status: 'missing'; reason: 'chunk' }>;
export interface MediaAssetBinaryInspectionPorts {
	readonly opfs: Pick<OpfsRepository, 'inspectBinaryRecord'>;
	readonly chunks: Pick<MediaAssetChunkRecords, 'chunks'>;
}

const throwIfAborted = createAbortGuard('Media binary inspection was cancelled.');

/** Open existing retained containers without flattening backend errors into absence or reading whole bodies. */
export async function inspectMediaAssetBinaryRecord(
	record: StorageRecord,
	ports: MediaAssetBinaryInspectionPorts,
	{ signal }: Readonly<{ signal?: AbortSignal }> = {},
): Promise<MediaAssetBinaryInspection> {
	throwIfAborted(signal);
	try {
		if (record.storage === 'opfs' || record.storage === 'indexeddb-blob') {
			const result = await ports.opfs.inspectBinaryRecord(record, { signal });
			throwIfAborted(signal);
			return result;
		}
		if (record.storage !== MEDIA_ASSET_CHUNK_STORAGE_TYPE) {
			throw new TypeError('Unsupported media binary storage layout for inspection.');
		}
		const result = await inspectChunks(record, ports, signal);
		throwIfAborted(signal);
		return result;
	} catch (error) {
		throwIfAborted(signal);
		throw error;
	}
}

async function inspectChunks(
	record: StorageRecord,
	ports: MediaAssetBinaryInspectionPorts,
	signal?: AbortSignal,
): Promise<MediaAssetBinaryInspection> {
	const { sourceId, mediaChunkToken: token, size: expectedBytes, mediaChunkCount: expectedChunks } = record;
	if (typeof sourceId !== 'string' || !sourceId
		|| typeof token !== 'string' || !token
		|| typeof expectedBytes !== 'number' || !Number.isSafeInteger(expectedBytes) || expectedBytes < 0
		|| typeof expectedChunks !== 'number' || !Number.isSafeInteger(expectedChunks) || expectedChunks < 0
		|| record.mediaChunkBytes !== MEDIA_ASSET_STREAM_CHUNK_BYTES
		|| expectedChunks !== Math.ceil(expectedBytes / MEDIA_ASSET_STREAM_CHUNK_BYTES)) throw malformed();
	const parts: Blob[] = [];
	let size = 0, index = 0;
	for await (const { primaryKey, value } of ports.chunks.chunks(token)) {
		throwIfAborted(signal);
		if (index >= expectedChunks) throw malformed();
		if (value === undefined) return Object.freeze({ status: 'missing', reason: 'chunk' });
		const chunk = mediaAssetChunkRecord(value);
		const expectedChunkBytes = Math.min(MEDIA_ASSET_STREAM_CHUNK_BYTES, expectedBytes - size);
		if (!chunk || primaryKey !== chunk.key || chunk.key !== mediaAssetChunkKey(token, index)
			|| chunk.sourceId !== sourceId || chunk.mediaChunkToken !== token || chunk.index !== index
			|| chunk.byteLength !== expectedChunkBytes || chunk.payload.size !== expectedChunkBytes) throw malformed();
		parts.push(chunk.payload);
		size += chunk.payload.size;
		index += 1;
	}
	throwIfAborted(signal);
	if (index !== expectedChunks || size !== expectedBytes) return Object.freeze({ status: 'missing', reason: 'chunk' });
	return Object.freeze({ status: 'present', body: new Blob(parts, { type: String(record.mimeType || '') }) });
}

function malformed(): TypeError { return new TypeError('Retained media chunk geometry or ownership is malformed.'); }

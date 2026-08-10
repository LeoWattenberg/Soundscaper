/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_CONTAINER_STORAGE_TYPE,
	PcmStorageCorruptionError,
	exactArrayBuffer,
	pcmRawByteLength,
} from '../wavpack/index.js';
import { trustedMediaContentSha256 } from './media-content-provenance.ts';

export interface StorageRecord {
	readonly id?: string;
	readonly sourceId?: string;
	readonly baseSourceId?: string | null;
	readonly sourceToken?: string | null;
	readonly mediaChunkToken?: string | null;
	readonly mediaContentDigestVersion?: number | null;
	readonly mediaContentToken?: string | null;
	readonly path?: string | null;
	readonly storage?: string;
	readonly pcmEncodingVersion?: number | null;
	readonly committedAt?: string;
	readonly pendingProjectUntil?: string;
	readonly blob?: unknown;
	readonly [field: string]: unknown;
}

export interface BlobLike {
	readonly size: number;
	readonly type?: string;
	slice(start?: number, end?: number, contentType?: string): BlobLike;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export interface SourceStorageCandidate {
	source: StorageRecord | null;
	mediaAsset: StorageRecord | null;
	readonly derivatives: StorageRecord[];
}

export function normalizeBlob(input: unknown): BlobLike {
	if (
		!input
		|| typeof input !== 'object'
		|| !('size' in input)
		|| typeof input.size !== 'number'
		|| !('slice' in input)
		|| typeof input.slice !== 'function'
		|| !('arrayBuffer' in input)
		|| typeof input.arrayBuffer !== 'function'
	) {
		throw new TypeError('A Blob or File is required.');
	}
	return input as BlobLike;
}

export function blobWithMimeType(blob: BlobLike, mimeType: unknown): BlobLike {
	const requestedType = String(mimeType || '');
	if (!requestedType || blob.type === requestedType) return blob;
	return blob.slice(0, blob.size, requestedType);
}

export function binaryMetadata(metadata: unknown): Record<string, unknown> {
	const value = metadata && typeof metadata === 'object'
		? cloneValue(metadata) as Record<string, unknown>
		: {};
	for (const key of [
		'key',
		'sourceId',
		'timestamp',
		'type',
		'storage',
		'path',
		'blob',
		'size',
		'mimeType',
		'committedAt',
		'pendingProjectUntil',
		'cacheToken',
		'sha256',
		'derivativeBindingVersion',
		'originalSha256',
		'originalMediaContentToken',
		'recipeId',
		'recipeVersion',
		'outputSha256',
		'sourceToken',
		'mediaChunkToken',
		'mediaChunkBytes',
		'mediaChunkCount',
		'mediaContentDigestVersion',
		'mediaContentToken',
	]) delete value[key];
	return value;
}

export function mediaAssetMetadata(record: StorageRecord): Record<string, unknown> {
	const trustedSha256 = trustedMediaContentSha256(record);
	const value = cloneValue(record) as Record<string, unknown>;
	delete value.blob;
	delete value.cacheToken;
	delete value.sourceToken;
	delete value.mediaChunkToken;
	delete value.mediaChunkBytes;
	delete value.mediaChunkCount;
	delete value.mediaContentDigestVersion;
	delete value.mediaContentToken;
	delete value.originalMediaContentToken;
	if (!trustedSha256) delete value.sha256;
	return value;
}

export const videoDerivativeMetadata = mediaAssetMetadata;

export function sourceStorageCandidates(
	sources: readonly StorageRecord[] = [],
	mediaAssets: readonly StorageRecord[] = [],
	videoDerivatives: readonly StorageRecord[] = [],
): Map<string, SourceStorageCandidate> {
	const candidates = new Map<string, SourceStorageCandidate>();
	const candidateFor = (sourceId: string): SourceStorageCandidate => {
		let candidate = candidates.get(sourceId);
		if (!candidate) {
			candidate = { source: null, mediaAsset: null, derivatives: [] };
			candidates.set(sourceId, candidate);
		}
		return candidate;
	};
	for (const source of sources) {
		if (source?.id) candidateFor(source.id).source = source;
	}
	for (const mediaAsset of mediaAssets) {
		if (mediaAsset?.sourceId) candidateFor(mediaAsset.sourceId).mediaAsset = mediaAsset;
	}
	for (const derivative of videoDerivatives) {
		if (derivative?.sourceId) candidateFor(derivative.sourceId).derivatives.push(derivative);
	}
	return candidates;
}

export function candidateEligibleAt(
	candidate: SourceStorageCandidate | null | undefined,
	minimumAgeMs: number,
): number {
	return Math.max(
		candidate?.source ? sourceEligibleAt(candidate.source, minimumAgeMs) : 0,
		candidate?.mediaAsset ? sourceEligibleAt(candidate.mediaAsset, minimumAgeMs) : 0,
		...(candidate?.derivatives || []).map((record) => sourceEligibleAt(record, minimumAgeMs)),
	);
}

export function normalizeChannels(input: unknown): Float32Array[] {
	if (!input || typeof input !== 'object' || !('length' in input) || typeof input.length !== 'number') return [];
	return Array.from(input as ArrayLike<unknown>, (channel) => (
		channel instanceof Float32Array
			? channel
			: Float32Array.from((channel || []) as ArrayLike<number>)
	));
}

export function protectSourceDependencies(
	protectedIds: Set<string>,
	sources: readonly StorageRecord[] = [],
): Set<string> {
	const byId = new Map(sources.filter((source) => source.id).map((source) => [source.id as string, source]));
	const pending = [...protectedIds];
	while (pending.length) {
		const source = byId.get(pending.pop() as string);
		if (!source?.baseSourceId || protectedIds.has(source.baseSourceId)) continue;
		protectedIds.add(source.baseSourceId);
		pending.push(source.baseSourceId);
	}
	return protectedIds;
}

export function sourceEligibleAt(source: StorageRecord, minimumAgeMs: number): number {
	const committedAt = Date.parse(source?.committedAt || '');
	const pendingProjectUntil = Date.parse(source?.pendingProjectUntil || '');
	return Math.max(
		Number.isFinite(committedAt) ? committedAt + minimumAgeMs : 0,
		Number.isFinite(pendingProjectUntil) ? pendingProjectUntil : 0,
	);
}

export function publishSource(source: StorageRecord): Record<string, unknown> {
	const published = { ...source };
	delete published.pendingProjectUntil;
	return published;
}

export function cloneChunk(record: Record<string, unknown>): Record<string, unknown> {
	const copy = { ...record };
	if (Array.isArray(record.channels)) {
		copy.channels = record.channels.map((buffer) => (
			buffer && typeof buffer === 'object' && 'slice' in buffer && typeof buffer.slice === 'function'
				? buffer.slice(0)
				: buffer
		));
	}
	if (record.payload instanceof ArrayBuffer) copy.payload = record.payload.slice(0);
	else if (ArrayBuffer.isView(record.payload)) {
		const payloadBuffer = new ArrayBuffer(record.payload.byteLength);
		const payload = new Uint8Array(payloadBuffer);
		payload.set(new Uint8Array(record.payload.buffer, record.payload.byteOffset, record.payload.byteLength));
		copy.payload = payloadBuffer;
	}
	return copy;
}

export function sourceChunkFromLegacyRecord(record: Record<string, unknown>): Readonly<{
	index: number;
	frames: number;
	channels: readonly Float32Array[];
}> {
	if (!Array.isArray(record?.channels) || !record.channels.length) {
		throw new PcmStorageCorruptionError('Legacy PCM record has no planar channels.', 'PCM_RECORD_GEOMETRY');
	}
	const frames = Number(record.frames);
	const index = Number(record.index);
	let channelBytes: number;
	try {
		channelBytes = pcmRawByteLength(frames, record.channels.length) / record.channels.length;
		if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('Legacy PCM chunk index is invalid.');
	} catch (error) {
		throw new PcmStorageCorruptionError(
			'Legacy PCM record has invalid geometry.',
			'PCM_RECORD_GEOMETRY',
			{ cause: error },
		);
	}
	const channels = record.channels.map((input) => {
		let buffer: ArrayBuffer;
		try {
			const payload = exactArrayBuffer(input);
			buffer = new ArrayBuffer(payload.byteLength);
			new Uint8Array(buffer).set(new Uint8Array(payload));
		} catch (error) {
			throw new PcmStorageCorruptionError(
				'Legacy PCM channel payload is invalid.',
				'PCM_RECORD_GEOMETRY',
				{ cause: error },
			);
		}
		if (buffer.byteLength !== channelBytes) {
			throw new PcmStorageCorruptionError(
				'Legacy PCM channel payload does not match its declared frame count.',
				'PCM_RECORD_GEOMETRY',
			);
		}
		return new Float32Array(buffer);
	});
	return { index, frames, channels };
}

export function isOpfsPcmStorage(storage: unknown): boolean {
	return storage === 'opfs' || storage === PCM_CONTAINER_STORAGE_TYPE;
}

export function sameStoredSourceIdentity(
	left: StorageRecord | null | undefined,
	right: StorageRecord | null | undefined,
): boolean {
	return Boolean(left && right
		&& left.id === right.id
		&& left.storage === right.storage
		&& (left.sourceToken || null) === (right.sourceToken || null)
		&& (left.path || null) === (right.path || null)
		&& (left.baseSourceId || null) === (right.baseSourceId || null)
		&& (left.pcmEncodingVersion ?? null) === (right.pcmEncodingVersion ?? null));
}

function cloneValue<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

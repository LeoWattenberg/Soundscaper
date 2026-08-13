/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import type { ScapeArchiveEntry } from '../common/editor/scape-archive-envelope.ts';
import type {
	ScapeVideoProxyArchiveAssetDescriptorV2,
	ScapeVideoProxyArchiveReferenceV2,
} from '../common/editor/scape-video-proxy-archive-plan-v2.ts';
import {
	digestMediaContent,
	MEDIA_CONTENT_DIGEST_CHUNK_BYTES,
} from '../common/editor/storage/media-content-digest.ts';
import type { OwnedMediaAssetWriter } from '../common/editor/storage/media-asset-write-contract.ts';
import type { VideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import {
	validateVideoTimingAssetBytes,
	type VideoTimingAssetReference,
} from '../common/editor/video-timing-asset.ts';
import type { FramescaperProjectV18 } from './editor-project-v18.ts';

const MAXIMUM_ENTRIES = 4_096;
const MAXIMUM_EXPANDED_BYTES = 64 * 1024 * 1024 * 1024;

export interface FramescaperScapeAttachedSourceV18 {
	readonly sourceId: string;
	readonly attachment: Readonly<VideoProxyAttachmentV18>;
}

export interface FramescaperScapeAttachmentInventoryV18 {
	readonly references: readonly Readonly<ScapeVideoProxyArchiveReferenceV2 | null>[];
	readonly timingByStorageKey: ReadonlyMap<string, Readonly<VideoTimingAssetReference>>;
	readonly attached: readonly FramescaperScapeAttachedSourceV18[];
}

export function framescaperScapeAttachmentInventoryV18(
	project: FramescaperProjectV18,
): Readonly<FramescaperScapeAttachmentInventoryV18> {
	const references: Readonly<ScapeVideoProxyArchiveReferenceV2 | null>[] = [];
	const timingByStorageKey = new Map<string, Readonly<VideoTimingAssetReference>>();
	const attached: FramescaperScapeAttachedSourceV18[] = [];
	for (const source of project.sources) {
		if (source.kind !== 'video') continue;
		const attachment = source.proxyAttachment;
		if (attachment === null) { references.push(null); continue; }
		references.push(Object.freeze({
			storageKey: attachment.storageKey,
			mimeType: attachment.mimeType,
			byteLength: attachment.byteLength,
			sha256: attachment.sha256,
			timingAsset: attachment.timingAsset,
		}));
		timingByStorageKey.set(attachment.timingAsset.storageKey, attachment.timingAsset);
		attached.push(Object.freeze({
			sourceId: framescaperScapePrintableIdentifierV18(source.id, 'attached source id'),
			attachment,
		}));
	}
	return Object.freeze({
		references: Object.freeze(references), timingByStorageKey,
		attached: Object.freeze(attached),
	});
}

export function assertFramescaperScapePreservedAttachmentsV18(
	origin: FramescaperProjectV18,
	target: FramescaperProjectV18,
): void {
	const bodies = (project: FramescaperProjectV18) => framescaperScapeAttachmentInventoryV18(project).attached
		.map(({ attachment }) => JSON.stringify(attachment)).sort();
	if (JSON.stringify(bodies(origin)) !== JSON.stringify(bodies(target))) {
		throw new Error('Archive copy or replacement cannot introduce, remove, or change an attachment.');
	}
}

export function indexFramescaperScapeBodyEntriesV18(
	value: unknown,
	descriptors: readonly Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>[],
): ReadonlyMap<string, ScapeArchiveEntry> {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > MAXIMUM_ENTRIES) throw new TypeError('V18 archive entries must be a bounded dense array.');
	const entries = new Map<string, ScapeArchiveEntry>();
	let expandedBytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const item = Object.getOwnPropertyDescriptor(value, String(index));
		if (!item?.enumerable || !Object.hasOwn(item, 'value')) throw new TypeError('V18 archive entries must be dense.');
		const entry = item.value as ScapeArchiveEntry;
		if (!entry || typeof entry !== 'object' || typeof entry.filename !== 'string'
			|| entries.has(entry.filename)) throw new Error('V18 archive entries have duplicate or invalid names.');
		if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0
			|| entry.uncompressedSize > MAXIMUM_EXPANDED_BYTES - expandedBytes) {
			throw new RangeError('The V18 archive exceeds its expanded-byte budget.');
		}
		expandedBytes += entry.uncompressedSize;
		entries.set(entry.filename, entry);
	}
	if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('V18 archive entries have extra fields.');
	for (const descriptor of descriptors) {
		const entry = entries.get(descriptor.entry);
		if (!entry) throw new Error(`The V18 archive is missing ${descriptor.entry}.`);
		if (entry.directory || entry.encrypted || entry.compressionMethod !== 0
			|| entry.compressedSize !== descriptor.size || entry.uncompressedSize !== descriptor.size
			|| typeof entry.getData !== 'function') {
			throw new Error(`The V18 archive body ${descriptor.entry} requires exact STORE geometry.`);
		}
	}
	return entries;
}

export async function extractFramescaperScapeBodyV18(
	entry: ScapeArchiveEntry,
	descriptor: Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>,
	timingByStorageKey: ReadonlyMap<string, Readonly<VideoTimingAssetReference>>,
	writer?: OwnedMediaAssetWriter,
	signal?: AbortSignal,
): Promise<void> {
	if (typeof entry.getData !== 'function') throw new Error(`The V18 archive is missing ${entry.filename}.`);
	const digest = sha256.create();
	const timingChunks: Uint8Array[] = [];
	let size = 0;
	const writable = new WritableStream<Uint8Array>({
		async write(chunk) {
			throwIfScapeAborted(signal);
			if (!(chunk instanceof Uint8Array)) throw new TypeError('V18 archive bodies must emit Uint8Array chunks.');
			if (chunk.byteLength > descriptor.size - size) throw new Error('A V18 archive body emitted excess bytes.');
			const snapshot = chunk.slice();
			digest.update(snapshot);
			size += snapshot.byteLength;
			if (descriptor.kind === 'video-timing') timingChunks.push(snapshot);
			if (writer) {
				for (let offset = 0; offset < snapshot.byteLength; offset += writer.maximumChunkBytes) {
					await writer.write(snapshot.subarray(offset, offset + writer.maximumChunkBytes), signal ? { signal } : {});
				}
			}
		},
	});
	await entry.getData(writable, { signal, strictness: 'strict' });
	throwIfScapeAborted(signal);
	if (size !== descriptor.size || size !== entry.uncompressedSize) {
		throw new Error('A V18 archive body emitted bytes that do not match its descriptor.');
	}
	if (bytesToHex(digest.digest()) !== descriptor.sha256) {
		throw new Error('A V18 archive body failed SHA-256 verification.');
	}
	const timing = timingByStorageKey.get(descriptor.sourceId);
	if (descriptor.kind === 'video-timing') {
		if (!timing) throw new Error('A V18 archive timing body has no exact attachment reference.');
		validateVideoTimingAssetBytes(timing, joinBytes(timingChunks, size));
	}
}

export async function verifyFramescaperScapeStoredBodyV18(
	body: Blob,
	descriptor: Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>,
	timingByStorageKey: ReadonlyMap<string, Readonly<VideoTimingAssetReference>>,
	signal?: AbortSignal,
): Promise<void> {
	if (body.size !== descriptor.size || await digestMediaContent(body, {
		chunkBytes: MEDIA_CONTENT_DIGEST_CHUNK_BYTES, ...(signal ? { signal } : {}),
	}) !== descriptor.sha256) throw new Error('A stored V18 archive body failed immutable verification.');
	if (descriptor.kind === 'video-timing') {
		const timing = timingByStorageKey.get(descriptor.sourceId);
		if (!timing) throw new Error('A stored timing body has no attachment reference.');
		validateVideoTimingAssetBytes(timing, new Uint8Array(await body.arrayBuffer()));
	}
}

export function assertFramescaperScapeStoredMetadataV18(
	value: unknown,
	descriptor: Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>,
): void {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A V18 archive body row is missing.');
	const row = value as Record<string, unknown>;
	if (row.sourceId !== descriptor.sourceId || row.kind !== descriptor.kind
		|| row.encoding !== descriptor.encoding || row.sha256 !== descriptor.sha256
		|| row.size !== descriptor.size || row.mimeType !== descriptor.mimeType) {
		throw new Error('A V18 archive body row has conflicting role or metadata.');
	}
}

export function assertFramescaperScapeOwnedWriterV18(
	value: unknown,
): asserts value is OwnedMediaAssetWriter {
	const writer = value as Partial<OwnedMediaAssetWriter> | null;
	if (!writer || typeof writer.write !== 'function' || typeof writer.commitOwned !== 'function'
		|| typeof writer.abort !== 'function' || !Number.isSafeInteger(writer.maximumChunkBytes)
		|| Number(writer.maximumChunkBytes) < 1 || Number(writer.maximumChunkBytes) > MEDIA_CONTENT_DIGEST_CHUNK_BYTES) {
		throw new TypeError('An exact bounded owned media writer is required.');
	}
}

export function framescaperScapeSourceOperationIdV18(operationId: string, index: number): string {
	const value = `${operationId}:${String(index)}`;
	if (value.length > 256) throw new RangeError('The source-scoped archive operation ID is too long.');
	return value;
}

export function framescaperScapeOperationIdentifierV18(value: unknown): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,240}$/u.test(value)) {
		throw new TypeError('A bounded printable V18 archive operation ID is required.');
	}
	return value;
}

export function framescaperScapeProjectIdentifierV18(project: FramescaperProjectV18): string {
	return framescaperScapePrintableIdentifierV18(project.id, 'project id');
}

export function framescaperScapeProjectRevisionV18(project: FramescaperProjectV18): number {
	if (!Number.isSafeInteger(project.revision) || Number(project.revision) < 0) {
		throw new RangeError('A non-negative V18 project revision is required.');
	}
	return Number(project.revision);
}

function framescaperScapePrintableIdentifierV18(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError(`A bounded printable ${name} is required.`);
	}
	return value;
}

function joinBytes(chunks: readonly Uint8Array[], size: number): Uint8Array {
	const output = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	return output;
}

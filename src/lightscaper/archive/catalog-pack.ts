/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { parseLightscaperDocumentV1, serializeLightscaperDocumentV1 } from '../catalog/documents.ts';
import { normalizePhotoDocumentV1 } from '../catalog/photo-document.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoDocumentV1 } from '../catalog/types.ts';
import { PhotoPackCursor } from './pack-cursor.ts';

const MAGIC = new TextEncoder().encode('LSCPACK1');
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const TEXT_ENCODER = new TextEncoder();

export const PHOTO_CATALOG_PACK_LIMITS_V1 = Object.freeze({
	maximumRecords: 4_096,
	maximumPackBytes: 512 * 1024 * 1024,
	maximumChunkBytes: 4 * 1024 * 1024,
});

export interface PhotoCatalogPackOptions {
	readonly signal?: AbortSignal;
	readonly maximumRecords?: number;
	readonly maximumPackBytes?: number;
	readonly maximumChunkBytes?: number;
}

export interface PhotoCatalogPackInput {
	readonly photo: PhotoDocumentV1;
	readonly original: Blob;
}

type PhotoCatalogPackLimits = Readonly<Record<keyof typeof PHOTO_CATALOG_PACK_LIMITS_V1, number>>;

/** Admit one record's fixed format bytes before opening its retained original. */
export function measurePhotoCatalogPackRecordV1(value: unknown): number {
	const photo = normalizePhotoDocumentV1(value);
	const size = 12 + TEXT_ENCODER.encode(serializeLightscaperDocumentV1(photo)).byteLength + photo.original.byteLength;
	if (!Number.isSafeInteger(size) || size + MAGIC.byteLength > PHOTO_CATALOG_PACK_LIMITS_V1.maximumPackBytes) {
		throw new RangeError('A photo original cannot fit the bounded archive pack.');
	}
	return size;
}

/**
 * Pack v1: ASCII LSCPACK1, then repeated little-endian u32 JSON length + u64
 * original length, canonical photo JSON, exact original bytes. No padding,
 * compression, preview pixels or depth conversion occurs. ZIP supplies the
 * outer pack digest; each original is independently authenticated here.
 */
export async function* encodePhotoCatalogPackV1(
	records: Iterable<PhotoCatalogPackInput> | AsyncIterable<PhotoCatalogPackInput>,
	options: PhotoCatalogPackOptions = {},
): AsyncGenerator<Uint8Array> {
	const limits = packLimits(options);
	const ids = new Set<string>();
	let total = MAGIC.byteLength;
	if (total > limits.maximumPackBytes) throw new RangeError('Photo pack exceeds its pack byte limit.');
	let catalogId: string | null = null;
	options.signal?.throwIfAborted();
	yield* splitBytes(MAGIC, limits.maximumChunkBytes);
	for await (const value of records) {
		options.signal?.throwIfAborted();
		const record = readClosedDomainRecord(value, 'photo pack input', ['photo', 'original']);
		const photo = normalizePhotoDocumentV1(readClosedDomainField(record, 'photo', 'photo pack input'));
		checkPhoto(photo, ids, limits.maximumRecords, catalogId); catalogId ??= photo.catalogId;
		const original = canonicalMediaContentBlob(readClosedDomainField(record, 'original', 'photo pack input'));
		if (original.size !== photo.original.byteLength) throw new RangeError('Photo pack original length differs from its reference.');
		const metadata = TEXT_ENCODER.encode(serializeLightscaperDocumentV1(photo));
		total += 12 + metadata.byteLength + original.size;
		if (!Number.isSafeInteger(total) || total > limits.maximumPackBytes) throw new RangeError('Photo pack exceeds its pack byte limit.');
		const header = new Uint8Array(12);
		const view = new DataView(header.buffer);
		view.setUint32(0, metadata.byteLength, true); view.setBigUint64(4, BigInt(original.size), true);
		yield* splitBytes(header, limits.maximumChunkBytes);
		yield* splitBytes(metadata, limits.maximumChunkBytes);
		const digest = sha256.create();
		for (let offset = 0; offset < original.size; offset += limits.maximumChunkBytes) {
			options.signal?.throwIfAborted();
			const bytes = new Uint8Array(await original.slice(offset, offset + limits.maximumChunkBytes).arrayBuffer());
			options.signal?.throwIfAborted(); digest.update(bytes); yield bytes;
		}
		if (bytesToHex(digest.digest()) !== photo.original.contentSha256) throw new Error('Photo pack original digest differs from its reference.');
	}
	options.signal?.throwIfAborted();
}

/**
 * The consumer must drain each original before returning. It owns provisional
 * media/row writes and must publish them only after this call and the enclosing
 * Scape manifest verification succeed; later failure requires rollback.
 * Retained input is one ≤4MiB chunk plus one ≤2MiB metadata document.
 */
export async function readPhotoCatalogPackV1(
	source: AsyncIterable<Uint8Array>,
	consume: (photo: PhotoDocumentV1, original: AsyncIterable<Uint8Array>) => Promise<void>,
	options: PhotoCatalogPackOptions = {},
): Promise<number> {
	const limits = packLimits(options);
	if (typeof consume !== 'function') throw new TypeError('A photo pack consumer is required.');
	const cursor = new PhotoPackCursor(source, limits.maximumPackBytes, limits.maximumChunkBytes, options.signal);
	const ids = new Set<string>();
	let catalogId: string | null = null;
	let failure: unknown;
	let failed = false;
	let cleanupFailure: unknown;
	let cleanupFailed = false;
	try {
		const magic = await cursor.exact(MAGIC.byteLength);
		if (!magic.every((value, index) => value === MAGIC[index])) throw new RangeError('Unsupported photo pack format.');
		while (await cursor.hasBytes()) {
			const header = await cursor.exact(12);
			const view = new DataView(header.buffer);
			const metadataBytes = view.getUint32(0, true);
			const originalBytes = view.getBigUint64(4, true);
			if (metadataBytes < 1 || metadataBytes > LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes) throw new RangeError('Photo pack metadata exceeds its document limit.');
			if (originalBytes < 1n || originalBytes + BigInt(cursor.consumedBytes + metadataBytes) > BigInt(limits.maximumPackBytes)) throw new RangeError('Photo pack original exceeds its pack byte limit.');
			const document = parseLightscaperDocumentV1(TEXT_DECODER.decode(await cursor.exact(metadataBytes)));
			if (document.kind !== 'photo') throw new TypeError('Photo pack records require photo documents.');
			checkPhoto(document, ids, limits.maximumRecords, catalogId); catalogId ??= document.catalogId;
			if (originalBytes !== BigInt(document.original.byteLength)) throw new RangeError('Photo pack original length differs from its reference.');
			let consumed = false;
			await consume(document, originalChunks(cursor, document, () => { consumed = true; }));
			if (!consumed) throw new Error('Photo pack consumer must completely consume each original.');
		}
	} catch (error) { failed = true; failure = error; }
	try { await cursor.close(); }
	catch (error) { cleanupFailed = true; cleanupFailure = error; }
	if (cleanupFailed) {
		if (failed) throw new AggregateError([failure, cleanupFailure], 'Photo pack read and cleanup both failed.', { cause: failure });
		throw cleanupFailure;
	}
	if (failed) throw failure;
	return ids.size;
}

async function* originalChunks(cursor: PhotoPackCursor, photo: PhotoDocumentV1, complete: () => void) {
	const digest = sha256.create();
	let remaining = photo.original.byteLength;
	while (remaining > 0) {
		const bytes = await cursor.take(remaining);
		digest.update(bytes); remaining -= bytes.byteLength; yield bytes;
	}
	if (bytesToHex(digest.digest()) !== photo.original.contentSha256) throw new Error('Photo pack original digest differs from its reference.');
	complete();
}

function checkPhoto(photo: PhotoDocumentV1, ids: Set<string>, maximum: number, catalogId: string | null): void {
	if (ids.has(photo.id)) throw new Error('Photo pack contains duplicate photo records.');
	if (ids.size >= maximum) throw new RangeError('Photo pack exceeds its record limit.');
	if (catalogId !== null && catalogId !== photo.catalogId) throw new Error('Photo pack contains records from different catalogs.');
	ids.add(photo.id);
}

function* splitBytes(bytes: Uint8Array, span: number) {
	for (let offset = 0; offset < bytes.byteLength; offset += span) yield bytes.subarray(offset, offset + span);
}

function packLimits(options: PhotoCatalogPackOptions): PhotoCatalogPackLimits {
	const record = readClosedDomainRecord(options, 'photo pack options', [...Object.keys(PHOTO_CATALOG_PACK_LIMITS_V1), 'signal'], []);
	const limits: Record<keyof PhotoCatalogPackLimits, number> = { ...PHOTO_CATALOG_PACK_LIMITS_V1 };
	for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
		if (!Object.hasOwn(record, key)) continue;
		const value = readClosedDomainField(record, key, 'photo pack options');
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > limits[key]) throw new RangeError('Photo pack limits must tighten the hard limits.');
		limits[key] = value;
	}
	return Object.freeze(limits);
}

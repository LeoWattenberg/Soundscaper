/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { parsePhotoDocumentV1OrV2, serializePhotoDocumentV1OrV2, normalizePhotoDocumentV1OrV2, type PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoDocumentV1 } from '../catalog/types.ts';
import { assertPhotoMaskRasterPortableV1 } from '../catalog/photo-mask-raster-portability-v1.ts';
import { photoPackByteView } from './pack-byte-chunk.ts';

const MAGIC = new TextEncoder().encode('LSCPACK2');
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const TEXT_ENCODER = new TextEncoder();
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

export const PHOTO_CATALOG_PACK_LIMITS_V2 = Object.freeze({
	maximumRecords: 4_096,
	maximumPackBytes: 512 * 1024 * 1024,
	maximumChunkBytes: 4 * 1024 * 1024,
});

export interface PhotoCatalogPackOptionsV2 {
	readonly signal?: AbortSignal;
	readonly maximumRecords?: number;
	readonly maximumPackBytes?: number;
	readonly maximumChunkBytes?: number;
}

export interface PhotoCatalogPackInputV2 {
	readonly photo: PhotoDocumentV1 | PhotoDocumentV2;
	readonly original: Blob;
}

type PhotoCatalogPackLimits = Readonly<Record<keyof typeof PHOTO_CATALOG_PACK_LIMITS_V2, number>>;

/** Admit one record's fixed format bytes before opening its retained original. */
export function measurePhotoCatalogPackRecordV2(value: unknown): number {
	const photo = normalizePhotoDocumentV1OrV2(value);
	assertPhotoMaskRasterPortableV1(photo);
	const size = 12 + TEXT_ENCODER.encode(serializePhotoDocumentV1OrV2(photo)).byteLength + photo.original.byteLength;
	if (!Number.isSafeInteger(size) || size + MAGIC.byteLength > PHOTO_CATALOG_PACK_LIMITS_V2.maximumPackBytes) {
		throw new RangeError('A photo original cannot fit the bounded archive pack.');
	}
	return size;
}

/**
 * Pack v2: ASCII LSCPACK2, then repeated little-endian u32 JSON length + u64
 * original length, canonical photo JSON, exact original bytes. No padding,
 * compression, preview pixels or depth conversion occurs. ZIP supplies the
 * outer pack digest; each original is independently authenticated here.
 */
export async function* encodePhotoCatalogPackV2(
	records: Iterable<PhotoCatalogPackInputV2> | AsyncIterable<PhotoCatalogPackInputV2>,
	options: PhotoCatalogPackOptionsV2 = {},
): AsyncGenerator<Uint8Array> {
	const limits = packLimits(options);
	const ids = new Set<string>();
	let total = MAGIC.byteLength;
	if (total > limits.maximumPackBytes) throw new RangeError('Photo pack exceeds its pack byte limit.');
	let catalogId: string | null = null;
	check(options.signal);
	yield* splitBytes(MAGIC, limits.maximumChunkBytes);
	for await (const value of records) {
		check(options.signal);
		const record = readClosedDomainRecord(value, 'photo pack input', ['photo', 'original']);
		const photo = normalizePhotoDocumentV1OrV2(readClosedDomainField(record, 'photo', 'photo pack input'));
		assertPhotoMaskRasterPortableV1(photo);
		checkPhoto(photo, ids, limits.maximumRecords, catalogId); catalogId ??= photo.catalogId;
		const original = canonicalMediaContentBlob(readClosedDomainField(record, 'original', 'photo pack input'));
		if (original.size !== photo.original.byteLength) throw new RangeError('Photo pack original length differs from its reference.');
		const metadata = TEXT_ENCODER.encode(serializePhotoDocumentV1OrV2(photo));
		total += 12 + metadata.byteLength + original.size;
		if (!Number.isSafeInteger(total) || total > limits.maximumPackBytes) throw new RangeError('Photo pack exceeds its pack byte limit.');
		const header = new Uint8Array(12);
		const view = new DataView(header.buffer);
		view.setUint32(0, metadata.byteLength, true); view.setBigUint64(4, BigInt(original.size), true);
		yield* splitBytes(header, limits.maximumChunkBytes);
		yield* splitBytes(metadata, limits.maximumChunkBytes);
		const digest = sha256.create();
		for (let offset = 0; offset < original.size; offset += limits.maximumChunkBytes) {
			check(options.signal);
			const bytes = new Uint8Array(await original.slice(offset, offset + limits.maximumChunkBytes).arrayBuffer());
			check(options.signal); digest.update(bytes); yield bytes;
		}
		if (bytesToHex(digest.digest()) !== photo.original.contentSha256) throw new Error('Photo pack original digest differs from its reference.');
	}
	check(options.signal);
}

/**
 * The consumer must drain each original before returning. It owns provisional
 * media/row writes and must publish them only after this call and the enclosing
 * Scape manifest verification succeed; later failure requires rollback.
 * Retained input is one ≤4MiB chunk plus one ≤2MiB metadata document.
 */
export async function readPhotoCatalogPackV2(
	source: AsyncIterable<Uint8Array>,
	consume: (photo: PhotoDocumentV1 | PhotoDocumentV2, original: AsyncIterable<Uint8Array>) => Promise<void>,
	options: PhotoCatalogPackOptionsV2 = {},
): Promise<number> {
	const limits = packLimits(options);
	if (typeof consume !== 'function') throw new TypeError('A photo pack consumer is required.');
	check(options.signal);
	const cursor = new PhotoPackCursorV2(source, limits.maximumPackBytes, limits.maximumChunkBytes, options.signal);
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
			const document = parsePhotoDocumentV1OrV2(TEXT_DECODER.decode(await cursor.exact(metadataBytes)));
			if (document.kind !== 'photo') throw new TypeError('Photo pack records require photo documents.');
			assertPhotoMaskRasterPortableV1(document);
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
	check(options.signal);
	return ids.size;
}

async function* originalChunks(cursor: PhotoPackCursorV2, photo: PhotoDocumentV1 | PhotoDocumentV2, complete: () => void) {
	const digest = sha256.create();
	let remaining = photo.original.byteLength;
	while (remaining > 0) {
		const bytes = await cursor.take(remaining);
		digest.update(bytes); remaining -= bytes.byteLength; yield bytes;
	}
	if (bytesToHex(digest.digest()) !== photo.original.contentSha256) throw new Error('Photo pack original digest differs from its reference.');
	complete();
}

function checkPhoto(photo: PhotoDocumentV1 | PhotoDocumentV2, ids: Set<string>, maximum: number, catalogId: string | null): void {
	if (ids.has(photo.id)) throw new Error('Photo pack contains duplicate photo records.');
	if (ids.size >= maximum) throw new RangeError('Photo pack exceeds its record limit.');
	if (catalogId !== null && catalogId !== photo.catalogId) throw new Error('Photo pack contains records from different catalogs.');
	ids.add(photo.id);
}

function* splitBytes(bytes: Uint8Array, span: number) {
	for (let offset = 0; offset < bytes.byteLength; offset += span) yield bytes.subarray(offset, offset + span);
}

function packLimits(options: PhotoCatalogPackOptionsV2): PhotoCatalogPackLimits {
	const record = readClosedDomainRecord(options, 'photo pack options', [...Object.keys(PHOTO_CATALOG_PACK_LIMITS_V2), 'signal'], []);
	const limits: Record<keyof PhotoCatalogPackLimits, number> = { ...PHOTO_CATALOG_PACK_LIMITS_V2 };
	for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
		if (!Object.hasOwn(record, key)) continue;
		const value = readClosedDomainField(record, key, 'photo pack options');
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > limits[key]) throw new RangeError('Photo pack limits must tighten the hard limits.');
		limits[key] = value;
	}
	return Object.freeze(limits);
}

/** Captured producer methods and intrinsic cancellation protect every await.
 * One borrowed native chunk survives; exact reads allocate only bounded header
 * or admitted metadata bytes. Closing joins the captured producer retirement. */
class PhotoPackCursorV2 {
	readonly #next: () => Promise<IteratorResult<Uint8Array>>;
	readonly #leave: (() => Promise<IteratorResult<Uint8Array>>) | undefined;
	#chunk: Uint8Array = new Uint8Array();
	#offset = 0;
	#received = 0;
	#done = false;
	#closing: Promise<void> | null = null;
	consumedBytes = 0;
	constructor(source: AsyncIterable<Uint8Array>, readonly maximumBytes: number,
		readonly maximumChunkBytes: number, readonly signal?: AbortSignal) {
		check(signal);
		const iterate = source?.[Symbol.asyncIterator];
		if (typeof iterate !== 'function') throw new TypeError('Photo pack requires an asynchronous byte source.');
		const iterator = Reflect.apply(iterate, source, []) as AsyncIterator<Uint8Array>, next = iterator.next, leave = iterator.return;
		if (typeof next !== 'function' || (leave !== undefined && typeof leave !== 'function')) throw new TypeError('Photo pack requires native iterator methods.');
		this.#next = () => Reflect.apply(next, iterator, []) as Promise<IteratorResult<Uint8Array>>;
		this.#leave = leave === undefined ? undefined : () => Reflect.apply(leave, iterator, []) as Promise<IteratorResult<Uint8Array>>;
	}
	async hasBytes(): Promise<boolean> {
		check(this.signal);
		if (this.#offset < this.#chunk.byteLength) return true;
		if (this.#done) return false;
		const next = await this.#next(); check(this.signal);
		if (next.done) { this.#done = true; this.#chunk = new Uint8Array(); return false; }
		const chunk = photoPackByteView(next.value);
		if (chunk.byteLength < 1 || chunk.byteLength > this.maximumChunkBytes) throw new RangeError('Photo pack source chunk exceeds its bounded chunk limit.');
		if (chunk.byteLength > this.maximumBytes - this.#received) throw new RangeError('Photo pack exceeds its pack byte limit.');
		this.#received += chunk.byteLength; this.#chunk = chunk; this.#offset = 0; return true;
	}
	async take(maximum: number): Promise<Uint8Array> {
		if (!await this.hasBytes()) throw new RangeError('Photo pack record is truncated.');
		const length = Math.min(maximum, this.#chunk.byteLength - this.#offset), result = this.#chunk.subarray(this.#offset, this.#offset + length);
		this.#offset += length; this.consumedBytes += length; return result;
	}
	async exact(length: number): Promise<Uint8Array<ArrayBuffer>> {
		const result = new Uint8Array(length); let offset = 0;
		while (offset < length) { const chunk = await this.take(length - offset); result.set(chunk, offset); offset += chunk.byteLength; }
		return result;
	}
	close(): Promise<void> {
		this.#closing ??= (async () => { this.#chunk = new Uint8Array(); if (!this.#done) await this.#leave?.(); this.#done = true; })();
		return this.#closing;
	}
}

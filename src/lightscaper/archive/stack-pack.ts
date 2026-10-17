/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { normalizePhotoStackV1, serializePhotoStackV1, type PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import { PhotoPackCursor } from './pack-cursor.ts';

const MAGIC = new TextEncoder().encode('LSSTACK1');
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });

export const PHOTO_STACK_PACK_LIMITS_V1 = Object.freeze({
	maximumRecordBytes: 256 * 1024, maximumRecords: 1_024,
	maximumPackBytes: 8 * 1024 * 1024, maximumChunkBytes: 4 * 1024 * 1024,
});
type Limits = Readonly<Record<keyof typeof PHOTO_STACK_PACK_LIMITS_V1, number>>;
export interface PhotoStackPackOptions extends Partial<Limits> { readonly signal?: AbortSignal }

export function measurePhotoStackPackRecordV1(value: unknown): number {
	const length = ENCODER.encode(serializePhotoStackV1(value)).byteLength;
	if (length < 1 || length > PHOTO_STACK_PACK_LIMITS_V1.maximumRecordBytes) throw new RangeError('Stack pack record exceeds its byte limit.');
	return 4 + length;
}

/** LSSTACK1 followed by little-endian u32 JSON length and canonical closed stack-v1 JSON. */
export async function* encodePhotoStackPackV1(records: Iterable<PhotoStackV1> | AsyncIterable<PhotoStackV1>,
	options: PhotoStackPackOptions = {}): AsyncGenerator<Uint8Array> {
	const limits = resolveLimits(options), ids = new Set<string>();
	let catalogId: string | null = null, size = MAGIC.byteLength;
	if (size > limits.maximumPackBytes) throw new RangeError('Stack pack exceeds its pack byte limit.');
	options.signal?.throwIfAborted(); yield* chunks(MAGIC, limits.maximumChunkBytes);
	for await (const input of records) {
		options.signal?.throwIfAborted(); const stack = normalizePhotoStackV1(input);
		catalogId = admit(stack, ids, catalogId, limits.maximumRecords);
		const metadata = ENCODER.encode(serializePhotoStackV1(stack));
		if (metadata.byteLength > limits.maximumRecordBytes) throw new RangeError('Stack pack record exceeds its byte limit.');
		size += 4 + metadata.byteLength;
		if (size > limits.maximumPackBytes) throw new RangeError('Stack pack exceeds its pack byte limit.');
		const header = new Uint8Array(4); new DataView(header.buffer).setUint32(0, metadata.byteLength, true);
		yield* chunks(header, limits.maximumChunkBytes); yield* chunks(metadata, limits.maximumChunkBytes);
	}
	options.signal?.throwIfAborted();
}

export async function readPhotoStackPackV1(source: AsyncIterable<Uint8Array>, consume: (stack: PhotoStackV1) => Promise<void>,
	options: PhotoStackPackOptions = {}): Promise<number> {
	const limits = resolveLimits(options), ids = new Set<string>();
	if (typeof consume !== 'function') throw new TypeError('A provisional stack pack consumer is required.');
	const cursor = new PhotoPackCursor(source, limits.maximumPackBytes, limits.maximumChunkBytes, options.signal);
	let catalogId: string | null = null, failure: unknown, failed = false;
	try {
		const magic = await cursor.exact(MAGIC.byteLength);
		if (!magic.every((byte, index) => byte === MAGIC[index])) throw new RangeError('Unsupported stack pack format.');
		while (await cursor.hasBytes()) {
			const header = await cursor.exact(4), length = new DataView(header.buffer).getUint32(0, true);
			if (length < 1 || length > limits.maximumRecordBytes) throw new RangeError('Stack pack record exceeds its byte limit.');
			const stack = normalizePhotoStackV1(JSON.parse(DECODER.decode(await cursor.exact(length))) as unknown);
			catalogId = admit(stack, ids, catalogId, limits.maximumRecords); await consume(stack);
			options.signal?.throwIfAborted();
		}
	} catch (error) { failed = true; failure = error; }
	let cleanupFailure: unknown, cleanupFailed = false;
	try { await cursor.close(); } catch (cleanup) { cleanupFailed = true; cleanupFailure = cleanup; }
	if (cleanupFailed) {
		if (failed) throw new AggregateError([failure, cleanupFailure], 'Stack pack read and cleanup both failed.', { cause: failure });
		throw cleanupFailure;
	}
	if (failed) throw failure; return ids.size;
}

function admit(stack: PhotoStackV1, ids: Set<string>, catalogId: string | null, maximum: number): string {
	if (ids.has(stack.id)) throw new RangeError('Stack pack contains duplicate stack identities.');
	if (ids.size >= maximum) throw new RangeError('Stack pack exceeds its record limit.');
	if (catalogId !== null && catalogId !== stack.catalogId) throw new RangeError('Stack pack contains different catalogs.');
	ids.add(stack.id); return stack.catalogId;
}
function* chunks(bytes: Uint8Array, span: number) {
	for (let offset = 0; offset < bytes.byteLength; offset += span) yield bytes.subarray(offset, offset + span);
}
function resolveLimits(options: PhotoStackPackOptions): Limits {
	const input = readClosedDomainRecord(options, 'stack pack options', [...Object.keys(PHOTO_STACK_PACK_LIMITS_V1), 'signal'], []);
	const limits: Record<keyof Limits, number> = { ...PHOTO_STACK_PACK_LIMITS_V1 };
	for (const key of Object.keys(limits) as (keyof Limits)[]) {
		if (!Object.hasOwn(input, key)) continue; const value = readClosedDomainField(input, key, 'stack pack options');
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > limits[key]) throw new RangeError('Stack pack limits must tighten hard maxima.');
		limits[key] = value;
	}
	return Object.freeze(limits);
}

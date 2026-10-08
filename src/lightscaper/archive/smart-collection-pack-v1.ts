/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { normalizePhotoSmartCollectionV1, PHOTO_SMART_COLLECTION_LIMITS_V1,
	type PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { PhotoPackCursor } from './pack-cursor.ts';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const MAGIC = ENCODER.encode('LSSMART1');
const nativeThrow = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const nativeAdd = EventTarget.prototype.addEventListener;
const nativeRemove = EventTarget.prototype.removeEventListener;
const NativeAbortController = AbortController;
const nativeAbort = NativeAbortController.prototype.abort;
const completeDefinitions = new WeakSet<object>();

export const PHOTO_SMART_COLLECTION_PACK_LIMITS_V1 = Object.freeze({
	maximumRecordBytes: PHOTO_SMART_COLLECTION_LIMITS_V1.maximumDocumentBytes, maximumRecords: 64,
	maximumPackBytes: 8 * 1024 * 1024, maximumChunkBytes: 4 * 1024 * 1024,
});
type Limits = Readonly<Record<keyof typeof PHOTO_SMART_COLLECTION_PACK_LIMITS_V1, number>>;
export interface PhotoSmartCollectionPackOptionsV1 extends Partial<Limits> { readonly signal?: AbortSignal }

/** One complete immutable recipe and its scalar framed size; no serialized metadata survives preparation. */
export function preparePhotoSmartCollectionPackRecordV1(value: unknown): Readonly<{ definition: PhotoSmartCollectionV1; byteLength: number }> {
	const prepared = metadataBytes(value, PHOTO_SMART_COLLECTION_PACK_LIMITS_V1.maximumRecordBytes);
	return Object.freeze({ definition: prepared.definition, byteLength: 4 + prepared.bytes.byteLength });
}

/** Framing bytes plus one admitted complete saved recipe, never its private database projection. */
export function measurePhotoSmartCollectionPackRecordV1(value: unknown): number {
	return 4 + metadataBytes(value, PHOTO_SMART_COLLECTION_PACK_LIMITS_V1.maximumRecordBytes).bytes.byteLength;
}

/** LSSMART1 + little-endian u32 length + canonical saved-definition JSON. */
export async function* encodePhotoSmartCollectionPackV1(records: Iterable<PhotoSmartCollectionV1> | AsyncIterable<PhotoSmartCollectionV1>,
	options: PhotoSmartCollectionPackOptionsV1 = {}): AsyncGenerator<Uint8Array> {
	const { limits, signal } = resolveOptions(options), cancellation = privateCancellation(signal), ids = new Set<string>();
	let iterator: AsyncIterator<PhotoSmartCollectionV1> | Iterator<PhotoSmartCollectionV1> | undefined;
	let done = false, failed = false, failure: unknown, catalogId: string | null = null, size = MAGIC.byteLength;
	try {
		if (size > limits.maximumPackBytes) throw new RangeError('Smart collection pack exceeds its pack byte limit.');
		cancellation.check(); yield* chunks(new Uint8Array(MAGIC), limits.maximumChunkBytes, cancellation.check);
		iterator = Symbol.asyncIterator in records ? records[Symbol.asyncIterator]() : records[Symbol.iterator]();
		while (true) {
			cancellation.check(); const next = await iterator.next(); cancellation.check();
			if (next.done) { done = true; break; }
			const { definition, bytes } = metadataBytes(next.value, limits.maximumRecordBytes);
			catalogId = admit(definition, ids, catalogId, limits.maximumRecords);
			size += 4 + bytes.byteLength;
			if (size > limits.maximumPackBytes) throw new RangeError('Smart collection pack exceeds its pack byte limit.');
			const header = new Uint8Array(4); new DataView(header.buffer).setUint32(0, bytes.byteLength, true);
			yield* chunks(header, limits.maximumChunkBytes, cancellation.check);
			yield* chunks(bytes, limits.maximumChunkBytes, cancellation.check);
		}
	} catch (error) { failed = true; failure = error; }
	finally {
		let cleanupFailed = false, cleanupFailure: unknown;
		try { if (iterator && !done) await iterator.return?.(); } catch (error) { cleanupFailed = true; cleanupFailure = error; }
		if (!failed) { try { cancellation.check(); } catch (error) { failed = true; failure = error; } }
		cancellation.close(); rethrowCleanup(failed, failure, cleanupFailed, cleanupFailure);
	}
	if (failed) throw failure;
}

/**
 * One <=528384-byte canonical recipe is staged and released before borrowing the next.
 * Decoding additionally owns one bounded input chunk and the current UTF8/JSON material;
 * no private row, parallel query serialization, or aggregate recipe array is constructed.
 * The consumer owns provisional publication and must roll back after any later failure.
 */
export async function readPhotoSmartCollectionPackV1(source: AsyncIterable<Uint8Array>,
	consume: (definition: PhotoSmartCollectionV1) => Promise<void>, options: PhotoSmartCollectionPackOptionsV1 = {}): Promise<number> {
	const { limits, signal } = resolveOptions(options);
	if (typeof consume !== 'function') throw new TypeError('A provisional smart collection pack consumer is required.');
	const cancellation = privateCancellation(signal), ids = new Set<string>();
	let cursor: PhotoPackCursor | undefined, failed = false, failure: unknown, catalogId: string | null = null;
	try {
		cursor = new PhotoPackCursor(source, limits.maximumPackBytes, limits.maximumChunkBytes, cancellation.signal);
		const magic = await cursor.exact(MAGIC.byteLength);
		if (!magic.every((byte, index) => byte === MAGIC[index])) throw new RangeError('Unsupported smart collection pack format.');
		while (await cursor.hasBytes()) {
			const header = await cursor.exact(4), length = new DataView(header.buffer).getUint32(0, true);
			if (length < 1 || length > limits.maximumRecordBytes) throw new RangeError('Smart collection pack record exceeds its byte limit.');
			const definition = canonicalDefinition(await cursor.exact(length));
			catalogId = admit(definition, ids, catalogId, limits.maximumRecords);
			cancellation.check(); await consume(definition); cancellation.check();
		}
	} catch (error) { failed = true; failure = error; }
	let cleanupFailed = false, cleanupFailure: unknown;
	try { await cursor?.close(); } catch (error) { cleanupFailed = true; cleanupFailure = error; }
	if (!failed) { try { cancellation.check(); } catch (error) { failed = true; failure = error; } }
	cancellation.close(); rethrowCleanup(failed, failure, cleanupFailed, cleanupFailure);
	if (failed) throw failure; return ids.size;
}

function metadataBytes(value: unknown, maximum: number) {
	const definition = completeDefinition(value), bytes = ENCODER.encode(JSON.stringify(definition));
	if (bytes.byteLength < 1 || bytes.byteLength > maximum) throw new RangeError('Smart collection pack record exceeds its byte limit.');
	return { definition, bytes };
}
function completeDefinition(value: unknown): PhotoSmartCollectionV1 {
	if (value !== null && typeof value === 'object' && completeDefinitions.has(value)) return value as PhotoSmartCollectionV1;
	const input = readClosedDomainRecord(value, 'smart collection pack definition',
		['schemaVersion', 'kind', 'catalogId', 'id', 'revision', 'name', 'query']);
	if (readClosedDomainField(input, 'schemaVersion', 'smart collection pack definition') !== 1) throw new RangeError('Unsupported or future smart collection pack definition version.');
	if (readClosedDomainField(input, 'kind', 'smart collection pack definition') !== 'photo-smart-collection') throw new TypeError('Smart collection pack records require their own document kind.');
	const query = readClosedDomainRecord(readClosedDomainField(input, 'query', 'smart collection pack definition'),
		'complete saved query', ['schemaVersion', 'kind', 'text', 'filter', 'sort', 'predicate']);
	for (const key of ['schemaVersion', 'kind', 'text', 'filter', 'sort', 'predicate']) {
		if (readClosedDomainField(query, key, 'complete saved query') === undefined) throw new TypeError('Saved pack queries require explicit complete fields.');
	}
	const definition = normalizePhotoSmartCollectionV1(value); completeDefinitions.add(definition); return definition;
}
/** Release framing/text/parsed input before awaiting the one normalized recipe consumer. */
function canonicalDefinition(bytes: Uint8Array): PhotoSmartCollectionV1 {
	const text = DECODER.decode(bytes), definition = completeDefinition(JSON.parse(text) as unknown);
	if (JSON.stringify(definition) !== text) throw new RangeError('Smart collection pack records require exact canonical JSON bytes.');
	return definition;
}
function admit(definition: PhotoSmartCollectionV1, ids: Set<string>, catalogId: string | null, maximum: number): string {
	if (ids.has(definition.id)) throw new RangeError('Smart collection pack contains duplicate saved identities.');
	if (ids.size >= maximum) throw new RangeError('Smart collection pack exceeds its record limit.');
	if (catalogId !== null && catalogId !== definition.catalogId) throw new RangeError('Smart collection pack contains different catalogs.');
	ids.add(definition.id); return definition.catalogId;
}
function* chunks(bytes: Uint8Array, span: number, check: () => void) {
	for (let offset = 0; offset < bytes.byteLength; offset += span) { check(); yield bytes.subarray(offset, offset + span); }
	check();
}
function rethrowCleanup(failed: boolean, failure: unknown, cleanupFailed: boolean, cleanupFailure: unknown): void {
	if (!cleanupFailed) return;
	if (failed) throw new AggregateError([failure, cleanupFailure], 'Smart collection pack operation and cleanup both failed.', { cause: failure });
	throw cleanupFailure;
}
function resolveOptions(options: PhotoSmartCollectionPackOptionsV1): Readonly<{ limits: Limits; signal?: AbortSignal }> {
	const input = readClosedDomainRecord(options, 'smart collection pack options', [...Object.keys(PHOTO_SMART_COLLECTION_PACK_LIMITS_V1), 'signal'], []);
	const limits: Record<keyof Limits, number> = { ...PHOTO_SMART_COLLECTION_PACK_LIMITS_V1 };
	for (const key of Object.keys(limits) as (keyof Limits)[]) {
		if (!Object.hasOwn(input, key)) continue; const value = readClosedDomainField(input, key, 'smart collection pack options');
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > limits[key]) throw new RangeError('Smart collection pack limits must tighten hard maxima.');
		limits[key] = value;
	}
	const signal = Object.hasOwn(input, 'signal') ? readClosedDomainField(input, 'signal', 'smart collection pack options') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	return Object.freeze({ limits: Object.freeze(limits), ...(signal === undefined ? {} : { signal }) });
}
function privateCancellation(signal: AbortSignal | undefined) {
	if (signal === undefined) return { signal, check() {}, close() {} };
	const stop = new NativeAbortController();
	const forward = (): void => { Reflect.apply(nativeAbort, stop, [Reflect.apply(nativeReason, signal, [])]); };
	const check = (): void => { Reflect.apply(nativeThrow, stop.signal, []); };
	Reflect.apply(nativeAdd, signal, ['abort', forward, { once: true }]);
	if (Reflect.apply(nativeAborted, signal, []) === true) forward();
	return { signal: stop.signal, check, close(): void { Reflect.apply(nativeRemove, signal, ['abort', forward]); } };
}

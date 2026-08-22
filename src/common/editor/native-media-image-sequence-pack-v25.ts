/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import type {
	NativeMediaImageSequenceInventoryEntryV25,
	NativeMediaImageSequenceInventoryReferenceV25,
	NativeMediaImageSequenceSourcePackReferenceV25,
} from './native-media-image-sequence-v25.ts';
import type { NativeMediaImageSequenceRateV1 } from './native-media-image-sequence.ts';

export const NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_VERSION = 1 as const;
export const NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES = 128;
export const NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_INDEX_BYTES = 64;
export const NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES = 16 * 1024 * 1024;
export const NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES = 512 * 1024 * 1024;
export const NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PACK_BYTES = 16 * 1024 * 1024 * 1024 * 1024;

const UTF8 = new TextEncoder();
const MAGIC = UTF8.encode('FSISPK01');
const MAXIMUM_FRAMES = 2_000_000;
const MAXIMUM_RATE_TERM = 1_000_000;
const MAXIMUM_INVENTORY_BYTES = 512 * 1024 * 1024;
const SHA256 = /^[a-f\d]{64}$/u;
const PACK_KEYS = Object.freeze(['kind', 'storageKey', 'sha256', 'byteLength']);
const INVENTORY_KEYS = Object.freeze([
	'kind', 'version', 'storageKey', 'sha256', 'byteLength', 'frameCount',
	'firstFrameNumber', 'lastFrameNumber',
]);
const ENTRY_KEYS = Object.freeze(['fileName', 'frameNumber', 'byteLength', 'sha256']);
const RATE_KEYS = Object.freeze(['num', 'den']);

type Awaitable<Value> = Value | PromiseLike<Value>;

export interface CreateNativeMediaImageSequenceSourcePackRequestV25 {
	readonly inventory: NativeMediaImageSequenceInventoryReferenceV25;
	readonly entries: readonly NativeMediaImageSequenceInventoryEntryV25[];
	readonly frameRate: NativeMediaImageSequenceRateV1;
	readonly frameChunks: (
		index: number,
		entry: NativeMediaImageSequenceInventoryEntryV25,
	) => Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
	readonly write: (chunk: Uint8Array) => Awaitable<void>;
	readonly signal?: AbortSignal;
}

export interface ValidateNativeMediaImageSequenceSourcePackRequestV25 {
	readonly reference: NativeMediaImageSequenceSourcePackReferenceV25;
	readonly inventory: NativeMediaImageSequenceInventoryReferenceV25;
	readonly entries: readonly NativeMediaImageSequenceInventoryEntryV25[];
	readonly frameRate: NativeMediaImageSequenceRateV1;
	readonly read: (offset: number, length: number) => Awaitable<Uint8Array>;
	readonly assertCurrent?: () => Awaitable<void>;
	readonly signal?: AbortSignal;
}

export interface NativeMediaImageSequenceSourcePackReaderV25 {
	readonly version: 1;
	readonly frameCount: number;
	readonly frameRate: NativeMediaImageSequenceRateV1;
	readFrame(
		index: number,
		write: (chunk: Uint8Array) => Awaitable<void>,
		signal?: AbortSignal,
	): Promise<void>;
}

export class NativeMediaImageSequenceSourcePackV25Error extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'NativeMediaImageSequenceSourcePackV25Error';
	}
}

/** Stream a deterministic pack to temporary storage and return its commit identity. */
export async function createNativeMediaImageSequenceSourcePackV25(
	request: CreateNativeMediaImageSequenceSourcePackRequestV25,
): Promise<NativeMediaImageSequenceSourcePackReferenceV25> {
	const inventory = normalizeInventory(request.inventory);
	const entries = normalizeEntries(request.entries, inventory);
	const frameRate = normalizeRate(request.frameRate);
	if (typeof request.frameChunks !== 'function' || typeof request.write !== 'function') {
		throw new NativeMediaImageSequenceSourcePackV25Error('A source-pack creator requires exact streaming ports.');
	}
	const payloadOffset = checkedAdd(
		NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES,
		checkedMultiply(entries.length, NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_INDEX_BYTES, 'index'),
		'payload offset',
	);
	let totalBytes = payloadOffset;
	for (const entry of entries) {
		if (entry.byteLength > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES) {
			throw new NativeMediaImageSequenceSourcePackV25Error('An image-sequence frame exceeds its byte ceiling.');
		}
		totalBytes = checkedAdd(totalBytes, entry.byteLength, 'pack byte length');
	}
	const packDigest = sha256.create();
	const emit = async (value: Uint8Array): Promise<void> => {
		cancelled(request.signal);
		const chunk = value.slice();
		packDigest.update(chunk);
		await request.write(chunk);
	};
	await emit(createHeader({ inventory, frameRate, payloadOffset, totalBytes }));
	let frameOffset = payloadOffset;
	for (const entry of entries) {
		await emit(createIndex(entry, frameOffset));
		frameOffset = checkedAdd(frameOffset, entry.byteLength, 'frame offset');
	}
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		const frameDigest = sha256.create();
		let frameBytes = 0;
		const chunks = request.frameChunks(index, entry);
		if (!chunks || !(Symbol.iterator in Object(chunks) || Symbol.asyncIterator in Object(chunks))) {
			throw new NativeMediaImageSequenceSourcePackV25Error('A frame source is not iterable.');
		}
		for await (const value of chunks) {
			cancelled(request.signal);
			if (!(value instanceof Uint8Array) || value.byteLength === 0
				|| value.byteLength > NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES) {
				throw new NativeMediaImageSequenceSourcePackV25Error('A frame chunk is empty, oversized, or not bytes.');
			}
			frameBytes = checkedAdd(frameBytes, value.byteLength, 'frame byte length');
			if (frameBytes > entry.byteLength) {
				throw new NativeMediaImageSequenceSourcePackV25Error('A source-pack frame exceeds its inventory length.');
			}
			frameDigest.update(value);
			await emit(value);
		}
		if (frameBytes !== entry.byteLength || bytesToHex(frameDigest.digest()) !== entry.sha256) {
			throw new NativeMediaImageSequenceSourcePackV25Error(
				'An image-sequence frame fails its inventory length or digest.',
			);
		}
	}
	if (frameOffset !== totalBytes) {
		throw new NativeMediaImageSequenceSourcePackV25Error('The source-pack offset schedule is inconsistent.');
	}
	const digest = bytesToHex(packDigest.digest());
	return Object.freeze({
		kind: 'image-sequence-source-pack',
		storageKey: `image-sequence-pack-sha256:${digest}`,
		sha256: digest,
		byteLength: totalBytes,
	});
}

/** Authenticate the complete pack and its bounded index without loading the pack as one value. */
export async function validateNativeMediaImageSequenceSourcePackV25(
	request: ValidateNativeMediaImageSequenceSourcePackRequestV25,
): Promise<NativeMediaImageSequenceSourcePackReaderV25> {
	const reference = normalizePackReference(request.reference);
	const inventory = normalizeInventory(request.inventory);
	const entries = normalizeEntries(request.entries, inventory);
	const frameRate = normalizeRate(request.frameRate);
	if (typeof request.read !== 'function') {
		throw new NativeMediaImageSequenceSourcePackV25Error('A source-pack reader requires a range-read port.');
	}
	await request.assertCurrent?.();
	const digest = sha256.create();
	for (let offset = 0; offset < reference.byteLength;) {
		cancelled(request.signal);
		const length = Math.min(
			NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES,
			reference.byteLength - offset,
		);
		const chunk = await readExact(request.read, offset, length);
		digest.update(chunk);
		offset += length;
	}
	if (bytesToHex(digest.digest()) !== reference.sha256) {
		throw new NativeMediaImageSequenceSourcePackV25Error('Source-pack bytes fail total digest binding.');
	}
	await request.assertCurrent?.();
	const header = await readExact(request.read, 0, NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES);
	const headerValue = parseHeader(header, inventory, frameRate, reference);
	let expectedOffset = headerValue.payloadOffset;
	for (let index = 0; index < entries.length; index += 1) {
		const bytes = await readExact(
			request.read,
			NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES
				+ index * NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_INDEX_BYTES,
			NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_INDEX_BYTES,
		);
		const entry = parseIndex(bytes, entries[index]!);
		if (entry.offset !== expectedOffset) {
			throw new NativeMediaImageSequenceSourcePackV25Error('Source-pack frame offsets are not continuous.');
		}
		expectedOffset = checkedAdd(expectedOffset, entry.length, 'validated frame offset');
	}
	if (expectedOffset !== reference.byteLength) {
		throw new NativeMediaImageSequenceSourcePackV25Error('Source-pack index does not reach its exact total length.');
	}
	return Object.freeze({
		version: 1,
		frameCount: entries.length,
		frameRate,
		async readFrame(
			index: number,
			write: (chunk: Uint8Array) => Awaitable<void>,
			signal?: AbortSignal,
		): Promise<void> {
			if (!Number.isSafeInteger(index) || index < 0 || index >= entries.length
				|| typeof write !== 'function') {
				throw new NativeMediaImageSequenceSourcePackV25Error('A source-pack frame read has an invalid index or sink.');
			}
			cancelled(signal);
			await request.assertCurrent?.();
			const indexBytes = await readExact(
				request.read,
				NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES
					+ index * NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_INDEX_BYTES,
				NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_INDEX_BYTES,
			);
			const frame = parseIndex(indexBytes, entries[index]!);
			const frameDigest = sha256.create();
			for (let consumed = 0; consumed < frame.length;) {
				cancelled(signal);
				const length = Math.min(
					NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES,
					frame.length - consumed,
				);
				const chunk = await readExact(request.read, frame.offset + consumed, length);
				frameDigest.update(chunk);
				await write(chunk.slice());
				consumed += length;
			}
			if (bytesToHex(frameDigest.digest()) !== entries[index]!.sha256) {
				throw new NativeMediaImageSequenceSourcePackV25Error('A source-pack frame changed after validation.');
			}
			await request.assertCurrent?.();
		},
	});
}

function createHeader(value: Readonly<{
	inventory: NativeMediaImageSequenceInventoryReferenceV25;
	frameRate: NativeMediaImageSequenceRateV1;
	payloadOffset: number;
	totalBytes: number;
}>): Uint8Array {
	const bytes = new Uint8Array(NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES);
	bytes.set(MAGIC);
	const view = new DataView(bytes.buffer);
	view.setUint32(8, NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES, true);
	view.setUint32(12, NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_INDEX_BYTES, true);
	view.setUint32(16, NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_VERSION, true);
	view.setBigUint64(24, BigInt(value.inventory.byteLength), true);
	view.setUint32(32, value.inventory.frameCount, true);
	view.setUint32(36, value.frameRate.num, true);
	view.setUint32(40, value.frameRate.den, true);
	view.setBigUint64(48, BigInt(NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES), true);
	view.setBigUint64(56, BigInt(value.payloadOffset), true);
	view.setBigUint64(64, BigInt(value.totalBytes), true);
	bytes.set(hexToBytes(value.inventory.sha256), 72);
	return bytes;
}

function createIndex(entry: NativeMediaImageSequenceInventoryEntryV25, offset: number): Uint8Array {
	const bytes = new Uint8Array(NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_INDEX_BYTES);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, entry.frameNumber, true);
	view.setBigUint64(8, BigInt(offset), true);
	view.setBigUint64(16, BigInt(entry.byteLength), true);
	bytes.set(hexToBytes(entry.sha256), 24);
	return bytes;
}

function parseHeader(
	bytes: Uint8Array,
	inventory: NativeMediaImageSequenceInventoryReferenceV25,
	rate: NativeMediaImageSequenceRateV1,
	reference: NativeMediaImageSequenceSourcePackReferenceV25,
): Readonly<{ payloadOffset: number }> {
	if (!MAGIC.every((value, index) => bytes[index] === value)) {
		throw new NativeMediaImageSequenceSourcePackV25Error('Source-pack magic is unsupported.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const payloadOffset = safeUnsigned(view.getBigUint64(56, true), 'payload offset');
	if (view.getUint32(8, true) !== NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES
		|| view.getUint32(12, true) !== NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_INDEX_BYTES
		|| view.getUint32(16, true) !== 1 || view.getUint32(20, true) !== 0
		|| safeUnsigned(view.getBigUint64(24, true), 'inventory byte length') !== inventory.byteLength
		|| view.getUint32(32, true) !== inventory.frameCount
		|| view.getUint32(36, true) !== rate.num || view.getUint32(40, true) !== rate.den
		|| view.getUint32(44, true) !== 0
		|| safeUnsigned(view.getBigUint64(48, true), 'index offset') !== NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES
		|| safeUnsigned(view.getBigUint64(64, true), 'total byte length') !== reference.byteLength
		|| bytesToHex(bytes.subarray(72, 104)) !== inventory.sha256
		|| bytes.subarray(104).some((value) => value !== 0)) {
		throw new NativeMediaImageSequenceSourcePackV25Error('Source-pack header disagrees with inventory, rate, or total identity.');
	}
	const expectedPayload = checkedAdd(
		NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES,
		checkedMultiply(inventory.frameCount, NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_INDEX_BYTES, 'index'),
		'payload offset',
	);
	if (payloadOffset !== expectedPayload) {
		throw new NativeMediaImageSequenceSourcePackV25Error('Source-pack payload offset is not canonical.');
	}
	return Object.freeze({ payloadOffset });
}

function parseIndex(
	bytes: Uint8Array,
	entry: NativeMediaImageSequenceInventoryEntryV25,
): Readonly<{ offset: number; length: number }> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const offset = safeUnsigned(view.getBigUint64(8, true), 'frame offset');
	const length = safeUnsigned(view.getBigUint64(16, true), 'frame length');
	if (view.getUint32(0, true) !== entry.frameNumber || view.getUint32(4, true) !== 0
		|| length !== entry.byteLength || bytesToHex(bytes.subarray(24, 56)) !== entry.sha256
		|| bytes.subarray(56).some((value) => value !== 0)) {
		throw new NativeMediaImageSequenceSourcePackV25Error('Source-pack index disagrees with its canonical inventory frame.');
	}
	return Object.freeze({ offset, length });
}

async function readExact(
	read: (offset: number, length: number) => Awaitable<Uint8Array>,
	offset: number,
	length: number,
): Promise<Uint8Array> {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1
		|| length > NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES) {
		throw new NativeMediaImageSequenceSourcePackV25Error('A source-pack range read is outside its bounded domain.');
	}
	const bytes = await read(offset, length);
	if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
		throw new NativeMediaImageSequenceSourcePackV25Error('A source-pack range read was short or not bytes.');
	}
	return bytes;
}

function normalizePackReference(value: unknown): NativeMediaImageSequenceSourcePackReferenceV25 {
	const record = closedRecord(value, PACK_KEYS, 'source-pack reference');
	const digest = sha(record.sha256, 'source-pack');
	if (record.kind !== 'image-sequence-source-pack'
		|| record.storageKey !== `image-sequence-pack-sha256:${digest}`) {
		throw new NativeMediaImageSequenceSourcePackV25Error('A source-pack reference identity is unsupported.');
	}
	return Object.freeze({
		kind: 'image-sequence-source-pack', storageKey: record.storageKey,
		sha256: digest,
		byteLength: positiveInteger(record.byteLength, 'source-pack byte length', NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PACK_BYTES),
	});
}

function normalizeInventory(value: unknown): NativeMediaImageSequenceInventoryReferenceV25 {
	const record = closedRecord(value, INVENTORY_KEYS, 'inventory reference');
	const digest = sha(record.sha256, 'inventory');
	if (record.kind !== 'image-sequence-inventory' || record.version !== 1
		|| record.storageKey !== `image-sequence-inventory-sha256:${digest}`) {
		throw new NativeMediaImageSequenceSourcePackV25Error('The source-pack inventory identity is unsupported.');
	}
	const frameCount = positiveInteger(record.frameCount, 'inventory frame count', MAXIMUM_FRAMES);
	const firstFrameNumber = nonNegativeInteger(record.firstFrameNumber, 'first frame number', 1_000_000_000);
	const lastFrameNumber = nonNegativeInteger(record.lastFrameNumber, 'last frame number', 1_000_000_000);
	if (lastFrameNumber - firstFrameNumber + 1 !== frameCount) {
		throw new NativeMediaImageSequenceSourcePackV25Error('The source-pack inventory frame range is not continuous.');
	}
	return Object.freeze({
		kind: 'image-sequence-inventory', version: 1, storageKey: record.storageKey,
		sha256: digest,
		byteLength: positiveInteger(record.byteLength, 'inventory byte length', MAXIMUM_INVENTORY_BYTES),
		frameCount, firstFrameNumber, lastFrameNumber,
	});
}

function normalizeEntries(
	value: unknown,
	inventory: NativeMediaImageSequenceInventoryReferenceV25,
): readonly NativeMediaImageSequenceInventoryEntryV25[] {
	if (!Array.isArray(value) || value.length !== inventory.frameCount) {
		throw new NativeMediaImageSequenceSourcePackV25Error('Source-pack entries do not match inventory frame count.');
	}
	return Object.freeze(value.map((candidate, index) => {
		const record = closedRecord(candidate, ENTRY_KEYS, `inventory entry ${String(index)}`);
		const frameNumber = nonNegativeInteger(record.frameNumber, 'frame number', 1_000_000_000);
		if (frameNumber !== inventory.firstFrameNumber + index) {
			throw new NativeMediaImageSequenceSourcePackV25Error('Source-pack inventory frame order is not continuous.');
		}
		if (typeof record.fileName !== 'string' || record.fileName.length < 1
			|| UTF8.encode(record.fileName).byteLength > 512
			|| record.fileName.includes('/') || record.fileName.includes('\\') || record.fileName.includes('\0')
			|| !hasOnlyUnicodeScalars(record.fileName)) {
			throw new NativeMediaImageSequenceSourcePackV25Error('A source-pack inventory name is invalid.');
		}
		if (Number(record.byteLength) > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES) {
			throw new NativeMediaImageSequenceSourcePackV25Error(
				'An image-sequence frame exceeds its byte ceiling.',
			);
		}
		return Object.freeze({
			fileName: record.fileName, frameNumber,
			byteLength: positiveInteger(record.byteLength, 'frame byte length', NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES),
			sha256: sha(record.sha256, 'frame'),
		});
	}));
}

function normalizeRate(value: unknown): NativeMediaImageSequenceRateV1 {
	const record = closedRecord(value, RATE_KEYS, 'frame rate');
	const num = positiveInteger(record.num, 'frame-rate numerator', MAXIMUM_RATE_TERM);
	const den = positiveInteger(record.den, 'frame-rate denominator', MAXIMUM_RATE_TERM);
	if (greatestCommonDivisor(num, den) !== 1) {
		throw new NativeMediaImageSequenceSourcePackV25Error('The frame rate is not a reduced exact rational.');
	}
	return Object.freeze({ num, den });
}

function greatestCommonDivisor(left: number, right: number): number {
	while (right !== 0) [left, right] = [right, left % right];
	return left;
}

function checkedAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PACK_BYTES) {
		throw new NativeMediaImageSequenceSourcePackV25Error(`The ${label} exceeds the source-pack ceiling.`);
	}
	return result;
}

function checkedMultiply(left: number, right: number, label: string): number {
	const result = left * right;
	if (!Number.isSafeInteger(result) || result > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PACK_BYTES) {
		throw new NativeMediaImageSequenceSourcePackV25Error(`The ${label} exceeds the source-pack ceiling.`);
	}
	return result;
}

function safeUnsigned(value: bigint, label: string): number {
	if (value > BigInt(NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PACK_BYTES)) {
		throw new NativeMediaImageSequenceSourcePackV25Error(`The ${label} exceeds the source-pack ceiling.`);
	}
	return Number(value);
}

function positiveInteger(value: unknown, label: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new NativeMediaImageSequenceSourcePackV25Error(`The ${label} is outside its bounded domain.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, label: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
		throw new NativeMediaImageSequenceSourcePackV25Error(`The ${label} is outside its bounded domain.`);
	}
	return Number(value);
}

function sha(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new NativeMediaImageSequenceSourcePackV25Error(`The ${label} SHA-256 identity is invalid.`);
	}
	return value;
}

function hasOnlyUnicodeScalars(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const low = value.charCodeAt(index + 1);
			if (low < 0xdc00 || low > 0xdfff) return false;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) return false;
	}
	return true;
}

function closedRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new NativeMediaImageSequenceSourcePackV25Error(`The ${label} is not a plain record.`);
	}
	const actual = Reflect.ownKeys(value);
	if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
		throw new NativeMediaImageSequenceSourcePackV25Error(`The ${label} is not an exact record.`);
	}
	const output = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new NativeMediaImageSequenceSourcePackV25Error(`The ${label}.${key} is not an own data property.`);
		}
		output[key] = descriptor.value;
	}
	return output;
}

function cancelled(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new NativeMediaImageSequenceSourcePackV25Error('Image-sequence source-pack work was cancelled.');
	}
}

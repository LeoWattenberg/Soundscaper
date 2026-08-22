/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	resolveNativeMediaImageSequence,
	type NativeMediaImageSequenceRateV1,
	type NativeMediaImageSequenceV1,
} from './native-media-image-sequence.ts';
import {
	evaluateNativeMediaProfileAdmission,
} from './native-media-professional-profiles.ts';
import {
	createNativeMediaImageSequenceSourcePackV25,
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES,
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PACK_BYTES,
} from './native-media-image-sequence-pack-v25.ts';
import {
	normalizeVideoSourceCharacteristicsV25,
	type VideoSourceCharacteristicsV25,
} from './video-source-professional-characteristics-v25.ts';

export const NATIVE_MEDIA_IMAGE_SEQUENCE_INVENTORY_VERSION = 1 as const;
export const NATIVE_MEDIA_IMAGE_SEQUENCE_SOURCE_VERSION = 1 as const;
export const NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_INVENTORY_BYTES = 512 * 1024 * 1024;
export {
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES,
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PACK_BYTES,
};

const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/u;
const SOURCE_KEYS = Object.freeze([
	'kind', 'sourceType', 'version', 'id', 'name', 'stem', 'extension', 'frameNumberWidth',
	'firstFrameNumber', 'lastFrameNumber', 'frameCount', 'frameRate', 'inventory',
	'sourcePack', 'characteristics',
]);
const REFERENCE_KEYS = Object.freeze([
	'kind', 'version', 'storageKey', 'sha256', 'byteLength', 'frameCount',
	'firstFrameNumber', 'lastFrameNumber',
]);
const PACK_KEYS = Object.freeze(['kind', 'storageKey', 'sha256', 'byteLength']);
const ENTRY_KEYS = Object.freeze(['fileName', 'frameNumber', 'byteLength', 'sha256']);
const INVENTORY_KEYS = Object.freeze(['schemaVersion', 'entries']);
const RATE_KEYS = Object.freeze(['num', 'den']);
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

export interface NativeMediaImageSequenceInventoryEntryV25 {
	readonly fileName: string;
	readonly frameNumber: number;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface NativeMediaImageSequenceInventoryReferenceV25 {
	readonly kind: 'image-sequence-inventory';
	readonly version: 1;
	readonly storageKey: string;
	readonly sha256: string;
	readonly byteLength: number;
	readonly frameCount: number;
	readonly firstFrameNumber: number;
	readonly lastFrameNumber: number;
}

export interface NativeMediaImageSequenceSourcePackReferenceV25 {
	readonly kind: 'image-sequence-source-pack';
	readonly storageKey: string;
	readonly sha256: string;
	readonly byteLength: number;
}

export interface NativeMediaImageSequenceInventoryPublicationV25 {
	readonly bytes: Uint8Array;
	readonly reference: NativeMediaImageSequenceInventoryReferenceV25;
}

export interface NativeMediaImageSequenceSourceV25 {
	readonly kind: 'video';
	readonly sourceType: 'image-sequence';
	readonly version: 1;
	readonly id: string;
	readonly name: string;
	readonly stem: string;
	readonly extension: string;
	readonly frameNumberWidth: number;
	readonly firstFrameNumber: number;
	readonly lastFrameNumber: number;
	readonly frameCount: number;
	readonly frameRate: NativeMediaImageSequenceRateV1;
	readonly inventory: NativeMediaImageSequenceInventoryReferenceV25;
	readonly sourcePack: NativeMediaImageSequenceSourcePackReferenceV25;
	readonly characteristics: VideoSourceCharacteristicsV25;
}

export interface CreateNativeMediaImageSequenceSourceRequestV25 {
	readonly id: string;
	readonly name: string;
	readonly selection: NativeMediaImageSequenceV1;
	readonly inventory: NativeMediaImageSequenceInventoryReferenceV25;
	readonly sourcePack: NativeMediaImageSequenceSourcePackReferenceV25;
	readonly characteristics: VideoSourceCharacteristicsV25;
	readonly clearedPolicyRowIds?: readonly string[];
}

export interface NativeMediaImageSequenceDecodeRequestV25 {
	readonly kind: 'native-image-sequence-decode-v1';
	readonly profileId: string;
	readonly pattern: string;
	readonly firstFrameNumber: number;
	readonly frameCount: number;
	readonly frameRate: NativeMediaImageSequenceRateV1;
	readonly inventory: NativeMediaImageSequenceInventoryReferenceV25;
	readonly sourcePack: NativeMediaImageSequenceSourcePackReferenceV25;
}

type Awaitable<Value> = Value | PromiseLike<Value>;

export interface FramescaperImageSequenceImportSelectionV25 {
	readonly id: string;
	readonly name: string;
	readonly fileNames: readonly string[];
	readonly frameRate: NativeMediaImageSequenceRateV1;
	readonly entries: readonly NativeMediaImageSequenceInventoryEntryV25[];
	readonly frameChunks: (
		index: number,
		entry: NativeMediaImageSequenceInventoryEntryV25,
	) => Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
	readonly characteristics: VideoSourceCharacteristicsV25;
}

export interface NativeMediaImageSequenceSourcePackWriterV25 {
	/** Append to helper-owned temporary storage; it is not project-visible yet. */
	write(chunk: Uint8Array): Awaitable<void>;
	/** Atomically bind the completed temporary asset to this exact identity. */
	commit(reference: NativeMediaImageSequenceSourcePackReferenceV25): Awaitable<void>;
	/** Remove either the temporary asset or its committed asset after rollback. */
	discard(): Awaitable<void>;
}

export interface FramescaperImageSequenceImportPortsV25 {
	select(): Awaitable<FramescaperImageSequenceImportSelectionV25 | null>;
	clearedPolicyRowIds(): readonly string[];
	createSourcePackWriter(): Awaitable<NativeMediaImageSequenceSourcePackWriterV25>;
	publishInventory(
		bytes: Uint8Array,
		reference: NativeMediaImageSequenceInventoryReferenceV25,
	): Awaitable<void>;
	commitSource(source: NativeMediaImageSequenceSourceV25): Awaitable<void>;
	cleanupInventory?(reference: NativeMediaImageSequenceInventoryReferenceV25): Awaitable<void>;
}

export class NativeMediaImageSequenceV25Error extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'NativeMediaImageSequenceV25Error';
	}
}

/** Create the external inventory; no per-frame entry is persisted in project JSON. */
export function createNativeMediaImageSequenceInventoryV25(
	selection: NativeMediaImageSequenceV1,
	entriesValue: readonly NativeMediaImageSequenceInventoryEntryV25[],
): NativeMediaImageSequenceInventoryPublicationV25 {
	if (!Array.isArray(entriesValue) || entriesValue.length !== selection.frameCount) {
		throw new NativeMediaImageSequenceV25Error(
			'The image-sequence inventory must contain the exact selected file inventory.',
		);
	}
	const entries = entriesValue.map((entry, index) => normalizeInventoryEntry(entry, index));
	for (let index = 0; index < entries.length; index += 1) {
		const expected = selection.frames[index]!;
		const actual = entries[index]!;
		if (actual.fileName !== expected.fileName || actual.frameNumber !== expected.frameNumber) {
			throw new NativeMediaImageSequenceV25Error(
				'The image-sequence inventory must use canonical numeric order and match the selection.',
			);
		}
	}
	const bytes = TEXT_ENCODER.encode(JSON.stringify({
		schemaVersion: NATIVE_MEDIA_IMAGE_SEQUENCE_INVENTORY_VERSION,
		entries,
	}));
	if (bytes.byteLength > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_INVENTORY_BYTES) {
		throw new NativeMediaImageSequenceV25Error('The image-sequence inventory exceeds its byte ceiling.');
	}
	const digest = bytesToHex(sha256(bytes));
	return Object.freeze({
		bytes,
		reference: Object.freeze({
			kind: 'image-sequence-inventory',
			version: 1,
			storageKey: `image-sequence-inventory-sha256:${digest}`,
			sha256: digest,
			byteLength: bytes.byteLength,
			frameCount: selection.frameCount,
			firstFrameNumber: selection.firstFrameNumber,
			lastFrameNumber: selection.lastFrameNumber,
		}),
	});
}

/** Revalidate an inventory asset before storage import, archive use, or decode. */
export function validateNativeMediaImageSequenceInventoryBytesV25(
	referenceValue: unknown,
	bytesValue: unknown,
): readonly NativeMediaImageSequenceInventoryEntryV25[] {
	const reference = normalizeInventoryReference(referenceValue);
	if (!(bytesValue instanceof Uint8Array)) {
		throw new NativeMediaImageSequenceV25Error('Image-sequence inventory bytes must be a Uint8Array.');
	}
	if (bytesValue.byteLength !== reference.byteLength
		|| bytesToHex(sha256(bytesValue)) !== reference.sha256) {
		throw new NativeMediaImageSequenceV25Error('Image-sequence inventory bytes fail digest/length binding.');
	}
	let decoded: unknown;
	try { decoded = JSON.parse(TEXT_DECODER.decode(bytesValue)) as unknown; }
	catch (error) { throw new NativeMediaImageSequenceV25Error('Image-sequence inventory JSON is invalid.', { cause: error }); }
	const inventory = closedRecord(decoded, INVENTORY_KEYS, 'image-sequence inventory');
	if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.entries)
		|| inventory.entries.length !== reference.frameCount) {
		throw new NativeMediaImageSequenceV25Error('Image-sequence inventory shape does not match its reference.');
	}
	const entries = inventory.entries.map((entry, index) => normalizeInventoryEntry(entry, index));
	assertContinuous(entries, reference);
	return Object.freeze(entries);
}

export function createNativeMediaImageSequenceSourceV25(
	request: CreateNativeMediaImageSequenceSourceRequestV25,
): NativeMediaImageSequenceSourceV25 {
	const inventory = normalizeInventoryReference(request.inventory);
	const sourcePack = normalizeSourcePackReference(request.sourcePack);
	const characteristics = normalizeVideoSourceCharacteristicsV25(request.characteristics);
	if (inventory.frameCount !== request.selection.frameCount
		|| inventory.firstFrameNumber !== request.selection.firstFrameNumber
		|| inventory.lastFrameNumber !== request.selection.lastFrameNumber) {
		throw new NativeMediaImageSequenceV25Error('The external inventory does not describe this selection.');
	}
	const profileId = decodeProfileId(request.selection.extension);
	const admission = evaluateNativeMediaProfileAdmission({
		profileId,
		source: characteristics,
		clearedPolicyRowIds: request.clearedPolicyRowIds ?? [],
	});
	if (!admission.admitted) {
		throw new NativeMediaImageSequenceV25Error(
			`Image-sequence decode is blocked licensing rows: ${admission.blockedPolicyRowIds.join(', ')}.`,
		);
	}
	return normalizeNativeMediaImageSequenceSourceV25({
		kind: 'video',
		sourceType: 'image-sequence',
		version: 1,
		id: identifier(request.id, 'source ID'),
		name: identifier(request.name, 'source name'),
		stem: request.selection.stem,
		extension: request.selection.extension,
		frameNumberWidth: request.selection.frameNumberWidth,
		firstFrameNumber: request.selection.firstFrameNumber,
		lastFrameNumber: request.selection.lastFrameNumber,
		frameCount: request.selection.frameCount,
		frameRate: request.selection.frameRate,
		inventory,
		sourcePack,
		characteristics,
	});
}

export function normalizeNativeMediaImageSequenceSourceV25(
	value: unknown,
): NativeMediaImageSequenceSourceV25 {
	const source = closedRecord(value, SOURCE_KEYS, 'V25 image-sequence source');
	if (source.kind !== 'video' || source.sourceType !== 'image-sequence' || source.version !== 1) {
		throw new NativeMediaImageSequenceV25Error('The V25 image-sequence source identity is unsupported.');
	}
	const extension = extensionName(source.extension);
	const firstFrameNumber = nonNegativeInteger(source.firstFrameNumber, 'firstFrameNumber');
	const lastFrameNumber = nonNegativeInteger(source.lastFrameNumber, 'lastFrameNumber');
	const frameCount = positiveInteger(source.frameCount, 'frameCount', 2_000_000);
	if (lastFrameNumber - firstFrameNumber + 1 !== frameCount) {
		throw new NativeMediaImageSequenceV25Error('Image-sequence source frame bounds are not continuous.');
	}
	const inventory = normalizeInventoryReference(source.inventory);
	if (inventory.frameCount !== frameCount || inventory.firstFrameNumber !== firstFrameNumber
		|| inventory.lastFrameNumber !== lastFrameNumber) {
		throw new NativeMediaImageSequenceV25Error('Image-sequence inventory identity disagrees with its source.');
	}
	return Object.freeze({
		kind: 'video',
		sourceType: 'image-sequence',
		version: 1,
		id: identifier(source.id, 'source ID'),
		name: identifier(source.name, 'source name'),
		stem: sequenceStem(source.stem),
		extension,
		frameNumberWidth: nonNegativeInteger(source.frameNumberWidth, 'frameNumberWidth', 32),
		firstFrameNumber,
		lastFrameNumber,
		frameCount,
		frameRate: exactRate(source.frameRate),
		inventory,
		sourcePack: normalizeSourcePackReference(source.sourcePack),
		characteristics: normalizeVideoSourceCharacteristicsV25(source.characteristics),
	});
}

export function nativeMediaImageSequenceDecodeRequestV25(
	sourceValue: unknown,
): NativeMediaImageSequenceDecodeRequestV25 {
	const source = normalizeNativeMediaImageSequenceSourceV25(sourceValue);
	const pattern = `${source.stem}${source.frameNumberWidth === 0
		? '%d'
		: `%0${String(source.frameNumberWidth)}d`}.${source.extension}`;
	return Object.freeze({
		kind: 'native-image-sequence-decode-v1',
		profileId: decodeProfileId(source.extension),
		pattern,
		firstFrameNumber: source.firstFrameNumber,
		frameCount: source.frameCount,
		frameRate: source.frameRate,
		inventory: source.inventory,
		sourcePack: source.sourcePack,
	});
}

export function nativeMediaImageSequenceArchiveRootsV25(sourceValue: unknown): readonly string[] {
	const source = normalizeNativeMediaImageSequenceSourceV25(sourceValue);
	return Object.freeze([source.inventory.storageKey, source.sourcePack.storageKey]);
}

/** Controller action exposed to the existing File > Import menu integration. */
export async function runFramescaperImageSequenceImportV25(
	ports: FramescaperImageSequenceImportPortsV25,
): Promise<NativeMediaImageSequenceSourceV25 | null> {
	const selected = await ports.select();
	if (selected === null) return null;
	const selection = resolveNativeMediaImageSequence({
		fileNames: selected.fileNames,
		frameRate: selected.frameRate,
	});
	const inventory = createNativeMediaImageSequenceInventoryV25(selection, selected.entries);
	const writer = await ports.createSourcePackWriter();
	let inventoryPublished = false;
	try {
		const sourcePack = await createNativeMediaImageSequenceSourcePackV25({
			inventory: inventory.reference,
			entries: selected.entries,
			frameRate: selection.frameRate,
			frameChunks: selected.frameChunks,
			write: (chunk) => writer.write(chunk),
		});
		const source = createNativeMediaImageSequenceSourceV25({
			id: selected.id,
			name: selected.name,
			selection,
			inventory: inventory.reference,
			sourcePack,
			characteristics: selected.characteristics,
			clearedPolicyRowIds: ports.clearedPolicyRowIds(),
		});
		await writer.commit(sourcePack);
		await ports.publishInventory(inventory.bytes, inventory.reference);
		inventoryPublished = true;
		await ports.commitSource(source);
		return source;
	}
	catch (error) {
		if (inventoryPublished && ports.cleanupInventory) {
			await ports.cleanupInventory(inventory.reference);
		}
		await writer.discard();
		throw error;
	}
}

function normalizeInventoryEntry(value: unknown, index: number): NativeMediaImageSequenceInventoryEntryV25 {
	const entry = closedRecord(value, ENTRY_KEYS, `image-sequence inventory entry ${String(index)}`);
	return Object.freeze({
		fileName: plainFileName(entry.fileName),
		frameNumber: nonNegativeInteger(entry.frameNumber, 'inventory frameNumber', 1_000_000_000),
		byteLength: positiveInteger(
			entry.byteLength,
			'inventory byteLength',
			NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES,
		),
		sha256: digest(entry.sha256, 'inventory entry'),
	});
}

function normalizeInventoryReference(value: unknown): NativeMediaImageSequenceInventoryReferenceV25 {
	const reference = closedRecord(value, REFERENCE_KEYS, 'image-sequence inventory reference');
	if (reference.kind !== 'image-sequence-inventory' || reference.version !== 1) {
		throw new NativeMediaImageSequenceV25Error('The image-sequence inventory version is unsupported.');
	}
	const digestValue = digest(reference.sha256, 'inventory reference');
	if (reference.storageKey !== `image-sequence-inventory-sha256:${digestValue}`) {
		throw new NativeMediaImageSequenceV25Error('Image-sequence inventory storage key does not match its digest.');
	}
	return Object.freeze({
		kind: 'image-sequence-inventory',
		version: 1,
		storageKey: reference.storageKey,
		sha256: digestValue,
		byteLength: positiveInteger(
			reference.byteLength, 'inventory byteLength', NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_INVENTORY_BYTES,
		),
		frameCount: positiveInteger(reference.frameCount, 'inventory frameCount', 2_000_000),
		firstFrameNumber: nonNegativeInteger(reference.firstFrameNumber, 'inventory firstFrameNumber'),
		lastFrameNumber: nonNegativeInteger(reference.lastFrameNumber, 'inventory lastFrameNumber'),
	});
}

function normalizeSourcePackReference(value: unknown): NativeMediaImageSequenceSourcePackReferenceV25 {
	const reference = closedRecord(value, PACK_KEYS, 'image-sequence source pack reference');
	if (reference.kind !== 'image-sequence-source-pack') {
		throw new NativeMediaImageSequenceV25Error('The image-sequence source pack kind is unsupported.');
	}
	const digestValue = digest(reference.sha256, 'source pack');
	if (reference.storageKey !== `image-sequence-pack-sha256:${digestValue}`) {
		throw new NativeMediaImageSequenceV25Error('Image-sequence source pack storage key does not match its digest.');
	}
	return Object.freeze({
		kind: 'image-sequence-source-pack',
		storageKey: reference.storageKey,
		sha256: digestValue,
		byteLength: positiveInteger(reference.byteLength, 'source pack byteLength', NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PACK_BYTES),
	});
}

function assertContinuous(
	entries: readonly NativeMediaImageSequenceInventoryEntryV25[],
	reference: NativeMediaImageSequenceInventoryReferenceV25,
): void {
	for (let index = 0; index < entries.length; index += 1) {
		if (entries[index]!.frameNumber !== reference.firstFrameNumber + index) {
			throw new NativeMediaImageSequenceV25Error('Image-sequence inventory order is not continuous.');
		}
	}
	if (entries.at(-1)?.frameNumber !== reference.lastFrameNumber) {
		throw new NativeMediaImageSequenceV25Error('Image-sequence inventory does not reach its last frame.');
	}
}

function decodeProfileId(extension: string): string {
	if (extension === 'png') return 'decode-png-sequence';
	if (extension === 'tif' || extension === 'tiff') return 'decode-tiff-sequence';
	if (extension === 'exr') return 'decode-openexr-sequence';
	throw new NativeMediaImageSequenceV25Error('The image-sequence extension has no native decode profile.');
}

function extensionName(value: unknown): string {
	if (value !== 'png' && value !== 'tif' && value !== 'tiff' && value !== 'exr') {
		throw new NativeMediaImageSequenceV25Error('The image-sequence extension is unsupported.');
	}
	return value;
}

function exactRate(value: unknown): NativeMediaImageSequenceRateV1 {
	const rate = closedRecord(value, RATE_KEYS, 'image-sequence frame rate');
	const num = positiveInteger(rate.num, 'frame-rate numerator', 1_000_000);
	const den = positiveInteger(rate.den, 'frame-rate denominator', 1_000_000);
	if (greatestCommonDivisor(num, den) !== 1) {
		throw new NativeMediaImageSequenceV25Error('Image-sequence frame rate must be a reduced rational.');
	}
	return Object.freeze({ num, den });
}

function greatestCommonDivisor(left: number, right: number): number {
	while (right !== 0) [left, right] = [right, left % right];
	return left;
}

function closedRecord(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new NativeMediaImageSequenceV25Error(`${name} must be a plain record.`);
	}
	const actual = Reflect.ownKeys(value);
	if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
		const unsupported = actual.find((key) => typeof key !== 'string' || !keys.includes(key));
		throw new NativeMediaImageSequenceV25Error(`${name} has unsupported or missing field ${String(unsupported ?? '')}.`);
	}
	const snapshot = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new NativeMediaImageSequenceV25Error(
				`${name}.${key} must be an own enumerable data property.`,
			);
		}
		snapshot[key] = descriptor.value;
	}
	return snapshot;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new NativeMediaImageSequenceV25Error(`${name} must be a lowercase SHA-256 digest.`);
	}
	return value;
}

function plainFileName(value: unknown): string {
	if (typeof value !== 'string' || !value || TEXT_ENCODER.encode(value).byteLength > 512 || value.includes('/')
		|| value.includes('\\') || value.includes('\0') || !hasOnlyUnicodeScalars(value)) {
		throw new NativeMediaImageSequenceV25Error('An inventory file name must be one bounded plain name.');
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

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value) || value.trim() !== value) {
		throw new NativeMediaImageSequenceV25Error(`Image-sequence ${name} is invalid.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new NativeMediaImageSequenceV25Error(`${name} must be a bounded positive integer.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
		throw new NativeMediaImageSequenceV25Error(`${name} must be a bounded non-negative integer.`);
	}
	return Number(value);
}

function sequenceStem(value: unknown): string {
	if (typeof value !== 'string' || value.length > 480 || value.includes('/')
		|| value.includes('\\') || value.includes('\0')) {
		throw new NativeMediaImageSequenceV25Error('Image-sequence stem is invalid.');
	}
	return value;
}

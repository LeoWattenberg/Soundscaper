/* SPDX-License-Identifier: AGPL-3.0-only */

import { throwIfScapeAborted } from './scape-abort.ts';
import { SCAPE_ARCHIVE_LIMITS } from './scape-archive-envelope.ts';
import { SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES } from './scape-archive-zip-profile.ts';

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const END_SIGNATURE = 0x06054b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const ZIP_STORE_METHOD = 0;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const UTF8_FLAG = 0x0800;
const SUPPORTED_FLAGS = DATA_DESCRIPTOR_FLAG | UTF8_FLAG;
const UINT16_SENTINEL = 0xffff;
const UINT32_SENTINEL = 0xffffffff;
const ZIP64_STREAM_SIZE_PLACEHOLDER = 0x1_0000_0000;
const END_FIXED_BYTES = 22;
const END_MAXIMUM_BYTES = END_FIXED_BYTES + UINT16_SENTINEL;
const LOCAL_FIXED_BYTES = 30;
const CENTRAL_FIXED_BYTES = 46;
const ZIP64_END_BYTES = 56;
const ZIP64_LOCATOR_BYTES = 20;
const MAXIMUM_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const BLOB_SIZE_GETTER = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
const BLOB_SLICE = Blob.prototype.slice;

/** No validator read retains more than one maximum ZIP name plus extra field. */
export const SCAPE_MAXIMUM_LAYOUT_READ_BYTES = 2 * UINT16_SENTINEL;

interface LayoutContext {
	readonly blob: Blob;
	readonly signal?: AbortSignal;
	readonly size: number;
}

interface CentralDirectoryLocation {
	readonly entryCount: number;
	readonly offset: number;
	readonly size: number;
}

interface CentralEntry {
	readonly compressedSize: number;
	readonly crc32: number;
	readonly flags: number;
	readonly index: number;
	readonly localOffset: number;
	readonly name: Uint8Array;
	readonly uncompressedSize: number;
	readonly zip64Sizes: boolean;
}

interface EntryRange {
	readonly end: number;
	readonly start: number;
}

export interface ScapeDataDescriptorExpectation {
	readonly compressedSize: number;
	readonly crc32: number;
	readonly uncompressedSize: number;
	readonly zip64: boolean;
}

export async function validateScapeArchiveLayout(input: Blob, signal?: AbortSignal): Promise<void> {
	if (!(input instanceof Blob)) throw new TypeError('A .scape Blob is required.');
	throwIfScapeAborted(signal);
	if (!BLOB_SIZE_GETTER) throw new Error('The platform Blob size getter is unavailable.');
	const size = Reflect.apply(BLOB_SIZE_GETTER, input, []) as number;
	if (!Number.isSafeInteger(size) || size < END_FIXED_BYTES) {
		throw new RangeError('The .scape ZIP size is invalid.');
	}
	const blob = Reflect.apply(BLOB_SLICE, input, [0, size]) as Blob;
	const context: LayoutContext = { blob, signal, size };
	const central = await locateCentralDirectory(context);
	const entries = await readCentralEntries(context, central);
	const ranges: EntryRange[] = [];
	for (const entry of entries) ranges.push(await validateLocalEntry(context, central.offset, entry));
	assertExactEntryPartition(ranges, central.offset);
	throwIfScapeAborted(signal);
}

export function resolveScapeDataDescriptorLength(
	bytes: Uint8Array,
	expected: ScapeDataDescriptorExpectation,
): number {
	assertDescriptorExpectation(expected);
	const unsignedBytes = expected.zip64 ? 20 : 12;
	const signedBytes = unsignedBytes + 4;
	const matches: number[] = [];
	if (bytes.byteLength >= unsignedBytes && descriptorMatches(bytes, 0, expected)) matches.push(unsignedBytes);
	if (bytes.byteLength >= signedBytes
		&& view(bytes).getUint32(0, true) === DATA_DESCRIPTOR_SIGNATURE
		&& descriptorMatches(bytes, 4, expected)) matches.push(signedBytes);
	if (matches.length > 1) throw new Error('The .scape data descriptor is ambiguous.');
	if (!matches.length) throw new Error('The .scape data descriptor does not match its central record.');
	return matches[0] as number;
}

async function locateCentralDirectory(context: LayoutContext): Promise<CentralDirectoryLocation> {
	const tailSize = Math.min(context.size, END_MAXIMUM_BYTES);
	const tailOffset = context.size - tailSize;
	const tail = await readRange(context, tailOffset, tailSize);
	const tailView = view(tail);
	const candidates: number[] = [];
	for (let offset = tail.byteLength - END_FIXED_BYTES; offset >= 0; offset -= 1) {
		if (tailView.getUint32(offset, true) !== END_SIGNATURE) continue;
		const commentBytes = tailView.getUint16(offset + 20, true);
		if (tailOffset + offset + END_FIXED_BYTES + commentBytes === context.size) {
			candidates.push(tailOffset + offset);
		}
	}
	if (candidates.length !== 1) {
		throw new Error(candidates.length ? 'The .scape ZIP end record is ambiguous.' : 'The .scape ZIP end record is missing.');
	}
	const endOffset = candidates[0] as number;
	const end = tailViewAt(tail, tailOffset, endOffset, END_FIXED_BYTES);
	const classicDisk = end.getUint16(4, true);
	const classicCentralDisk = end.getUint16(6, true);
	const classicDiskEntries = end.getUint16(8, true);
	const classicEntries = end.getUint16(10, true);
	const classicSize = end.getUint32(12, true);
	const classicOffset = end.getUint32(16, true);
	const zip64 = classicDisk === UINT16_SENTINEL
		|| classicCentralDisk === UINT16_SENTINEL
		|| classicDiskEntries === UINT16_SENTINEL
		|| classicEntries === UINT16_SENTINEL
		|| classicSize === UINT32_SENTINEL
		|| classicOffset === UINT32_SENTINEL;
	if (!zip64) {
		if (classicDisk !== 0 || classicCentralDisk !== 0 || classicDiskEntries !== classicEntries) {
			throw new Error('The .scape ZIP must use one exact disk and entry count.');
		}
		return checkedCentralLocation(classicEntries, classicOffset, classicSize, endOffset);
	}
	if (endOffset < ZIP64_LOCATOR_BYTES) throw new Error('The .scape Zip64 locator is missing.');
	const locatorOffset = endOffset - ZIP64_LOCATOR_BYTES;
	const locator = view(await readRange(context, locatorOffset, ZIP64_LOCATOR_BYTES));
	if (locator.getUint32(0, true) !== ZIP64_LOCATOR_SIGNATURE
		|| locator.getUint32(4, true) !== 0
		|| locator.getUint32(16, true) !== 1) {
		throw new Error('The .scape Zip64 locator is invalid.');
	}
	const zip64Offset = safeUint64(locator, 8, 'Zip64 end offset');
	const zip64End = view(await readRange(context, zip64Offset, ZIP64_END_BYTES));
	if (zip64End.getUint32(0, true) !== ZIP64_END_SIGNATURE
		|| safeUint64(zip64End, 4, 'Zip64 end size') !== 44
		|| zip64Offset + ZIP64_END_BYTES !== locatorOffset) {
		throw new Error('The .scape Zip64 end record is not exact.');
	}
	const disk = zip64End.getUint32(16, true);
	const centralDisk = zip64End.getUint32(20, true);
	const diskEntries = safeUint64(zip64End, 24, 'Zip64 disk entry count');
	const entries = safeUint64(zip64End, 32, 'Zip64 entry count');
	const centralSize = safeUint64(zip64End, 40, 'Zip64 central-directory size');
	const centralOffset = safeUint64(zip64End, 48, 'Zip64 central-directory offset');
	if (disk !== 0 || centralDisk !== 0 || diskEntries !== entries) {
		throw new Error('The .scape Zip64 archive must use one exact disk and entry count.');
	}
	assertClassicValue(classicDisk, UINT16_SENTINEL, disk, 'disk number');
	assertClassicValue(classicCentralDisk, UINT16_SENTINEL, centralDisk, 'central disk number');
	assertClassicValue(classicDiskEntries, UINT16_SENTINEL, diskEntries, 'disk entry count');
	assertClassicValue(classicEntries, UINT16_SENTINEL, entries, 'entry count');
	assertClassicValue(classicSize, UINT32_SENTINEL, centralSize, 'central-directory size');
	assertClassicValue(classicOffset, UINT32_SENTINEL, centralOffset, 'central-directory offset');
	return checkedCentralLocation(entries, centralOffset, centralSize, zip64Offset);
}

function checkedCentralLocation(
	entryCount: number,
	offset: number,
	size: number,
	exactEnd: number,
): CentralDirectoryLocation {
	if (entryCount > SCAPE_ARCHIVE_LIMITS.maximumEntryCount) {
		throw new RangeError('The .scape archive contains too many entries.');
	}
	if (size > SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES) {
		throw new RangeError('The .scape central directory exceeds the portable byte limit.');
	}
	if (size < entryCount * CENTRAL_FIXED_BYTES || offset > exactEnd || size !== exactEnd - offset) {
		throw new Error('The .scape central-directory boundary is not exact.');
	}
	return { entryCount, offset, size };
}

async function readCentralEntries(
	context: LayoutContext,
	central: CentralDirectoryLocation,
): Promise<CentralEntry[]> {
	const entries: CentralEntry[] = [];
	let cursor = central.offset;
	let expandedBytes = 0;
	const centralEnd = central.offset + central.size;
	for (let index = 0; index < central.entryCount; index += 1) {
		throwIfScapeAborted(context.signal);
		if (cursor > centralEnd - CENTRAL_FIXED_BYTES) throw new Error('The .scape central record is truncated.');
		const fixed = view(await readRange(context, cursor, CENTRAL_FIXED_BYTES));
		if (fixed.getUint32(0, true) !== CENTRAL_SIGNATURE) throw new Error('The .scape central record is invalid.');
		const flags = fixed.getUint16(8, true);
		const method = fixed.getUint16(10, true);
		const crc32 = fixed.getUint32(16, true);
		const rawCompressed = fixed.getUint32(20, true);
		const rawUncompressed = fixed.getUint32(24, true);
		const nameBytes = fixed.getUint16(28, true);
		const extraBytes = fixed.getUint16(30, true);
		const commentBytes = fixed.getUint16(32, true);
		const rawDisk = fixed.getUint16(34, true);
		const rawLocalOffset = fixed.getUint32(42, true);
		const variableBytes = nameBytes + extraBytes;
		const recordBytes = CENTRAL_FIXED_BYTES + variableBytes + commentBytes;
		if (!nameBytes || recordBytes > centralEnd - cursor) throw new Error('The .scape central record is not exact.');
		const variable = await readRange(context, cursor + CENTRAL_FIXED_BYTES, variableBytes);
		const fields = parseExtraFields(variable.subarray(nameBytes), `central record ${String(index + 1)}`);
		const resolved = resolveCentralZip64(fields, rawUncompressed, rawCompressed, rawLocalOffset, rawDisk);
		if (method !== ZIP_STORE_METHOD || resolved.compressedSize !== resolved.uncompressedSize) {
			throw new Error('Portable .scape entries must use STORE with exact size equality.');
		}
		if ((flags & ~SUPPORTED_FLAGS) !== 0) throw new Error('The .scape central record uses unsupported flags.');
		if (resolved.disk !== 0) throw new Error('The .scape central record references another disk.');
		if (resolved.uncompressedSize > SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes - expandedBytes) {
			throw new RangeError('The .scape archive exceeds the declared expansion limit.');
		}
		expandedBytes += resolved.uncompressedSize;
		entries.push({
			compressedSize: resolved.compressedSize,
			crc32,
			flags,
			index,
			localOffset: resolved.localOffset,
			name: variable.slice(0, nameBytes),
			uncompressedSize: resolved.uncompressedSize,
			zip64Sizes: rawCompressed === UINT32_SENTINEL,
		});
		cursor += recordBytes;
	}
	if (cursor !== centralEnd) throw new Error('The .scape central-directory records are not exact.');
	return entries;
}

async function validateLocalEntry(
	context: LayoutContext,
	centralOffset: number,
	entry: CentralEntry,
): Promise<EntryRange> {
	const label = `entry ${String(entry.index + 1)}`;
	if (entry.localOffset > centralOffset - LOCAL_FIXED_BYTES) throw new Error(`The .scape ${label} crosses the central directory.`);
	const fixed = view(await readRange(context, entry.localOffset, LOCAL_FIXED_BYTES));
	if (fixed.getUint32(0, true) !== LOCAL_SIGNATURE) throw new Error(`The .scape ${label} local record is invalid.`);
	const flags = fixed.getUint16(6, true);
	const method = fixed.getUint16(8, true);
	const crc32 = fixed.getUint32(14, true);
	const rawCompressed = fixed.getUint32(18, true);
	const rawUncompressed = fixed.getUint32(22, true);
	const nameBytes = fixed.getUint16(26, true);
	const extraBytes = fixed.getUint16(28, true);
	const variableBytes = nameBytes + extraBytes;
	const variableOffset = entry.localOffset + LOCAL_FIXED_BYTES;
	if (variableBytes > centralOffset - variableOffset) throw new Error(`The .scape ${label} local record crosses the central directory.`);
	const variable = await readRange(context, variableOffset, variableBytes);
	if (flags !== entry.flags || method !== ZIP_STORE_METHOD || !equalBytes(variable.subarray(0, nameBytes), entry.name)) {
		throw new Error(`The .scape ${label} has an ambiguous archive layout: its local record does not match its central record.`);
	}
	const fields = parseExtraFields(variable.subarray(nameBytes), `${label} local record`);
	const localSizes = resolveLocalZip64(fields, rawUncompressed, rawCompressed);
	if (localSizes.zip64 !== entry.zip64Sizes) throw new Error(`The .scape ${label} Zip64 size profile is inconsistent.`);
	const hasDescriptor = (flags & DATA_DESCRIPTOR_FLAG) !== 0;
	if (!hasDescriptor) {
		if (crc32 !== entry.crc32
			|| localSizes.compressedSize !== entry.compressedSize
			|| localSizes.uncompressedSize !== entry.uncompressedSize) {
			throw new Error(`The .scape ${label} local fields do not exactly match the central record.`);
		}
	} else if ((crc32 !== 0 && crc32 !== entry.crc32)
		|| !descriptorSizePlaceholdersMatch(localSizes, entry)) {
		throw new Error(`The .scape ${label} descriptor placeholders are inconsistent.`);
	}
	const dataOffset = variableOffset + variableBytes;
	if (entry.compressedSize > centralOffset - dataOffset) throw new Error(`The .scape ${label} data crosses the central directory.`);
	let end = dataOffset + entry.compressedSize;
	if (hasDescriptor) {
		const maximumDescriptorBytes = entry.zip64Sizes ? 24 : 16;
		const minimumDescriptorBytes = maximumDescriptorBytes - 4;
		const available = centralOffset - end;
		if (available < minimumDescriptorBytes) throw new Error(`The .scape ${label} data descriptor crosses the central directory.`);
		const descriptor = await readRange(context, end, Math.min(maximumDescriptorBytes, available));
		end += resolveScapeDataDescriptorLength(descriptor, {
			compressedSize: entry.compressedSize,
			crc32: entry.crc32,
			uncompressedSize: entry.uncompressedSize,
			zip64: entry.zip64Sizes,
		});
	}
	return { start: entry.localOffset, end };
}

function descriptorSizePlaceholdersMatch(
	local: Readonly<{ compressedSize: number; uncompressedSize: number; zip64: boolean }>,
	central: Readonly<{ compressedSize: number; uncompressedSize: number }>,
): boolean {
	const exact = local.compressedSize === central.compressedSize
		&& local.uncompressedSize === central.uncompressedSize;
	if (local.zip64) {
		return exact || (local.compressedSize === ZIP64_STREAM_SIZE_PLACEHOLDER
			&& local.uncompressedSize === ZIP64_STREAM_SIZE_PLACEHOLDER);
	}
	return exact || (local.compressedSize === 0 && local.uncompressedSize === 0);
}

function resolveCentralZip64(
	fields: ReadonlyMap<number, Uint8Array>,
	rawUncompressed: number,
	rawCompressed: number,
	rawLocalOffset: number,
	rawDisk: number,
) {
	const zip64 = fields.get(ZIP64_EXTRA_FIELD);
	const sizeSentinels = Number(rawUncompressed === UINT32_SENTINEL) + Number(rawCompressed === UINT32_SENTINEL);
	if (sizeSentinels === 1) throw new Error('The .scape central Zip64 size fields are inconsistent.');
	const required = sizeSentinels * 8
		+ Number(rawLocalOffset === UINT32_SENTINEL) * 8
		+ Number(rawDisk === UINT16_SENTINEL) * 4;
	if (!required) {
		if (zip64) throw new Error('The .scape central record has an unnecessary Zip64 extra field.');
		return { uncompressedSize: rawUncompressed, compressedSize: rawCompressed, localOffset: rawLocalOffset, disk: rawDisk };
	}
	if (!zip64 || zip64.byteLength !== required) throw new Error('The .scape central Zip64 extra field is not exact.');
	let offset = 0;
	const take64 = (raw: number, label: string) => {
		if (raw !== UINT32_SENTINEL) return raw;
		const value = safeUint64(view(zip64), offset, label);
		offset += 8;
		return value;
	};
	const uncompressedSize = take64(rawUncompressed, 'Zip64 uncompressed size');
	const compressedSize = take64(rawCompressed, 'Zip64 compressed size');
	const localOffset = take64(rawLocalOffset, 'Zip64 local offset');
	const disk = rawDisk === UINT16_SENTINEL ? view(zip64).getUint32(offset, true) : rawDisk;
	return { uncompressedSize, compressedSize, localOffset, disk };
}

function resolveLocalZip64(
	fields: ReadonlyMap<number, Uint8Array>,
	rawUncompressed: number,
	rawCompressed: number,
) {
	const zip64 = fields.get(ZIP64_EXTRA_FIELD);
	const uncompressedSentinel = rawUncompressed === UINT32_SENTINEL;
	const compressedSentinel = rawCompressed === UINT32_SENTINEL;
	if (uncompressedSentinel !== compressedSentinel) throw new Error('The .scape local Zip64 size fields are inconsistent.');
	if (!uncompressedSentinel) {
		if (zip64) throw new Error('The .scape local record has an unnecessary Zip64 extra field.');
		return { uncompressedSize: rawUncompressed, compressedSize: rawCompressed, zip64: false };
	}
	if (!zip64 || zip64.byteLength !== 16) throw new Error('The .scape local Zip64 extra field is not exact.');
	return {
		uncompressedSize: safeUint64(view(zip64), 0, 'local Zip64 uncompressed size'),
		compressedSize: safeUint64(view(zip64), 8, 'local Zip64 compressed size'),
		zip64: true,
	};
}

function parseExtraFields(bytes: Uint8Array, label: string): ReadonlyMap<number, Uint8Array> {
	const fields = new Map<number, Uint8Array>();
	const bytesView = view(bytes);
	let offset = 0;
	while (offset < bytes.byteLength) {
		if (offset > bytes.byteLength - 4) throw new Error(`The .scape ${label} extra fields are truncated.`);
		const id = bytesView.getUint16(offset, true);
		const size = bytesView.getUint16(offset + 2, true);
		offset += 4;
		if (size > bytes.byteLength - offset) throw new Error(`The .scape ${label} extra field is truncated.`);
		if (fields.has(id)) throw new Error(`The .scape ${label} has duplicate extra fields.`);
		fields.set(id, bytes.subarray(offset, offset + size));
		offset += size;
	}
	return fields;
}

function assertExactEntryPartition(ranges: EntryRange[], centralOffset: number): void {
	ranges.sort((left, right) => left.start - right.start);
	let cursor = 0;
	for (const range of ranges) {
		if (range.start < cursor) throw new Error('The .scape ZIP has overlapping entry ranges.');
		if (range.start !== cursor) throw new Error('The .scape ZIP has an unclaimed entry-layout gap.');
		cursor = range.end;
	}
	if (cursor !== centralOffset) throw new Error('The .scape entry ranges do not reach the exact central-directory boundary.');
}

function descriptorMatches(bytes: Uint8Array, offset: number, expected: ScapeDataDescriptorExpectation): boolean {
	const bytesView = view(bytes);
	if (bytesView.getUint32(offset, true) !== expected.crc32) return false;
	if (!expected.zip64) {
		return bytesView.getUint32(offset + 4, true) === expected.compressedSize
			&& bytesView.getUint32(offset + 8, true) === expected.uncompressedSize;
	}
	return bytesView.getBigUint64(offset + 4, true) === BigInt(expected.compressedSize)
		&& bytesView.getBigUint64(offset + 12, true) === BigInt(expected.uncompressedSize);
}

function assertDescriptorExpectation(expected: ScapeDataDescriptorExpectation): void {
	for (const value of [expected.crc32, expected.compressedSize, expected.uncompressedSize]) {
		if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('The .scape descriptor expectation is invalid.');
	}
	if (expected.crc32 > UINT32_SENTINEL
		|| (!expected.zip64 && (expected.compressedSize > UINT32_SENTINEL || expected.uncompressedSize > UINT32_SENTINEL))) {
		throw new RangeError('The .scape descriptor expectation exceeds its field width.');
	}
}

async function readRange(context: LayoutContext, offset: number, length: number): Promise<Uint8Array> {
	throwIfScapeAborted(context.signal);
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0
		|| length > SCAPE_MAXIMUM_LAYOUT_READ_BYTES || offset > context.size - length) {
		throw new RangeError('The .scape layout requested an invalid or unbounded Blob range.');
	}
	if (!length) return new Uint8Array();
	const range = Reflect.apply(BLOB_SLICE, context.blob, [offset, offset + length]) as Blob;
	const bytes = new Uint8Array(await range.arrayBuffer());
	throwIfScapeAborted(context.signal);
	if (bytes.byteLength !== length) throw new Error('The .scape Blob range read was incomplete.');
	return bytes;
}

function safeUint64(bytesView: DataView, offset: number, label: string): number {
	const value = bytesView.getBigUint64(offset, true);
	if (value > MAXIMUM_SAFE_BIGINT) throw new RangeError(`The .scape ${label} exceeds the safe integer range.`);
	return Number(value);
}

function assertClassicValue(classic: number, sentinel: number, zip64: number, label: string): void {
	if (classic !== sentinel && classic !== zip64) throw new Error(`The .scape classic and Zip64 ${label} disagree.`);
}

function tailViewAt(bytes: Uint8Array, tailOffset: number, absoluteOffset: number, length: number): DataView {
	const offset = absoluteOffset - tailOffset;
	return new DataView(bytes.buffer, bytes.byteOffset + offset, length);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

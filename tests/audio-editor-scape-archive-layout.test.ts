/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BlobReader,
	BlobWriter,
	Uint8ArrayReader,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import {
	SCAPE_MAXIMUM_LAYOUT_READ_BYTES,
	resolveScapeDataDescriptorLength,
	validateScapeArchiveLayout,
} from '../src/common/editor/scape-archive-layout.ts';
import {
	SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES,
	SCAPE_STORE_CENTRAL_RECORD_OVERHEAD_BYTES,
	maximumScapeStoreCentralDirectoryBytes,
} from '../src/common/editor/scape-archive-zip-profile.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../src/common/editor/scape-archive-envelope.ts';
import { maximumScapeStoreArchiveBytes } from '../src/common/editor/scape-export-estimate.ts';
import { withScapeArchiveReader } from '../src/common/editor/scape-archive-reader.ts';

const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const END_SIGNATURE = 0x06054b50;

test('raw Scape layout accepts exact classic and Zip64 STORE descriptor profiles', async () => {
	for (const zip64 of [false, true]) {
		for (const dataDescriptorSignature of [false, true]) {
			await validateScapeArchiveLayout(await writeArchive({
				zip64,
				dataDescriptor: true,
				dataDescriptorSignature,
			}));
		}
		await validateScapeArchiveLayout(await writeArchive({
			zip64,
			dataDescriptor: false,
			dataDescriptorSignature: false,
		}));
	}
	await validateScapeArchiveLayout(await writeStreamArchive());
	await validateScapeArchiveLayout(await writePayloadArchive(new Uint8Array(), {
		zip64: false,
		dataDescriptor: false,
		dataDescriptorSignature: false,
	}));
});

test('raw Scape layout accepts exact adjacent entries and rejects gaps or overlaps', async (context) => {
	const source = await archiveBytes(await writeEntriesArchive(['first.bin', 'other.bin']));
	await validateScapeArchiveLayout(new Blob([exactArrayBuffer(source)]));
	await context.test('gap', async () => {
		const bytes = insertGapBeforeSecondLocalEntry(source);
		await assertLayoutRejects(bytes, /entry-layout gap/iu);
	});
	await context.test('overlap', async () => {
		const bytes = source.slice();
		const records = centralRecordOffsets(bytes);
		assert.equal(records.length, 2);
		const second = records[1] as number;
		dataView(bytes).setUint32(second + 42, 0, true);
		const secondName = second + 46;
		bytes.set(new TextEncoder().encode('first.bin'), secondName);
		await assertLayoutRejects(bytes, /overlapping entry ranges/iu);
	});
});

test('raw Scape layout rejects zeroed exact local fields without a descriptor', async () => {
	const bytes = await archiveBytes(await writeArchive({
		zip64: false,
		dataDescriptor: false,
		dataDescriptorSignature: false,
	}));
	const view = dataView(bytes);
	view.setUint32(14, 0, true);
	view.setUint32(18, 0, true);
	view.setUint32(22, 0, true);
	await assert.rejects(validateScapeArchiveLayout(new Blob([exactArrayBuffer(bytes)])), /local.*central/iu);
});

test('raw Scape layout requires exact classic and Zip64 end-record boundaries', async (context) => {
	const classic = await archiveBytes(await writeArchive(classicDescriptorOptions()));
	await context.test('classic central offset', async () => {
		const bytes = classic.slice();
		const view = dataView(bytes);
		const end = findLastSignature(bytes, END_SIGNATURE);
		view.setUint32(end + 16, view.getUint32(end + 16, true) + 1, true);
		await assertLayoutRejects(bytes, /central-directory boundary/iu);
	});
	await context.test('classic central size', async () => {
		const bytes = classic.slice();
		const view = dataView(bytes);
		const end = findLastSignature(bytes, END_SIGNATURE);
		view.setUint32(end + 12, view.getUint32(end + 12, true) + 1, true);
		await assertLayoutRejects(bytes, /central-directory boundary/iu);
	});
	await context.test('central record extent', async () => {
		const bytes = classic.slice();
		const central = findSignature(bytes, CENTRAL_SIGNATURE);
		dataView(bytes).setUint16(central + 32, 1, true);
		await assertLayoutRejects(bytes, /central record/iu);
	});

	const zip64 = await archiveBytes(await writeArchive(zip64DescriptorOptions()));
	await context.test('Zip64 locator target', async () => {
		const bytes = zip64.slice();
		const view = dataView(bytes);
		const locator = findSignature(bytes, ZIP64_LOCATOR_SIGNATURE);
		view.setBigUint64(locator + 8, view.getBigUint64(locator + 8, true) + 1n, true);
		await assertLayoutRejects(bytes, /Zip64 end record/iu);
	});
	await context.test('Zip64 end record extent', async () => {
		const bytes = zip64.slice();
		const zip64End = findSignature(bytes, ZIP64_END_SIGNATURE);
		dataView(bytes).setBigUint64(zip64End + 4, 43n, true);
		await assertLayoutRejects(bytes, /Zip64 end record/iu);
	});
	await context.test('Zip64 central offset', async () => {
		const bytes = zip64.slice();
		const view = dataView(bytes);
		const zip64End = findSignature(bytes, ZIP64_END_SIGNATURE);
		view.setBigUint64(zip64End + 48, view.getBigUint64(zip64End + 48, true) + 1n, true);
		await assertLayoutRejects(bytes, /central-directory boundary/iu);
	});
});

test('raw Scape layout bounds the central directory before any whole-directory allocation', async () => {
	const bytes = await archiveBytes(await writeArchive(classicDescriptorOptions()));
	const end = findLastSignature(bytes, END_SIGNATURE);
	dataView(bytes).setUint32(end + 12, SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES + 1, true);
	await assertLayoutRejects(bytes, /central directory.*portable byte limit/iu);
});

test('raw Scape layout strictly resolves required Zip64 extras', async (context) => {
	const source = await archiveBytes(await writeArchive(zip64DescriptorOptions()));
	await context.test('truncated size field', async () => {
		const bytes = source.slice();
		const central = findSignature(bytes, CENTRAL_SIGNATURE);
		const extra = central + 46 + dataView(bytes).getUint16(central + 28, true);
		assert.equal(dataView(bytes).getUint16(extra, true), 1);
		dataView(bytes).setUint16(extra + 2, 0xffff, true);
		await assertLayoutRejects(bytes, /extra field|extra fields|Zip64/iu);
	});
	await context.test('duplicate field', async () => {
		const bytes = source.slice();
		const central = findSignature(bytes, CENTRAL_SIGNATURE);
		const extra = central + 46 + dataView(bytes).getUint16(central + 28, true);
		const secondExtra = extra + 4 + dataView(bytes).getUint16(extra + 2, true);
		dataView(bytes).setUint16(secondExtra, 1, true);
		await assertLayoutRejects(bytes, /duplicate extra fields/iu);
	});
	await context.test('unsafe 64-bit value', async () => {
		const bytes = source.slice();
		const central = findSignature(bytes, CENTRAL_SIGNATURE);
		const extra = central + 46 + dataView(bytes).getUint16(central + 28, true);
		dataView(bytes).setBigUint64(extra + 4, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true);
		await assertLayoutRejects(bytes, /safe integer range/iu);
	});
	await context.test('missing local-offset value', async () => {
		const bytes = source.slice();
		const central = findSignature(bytes, CENTRAL_SIGNATURE);
		dataView(bytes).setUint32(central + 42, 0xffffffff, true);
		await assertLayoutRejects(bytes, /central Zip64 extra field/iu);
	});
	await context.test('local value disagreement', async () => {
		const bytes = await archiveBytes(await writeArchive({
			zip64: true,
			dataDescriptor: false,
			dataDescriptorSignature: false,
		}));
		const localExtra = 30 + dataView(bytes).getUint16(26, true);
		assert.equal(dataView(bytes).getUint16(localExtra, true), 1);
		dataView(bytes).setBigUint64(localExtra + 4, 0n, true);
		await assertLayoutRejects(bytes, /local fields.*central record/iu);
	});
});

test('signed and unsigned classic and Zip64 descriptors require exact integrity fields', async () => {
	for (const zip64 of [false, true]) {
		for (const signed of [false, true]) {
			const bytes = await archiveBytes(await writeArchive({
				zip64,
				dataDescriptor: true,
				dataDescriptorSignature: signed,
			}));
			const view = dataView(bytes);
			assert.equal(view.getUint32(0, true), LOCAL_SIGNATURE);
			const dataOffset = 30 + view.getUint16(26, true) + view.getUint16(28, true);
			const descriptorOffset = dataOffset + 3;
			if (signed) assert.equal(view.getUint32(descriptorOffset, true), DATA_DESCRIPTOR_SIGNATURE);
			bytes[descriptorOffset + (signed ? 4 : 0)] ^= 0x01;
			await assertLayoutRejects(bytes, /data descriptor.*central record/iu);
		}
	}
});

test('truncated descriptors reject even when archive end records remain exact', async () => {
	const source = await archiveBytes(await writeArchive(classicDescriptorOptions()));
	const central = findSignature(source, CENTRAL_SIGNATURE);
	const bytes = removeByte(source, central - 1);
	const shiftedEnd = findLastSignature(bytes, END_SIGNATURE);
	dataView(bytes).setUint32(shiftedEnd + 16, central - 1, true);
	await assertLayoutRejects(bytes, /data descriptor.*central record/iu);
});

test('STORE fields and entry ranges reject before reaching the central directory', async (context) => {
	const source = await archiveBytes(await writeArchive(classicDescriptorOptions()));
	await context.test('non-STORE central method', async () => {
		const bytes = source.slice();
		const central = findSignature(bytes, CENTRAL_SIGNATURE);
		dataView(bytes).setUint16(central + 10, 8, true);
		await assertLayoutRejects(bytes, /must use STORE/iu);
	});
	await context.test('payload into central directory', async () => {
		const bytes = source.slice();
		const central = findSignature(bytes, CENTRAL_SIGNATURE);
		dataView(bytes).setUint32(central + 20, 20, true);
		dataView(bytes).setUint32(central + 24, 20, true);
		await assertLayoutRejects(bytes, /data crosses the central directory/iu);
	});
});

test('raw Scape layout fails closed when a descriptor has two valid interpretations', () => {
	const bytes = new Uint8Array(16);
	const view = dataView(bytes);
	for (let offset = 0; offset < bytes.byteLength; offset += 4) {
		view.setUint32(offset, DATA_DESCRIPTOR_SIGNATURE, true);
	}
	assert.throws(() => resolveScapeDataDescriptorLength(bytes, {
		crc32: DATA_DESCRIPTOR_SIGNATURE,
		compressedSize: DATA_DESCRIPTOR_SIGNATURE,
		uncompressedSize: DATA_DESCRIPTOR_SIGNATURE,
		zip64: false,
	}), /ambiguous/iu);
});

test('an unsigned descriptor CRC equal to the optional signature remains unambiguous', () => {
	const bytes = new Uint8Array(16);
	const view = dataView(bytes);
	view.setUint32(0, DATA_DESCRIPTOR_SIGNATURE, true);
	view.setUint32(4, 3, true);
	view.setUint32(8, 3, true);
	view.setUint32(12, 99, true);
	assert.equal(resolveScapeDataDescriptorLength(bytes, {
		crc32: DATA_DESCRIPTOR_SIGNATURE,
		compressedSize: 3,
		uncompressedSize: 3,
		zip64: false,
	}), 12);
});

test('canonical export estimation shares the raw central-directory byte ceiling', () => {
	assert.equal(SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES, 33 * 1024 * 1024);
	assert.equal(SCAPE_STORE_CENTRAL_RECORD_OVERHEAD_BYTES, 119);
	assert.ok(SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES
		>= SCAPE_ARCHIVE_LIMITS.maximumManifestBytes
			+ SCAPE_ARCHIVE_LIMITS.maximumEntryCount * SCAPE_STORE_CENTRAL_RECORD_OVERHEAD_BYTES);
	const longName = 'x'.repeat(8_400);
	const entries = Array.from(
		{ length: 4_096 },
		() => ({ filename: longName, payloadBytes: 0 }),
	);
	assert.throws(() => maximumScapeStoreCentralDirectoryBytes(entries), /central directory.*portable byte limit/iu);
	assert.throws(() => maximumScapeStoreArchiveBytes(entries), /central directory.*portable byte limit/iu);
	assert.ok(SCAPE_MAXIMUM_LAYOUT_READ_BYTES < SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES);
});

test('raw Scape validation checks cancellation between bounded Blob range reads', async () => {
	const archive = await writeNamedArchive('x'.repeat(65_535));
	const originalArrayBuffer = Blob.prototype.arrayBuffer;
	const readSizes: number[] = [];
	try {
		Blob.prototype.arrayBuffer = async function arrayBuffer() {
			readSizes.push(this.size);
			return await Reflect.apply(originalArrayBuffer, this, []) as ArrayBuffer;
		};
		await validateScapeArchiveLayout(archive);
	} finally {
		Blob.prototype.arrayBuffer = originalArrayBuffer;
	}
	assert.ok(readSizes.length > 3);
	assert.ok(readSizes.every((size) => size <= SCAPE_MAXIMUM_LAYOUT_READ_BYTES));

	const controller = new AbortController();
	let reads = 0;
	try {
		Blob.prototype.arrayBuffer = async function arrayBuffer() {
			const result = await Reflect.apply(originalArrayBuffer, this, []) as ArrayBuffer;
			reads += 1;
			if (reads === 1) controller.abort();
			return result;
		};
		await assert.rejects(validateScapeArchiveLayout(archive, controller.signal), { name: 'AbortError' });
	} finally {
		Blob.prototype.arrayBuffer = originalArrayBuffer;
	}
	assert.equal(reads, 1);
});

test('default archive-reader validation rejects offsets that zip.js repairs', async () => {
	const bytes = await archiveBytes(await writeArchive(classicDescriptorOptions()));
	const view = dataView(bytes);
	const end = findLastSignature(bytes, END_SIGNATURE);
	view.setUint32(end + 16, view.getUint32(end + 16, true) + 1, true);
	const archive = new Blob([exactArrayBuffer(bytes)]);
	const permissiveReader = new ZipReader(new BlobReader(archive), { useWebWorkers: false, strictness: 'strict' });
	assert.equal((await permissiveReader.getEntries()).length, 1);
	await permissiveReader.close();
	let actionCalled = false;
	await assert.rejects(withScapeArchiveReader(archive, undefined, async () => {
		actionCalled = true;
	}), /central-directory boundary/iu);
	assert.equal(actionCalled, false);
});

test('synthetic archive-reader factories remain independent of raw Blob validation', async () => {
	let enumerated = false;
	const value = await withScapeArchiveReader(new Blob(['not a ZIP']), undefined, async (entries) => {
		assert.deepEqual(entries, []);
		return 42;
	}, () => ({
		async *getEntriesGenerator() {
			enumerated = true;
			return false;
		},
		async close() {},
	}));
	assert.equal(value, 42);
	assert.equal(enumerated, true);
});

interface ArchiveOptions {
	readonly dataDescriptor: boolean;
	readonly dataDescriptorSignature: boolean;
	readonly zip64: boolean;
}

function classicDescriptorOptions(): ArchiveOptions {
	return { zip64: false, dataDescriptor: true, dataDescriptorSignature: true };
}

function zip64DescriptorOptions(): ArchiveOptions {
	return { zip64: true, dataDescriptor: true, dataDescriptorSignature: true };
}

async function writeArchive(options: ArchiveOptions): Promise<Blob> {
	return writeNamedArchive('entry.bin', options);
}

async function writeNamedArchive(
	filename: string,
	options: ArchiveOptions = classicDescriptorOptions(),
): Promise<Blob> {
	const writer = new ZipWriter(new BlobWriter('application/zip'), {
		...options,
		extendedTimestamp: options.zip64,
		level: 0,
		useWebWorkers: false,
	});
	await writer.add(filename, new Uint8ArrayReader(Uint8Array.of(1, 2, 3)), {
		level: 0,
		zip64: options.zip64,
	});
	return await writer.close(undefined, { zip64: options.zip64 }) as Blob;
}

async function writePayloadArchive(payload: Uint8Array, options: ArchiveOptions): Promise<Blob> {
	const writer = new ZipWriter(new BlobWriter('application/zip'), {
		...options,
		extendedTimestamp: options.zip64,
		level: 0,
		useWebWorkers: false,
	});
	await writer.add('entry.bin', new Uint8ArrayReader(payload), { level: 0, zip64: options.zip64 });
	return await writer.close(undefined, { zip64: options.zip64 }) as Blob;
}

async function writeEntriesArchive(filenames: readonly string[]): Promise<Blob> {
	const options = classicDescriptorOptions();
	const writer = new ZipWriter(new BlobWriter('application/zip'), {
		...options,
		extendedTimestamp: false,
		level: 0,
		useWebWorkers: false,
	});
	for (const filename of filenames) {
		await writer.add(filename, new Uint8ArrayReader(Uint8Array.of(1, 2, 3)), { level: 0, zip64: false });
	}
	return await writer.close(undefined, { zip64: false }) as Blob;
}

async function writeStreamArchive(): Promise<Blob> {
	const options = zip64DescriptorOptions();
	const writer = new ZipWriter(new BlobWriter('application/zip'), {
		...options,
		extendedTimestamp: true,
		level: 0,
		useWebWorkers: false,
	});
	await writer.add('stream.bin', new Blob([Uint8Array.of(1, 2, 3)]).stream(), {
		level: 0,
		zip64: true,
	});
	return await writer.close(undefined, { zip64: true }) as Blob;
}

async function archiveBytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}

function dataView(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function assertLayoutRejects(bytes: Uint8Array, pattern: RegExp): Promise<void> {
	await assert.rejects(
		validateScapeArchiveLayout(new Blob([exactArrayBuffer(bytes)])),
		pattern,
	);
}

function findSignature(bytes: Uint8Array, signature: number): number {
	const view = dataView(bytes);
	for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
		if (view.getUint32(offset, true) === signature) return offset;
	}
	throw new Error(`ZIP signature ${signature.toString(16)} was not found.`);
}

function findLastSignature(bytes: Uint8Array, signature: number): number {
	const view = dataView(bytes);
	for (let offset = bytes.byteLength - 4; offset >= 0; offset -= 1) {
		if (view.getUint32(offset, true) === signature) return offset;
	}
	throw new Error(`ZIP signature ${signature.toString(16)} was not found.`);
}

function centralRecordOffsets(bytes: Uint8Array): number[] {
	const offsets: number[] = [];
	const view = dataView(bytes);
	for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1) {
		if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) continue;
		offsets.push(offset);
		offset += 45
			+ view.getUint16(offset + 28, true)
			+ view.getUint16(offset + 30, true)
			+ view.getUint16(offset + 32, true);
	}
	return offsets;
}

function insertGapBeforeSecondLocalEntry(source: Uint8Array): Uint8Array {
	const sourceRecords = centralRecordOffsets(source);
	const sourceView = dataView(source);
	const secondOffset = sourceView.getUint32((sourceRecords[1] as number) + 42, true);
	const bytes = new Uint8Array(source.byteLength + 1);
	bytes.set(source.subarray(0, secondOffset), 0);
	bytes[secondOffset] = 0;
	bytes.set(source.subarray(secondOffset), secondOffset + 1);
	const records = centralRecordOffsets(bytes);
	dataView(bytes).setUint32((records[1] as number) + 42, secondOffset + 1, true);
	const end = findLastSignature(bytes, END_SIGNATURE);
	dataView(bytes).setUint32(end + 16, sourceView.getUint32(findLastSignature(source, END_SIGNATURE) + 16, true) + 1, true);
	return bytes;
}

function removeByte(source: Uint8Array, offset: number): Uint8Array {
	const bytes = new Uint8Array(source.byteLength - 1);
	bytes.set(source.subarray(0, offset), 0);
	bytes.set(source.subarray(offset + 1), offset);
	return bytes;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

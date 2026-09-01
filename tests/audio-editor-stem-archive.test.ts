/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createSevenZipStemArchivePlan,
	createStemArchivePlan,
	createStreamingStemArchive,
} from '../src/common/editor/controller/stem-archive.ts';
import {
	EMPTY_ZIP32_LAYOUT,
	extendZip32Layout,
	inspectZip32Layout,
	ZIP32_UINT16_SENTINEL,
	ZIP32_UINT32_SENTINEL,
} from '../src/common/editor/controller/zip32.ts';
import { createStreamingZipArchive } from '../src/common/editor/controller/temporary-export.ts';
import {
	SEVEN_ZIP_COPY_GOLDEN_BASE64,
	SEVEN_ZIP_COPY_GOLDEN_SHA256,
} from './fixtures/seven-zip-copy-golden.ts';

const copy = {
	temporaryExportClosed: 'temporary export closed',
	largeStemsStorageRequired: 'large stems require storage',
	stemArchiveClosed: 'stem archive closed',
};

async function withMemoryStorage<Value>(callback: () => Promise<Value>): Promise<Value> {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: {} } });
	try {
		return await callback();
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
}

test('ZIP32 layout uses exact streaming-store overhead and excludes every sentinel value', () => {
	assert.deepEqual(inspectZip32Layout([{ fileName: 'a', byteLength: 3 }]), {
		eligible: true,
		entryCount: 1,
		localByteLength: 50,
		centralDirectoryByteLength: 47,
		archiveByteLength: 119,
	});
	const nameBeforeLimit = 'x'.repeat(ZIP32_UINT16_SENTINEL - 1);
	assert.equal(inspectZip32Layout([{ fileName: nameBeforeLimit, byteLength: 1 }]).eligible, true);
	assert.equal(inspectZip32Layout([{ fileName: `${nameBeforeLimit}x`, byteLength: 1 }]).eligible, false);
	assert.equal(inspectZip32Layout([{
		fileName: 'a',
		byteLength: ZIP32_UINT32_SENTINEL,
	}]).eligible, false);

	const localBoundary = extendZip32Layout({
		...EMPTY_ZIP32_LAYOUT,
		localByteLength: ZIP32_UINT32_SENTINEL - 47,
		archiveByteLength: ZIP32_UINT32_SENTINEL - 25,
	}, { fileName: 'a', byteLength: 0 });
	assert.equal(localBoundary.localByteLength, ZIP32_UINT32_SENTINEL);
	assert.equal(localBoundary.eligible, false);
	const centralBoundary = extendZip32Layout({
		...EMPTY_ZIP32_LAYOUT,
		centralDirectoryByteLength: ZIP32_UINT32_SENTINEL - 47,
		archiveByteLength: ZIP32_UINT32_SENTINEL - 25,
	}, { fileName: 'a', byteLength: 0 });
	assert.equal(centralBoundary.centralDirectoryByteLength, ZIP32_UINT32_SENTINEL);
	assert.equal(centralBoundary.eligible, false);
	const countBoundary = extendZip32Layout({
		...EMPTY_ZIP32_LAYOUT,
		entryCount: ZIP32_UINT16_SENTINEL - 1,
	}, { fileName: 'a', byteLength: 0 });
	assert.equal(countBoundary.entryCount, ZIP32_UINT16_SENTINEL);
	assert.equal(countBoundary.eligible, false);
});

test('stem archive planning keeps exact small exports in ZIP and routes ZIP32 overflow to 7z', () => {
	const zip = createStemArchivePlan('session.zip', [
		{ fileName: 'lead.wav', expectedByteLength: 10 },
		{ fileName: 'drums.wav', expectedByteLength: 20 },
	]);
	assert.equal(zip.format, 'zip');
	assert.equal(zip.fileName, 'session.zip');
	assert.equal(zip.expectedByteLength, 270);
	assert.equal(zip.requiredTemporaryBytes, 290);

	const sevenZip = createStemArchivePlan('session', [{
		fileName: 'lead.wav',
		expectedByteLength: ZIP32_UINT32_SENTINEL,
	}]);
	assert.equal(sevenZip.format, '7z');
	assert.equal(sevenZip.fileName, 'session.7z');
	assert.equal(sevenZip.mimeType, 'application/x-7z-compressed');
	assert.equal(sevenZip.expectedByteLength! > ZIP32_UINT32_SENTINEL, true);
	assert.equal(sevenZip.requiredTemporaryBytes! > sevenZip.expectedByteLength!, true);

	const unknown = createStemArchivePlan('encoded', [
		{ fileName: 'lead.flac', expectedByteLength: null },
	], 123_456);
	assert.equal(unknown.format, 'zip');
	assert.equal(unknown.expectedByteLength, null);
	assert.equal(unknown.requiredTemporaryBytes, 123_456);
	assert.equal(unknown.fallbackRequiredTemporaryBytes, 123_456);
	assert.equal(unknown.zip32, null);
	assert.throws(
		() => createStemArchivePlan('session', [
			{ fileName: 'same.wav', expectedByteLength: 1 },
			{ fileName: 'same.wav', expectedByteLength: 2 },
		]),
		/Duplicate stem archive entry/u,
	);
	assert.throws(
		() => createStemArchivePlan('session', [{ fileName: '../lead.wav', expectedByteLength: 1 }]),
		/must be flat/u,
	);
	assert.throws(
		() => createStemArchivePlan('../session', [{ fileName: 'lead.wav', expectedByteLength: 1 }]),
		/base names must be flat/u,
	);
});

test('streaming 7z Copy archives contain deterministic streams, CRCs, folders, and UTF-16LE names', async () => {
	await withMemoryStorage(async () => {
		const plan = createSevenZipStemArchivePlan('session', [
			{ fileName: 'lead.wav', expectedByteLength: 3 },
			{ fileName: 'Bäs.wav', expectedByteLength: 2 },
		]);
		const archive = await createStreamingStemArchive(plan, copy);
		await archive.add('lead.wav', new Blob([Uint8Array.of(1, 2, 3)]));
		await archive.add('Bäs.wav', new DataView(Uint8Array.of(4, 5).buffer));
		const first = await archive.finish();
		const second = await archive.finish();
		assert.equal(first, second);
		assert.equal(first.blob.type, 'application/x-7z-compressed');
		assert.equal(first.blob.size, plan.expectedByteLength);
		const bytes = new Uint8Array(await first.blob.arrayBuffer());
		assert.deepEqual(Array.from(bytes.subarray(0, 8)), [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]);
		assert.equal(readUint32(bytes, 8), crc32(bytes.subarray(12, 32)));
		assert.equal(readUint64(bytes, 12), 5);
		const nextHeaderSize = readUint64(bytes, 20);
		const nextHeader = bytes.subarray(37, 37 + nextHeaderSize);
		assert.equal(readUint32(bytes, 28), crc32(nextHeader));
		assert.deepEqual(Array.from(bytes.subarray(32, 37)), [1, 2, 3, 4, 5]);
		assertSevenZipNextHeader(nextHeader, [
			{ name: 'lead.wav', size: 3, checksum: crc32(Uint8Array.of(1, 2, 3)) },
			{ name: 'Bäs.wav', size: 2, checksum: crc32(Uint8Array.of(4, 5)) },
		]);
		assert.deepEqual(bytes, new Uint8Array(Buffer.from(SEVEN_ZIP_COPY_GOLDEN_BASE64, 'base64')));
		assert.equal(
			createHash('sha256').update(bytes).digest('hex'),
			SEVEN_ZIP_COPY_GOLDEN_SHA256,
		);
		await first.cleanup();
	});
});

test('planned archives enforce ordered names, exact sizes, completion, and cancellation', async () => {
	await withMemoryStorage(async () => {
		const plan = createSevenZipStemArchivePlan('session', [
			{ fileName: 'first.wav', expectedByteLength: 1 },
		]);
		const archive = await createStreamingStemArchive(plan, copy);
		await assert.rejects(() => archive.add('wrong.wav', Uint8Array.of(1)), /Unexpected stem/u);
		await assert.rejects(() => archive.add('first.wav', Uint8Array.of(1, 2)), /size does not match/u);
		await archive.add('first.wav', Uint8Array.of(1));
		await archive.finish();
		await assert.rejects(() => archive.add('first.wav', Uint8Array.of(1)), /stem archive closed/u);

		const incomplete = await createStreamingStemArchive(plan, copy);
		await assert.rejects(() => incomplete.finish(), /missing one or more/u);

		const mismatchedStream = await createStreamingStemArchive(
			createSevenZipStemArchivePlan('session', [{ fileName: 'virtual.wav', expectedByteLength: 2 }]),
			copy,
		);
		const virtualBlob = new Blob([Uint8Array.of(1)]);
		Object.defineProperty(virtualBlob, 'size', { configurable: true, value: 2 });
		await assert.rejects(
			() => mismatchedStream.add('virtual.wav', virtualBlob),
			/stream size does not match/u,
		);
		await assert.rejects(() => mismatchedStream.finish(), /stream size does not match/u);

		const cancelled = await createStreamingStemArchive(plan, copy);
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(
			() => cancelled.add('first.wav', Uint8Array.of(1), controller.signal),
			(error: Error) => error.name === 'AbortError',
		);
		await assert.rejects(() => cancelled.finish(), /Abort/u);
		await cancelled.abort();
		await cancelled.abort();

		const midRead = await createStreamingStemArchive(
			createSevenZipStemArchivePlan('session', [{ fileName: 'stream.wav', expectedByteLength: 2 }]),
			copy,
		);
		const midReadController = new AbortController();
		let readerCancelled = false;
		const midReadBlob = new Blob([Uint8Array.of(1, 2)]);
		Object.defineProperty(midReadBlob, 'stream', {
			configurable: true,
			value: () => ({
				getReader: () => ({
					async read() {
						midReadController.abort();
						return { done: false, value: Uint8Array.of(1) };
					},
					async cancel() { readerCancelled = true; },
					releaseLock() {},
				}),
			}),
		});
		await assert.rejects(
			() => midRead.add('stream.wav', midReadBlob, midReadController.signal),
			(error: Error) => error.name === 'AbortError',
		);
		assert.equal(readerCancelled, true);
	});
});

test('7z startup write failures abort and remove partial OPFS files', async () => {
	const events: string[] = [];
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			storage: {
				getDirectory: async () => ({
					getDirectoryHandle: async () => ({
						getFileHandle: async () => ({
							createWritable: async () => ({
								async write() { events.push('write'); throw new Error('OPFS write failed'); },
								async abort() { events.push('abort'); },
							}),
						}),
						async removeEntry() { events.push('remove'); },
					}),
				}),
			},
		},
	});
	try {
		const plan = createStemArchivePlan('session', [{
			fileName: 'lead.wav',
			expectedByteLength: ZIP32_UINT32_SENTINEL,
		}]);
		await assert.rejects(() => createStreamingStemArchive(plan, copy), /OPFS write failed/u);
		assert.deepEqual(events, ['write', 'abort', 'remove']);
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
});

test('nullable ZIP plans enforce order while accepting runtime entry sizes', async () => {
	await withMemoryStorage(async () => {
		const plan = createStemArchivePlan('encoded', [
			{ fileName: 'lead.flac', expectedByteLength: null },
			{ fileName: 'drums.flac', expectedByteLength: null },
		]);
		const archive = await createStreamingStemArchive(plan, copy);
		await assert.rejects(() => archive.add('drums.flac', Uint8Array.of(1)), /Unexpected stem/u);
		await archive.add('lead.flac', Uint8Array.of(1));
		await archive.add('drums.flac', Uint8Array.of(2, 3));
		const { blob } = await archive.finish();
		assert.equal(blob.type, 'application/zip');
		assert.deepEqual(Array.from(new Uint8Array(await blob.arrayBuffer()).subarray(0, 4)), [0x50, 0x4b, 3, 4]);
	});
});

test('nullable ZIP plans preserve the fallback memory-storage threshold', async () => {
	await withMemoryStorage(async () => {
		const plan = createStemArchivePlan(
			'encoded',
			[{ fileName: 'lead.flac', expectedByteLength: null }],
			97 * 1024 ** 2,
		);
		await assert.rejects(() => createStreamingStemArchive(plan, copy), /large stems require storage/u);
	});
});

test('ZIP stem failures retain the write error when disposable sink cleanup also fails', async () => {
	const primary = new Error('OPFS stem write failed');
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			storage: {
				getDirectory: async () => ({
					getDirectoryHandle: async () => ({
						getFileHandle: async () => ({
							createWritable: async () => ({
								async write() { throw primary; },
								async abort() { throw new Error('OPFS abort cleanup failed'); },
							}),
						}),
						async removeEntry() { throw new Error('OPFS remove cleanup failed'); },
					}),
				}),
			},
		},
	});
	try {
		const plan = createStemArchivePlan('session', [{
			fileName: 'lead.wav', expectedByteLength: 1,
		}]);
		const archive = await createStreamingStemArchive(plan, copy);
		await assert.rejects(() => archive.add('lead.wav', Uint8Array.of(1)),
			(error: unknown) => error === primary);
		await assert.rejects(() => archive.finish(),
			(error: unknown) => error === primary);
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
});

test('native stem plans require persistent storage when archive plus staging exceeds the memory limit', async () => {
	await withMemoryStorage(async () => {
		const plan = createStemArchivePlan('session', [{
			fileName: 'lead.wav',
			expectedByteLength: 50 * 1024 ** 2,
		}]);
		assert.equal(plan.expectedByteLength! < 96 * 1024 ** 2, true);
		assert.equal(plan.requiredTemporaryBytes! > 96 * 1024 ** 2, true);
		await assert.rejects(
			() => createStreamingStemArchive(plan, copy),
			/large stems require storage/u,
		);
	});
});

test('legacy streaming ZIP rejects an entry before a ZIP32 sentinel is written', async () => {
	await withMemoryStorage(async () => {
		const archive = await createStreamingZipArchive('too-large.zip', 0, copy);
		const virtualBlob = new Blob([Uint8Array.of(1)]);
		Object.defineProperty(virtualBlob, 'size', { configurable: true, value: ZIP32_UINT32_SENTINEL });
		await assert.rejects(() => archive.add('huge.wav', virtualBlob), /ZIP32 limits exceeded/u);
		await assert.rejects(() => archive.finish(), /ZIP32 limits exceeded/u);
		await archive.abort();
	});
});

interface ExpectedSevenZipEntry {
	readonly name: string;
	readonly size: number;
	readonly checksum: number;
}

function assertSevenZipNextHeader(bytes: Uint8Array, entries: readonly ExpectedSevenZipEntry[]): void {
	let offset = 0;
	const byte = (expected: number) => assert.equal(bytes[offset++], expected);
	byte(0x01);
	byte(0x04);
	byte(0x06);
	let decoded = readNumber(bytes, offset);
	assert.equal(decoded.value, 0);
	offset = decoded.offset;
	decoded = readNumber(bytes, offset);
	assert.equal(decoded.value, entries.length);
	offset = decoded.offset;
	byte(0x09);
	for (const entry of entries) {
		decoded = readNumber(bytes, offset);
		assert.equal(decoded.value, entry.size);
		offset = decoded.offset;
	}
	byte(0x0a);
	byte(1);
	for (const entry of entries) {
		assert.equal(readUint32(bytes, offset), entry.checksum);
		offset += 4;
	}
	byte(0);
	byte(0x07);
	byte(0x0b);
	decoded = readNumber(bytes, offset);
	assert.equal(decoded.value, entries.length);
	offset = decoded.offset;
	byte(0);
	for (const _entry of entries) {
		decoded = readNumber(bytes, offset);
		assert.equal(decoded.value, 1);
		offset = decoded.offset;
		byte(1);
		byte(0);
	}
	byte(0x0c);
	for (const entry of entries) {
		decoded = readNumber(bytes, offset);
		assert.equal(decoded.value, entry.size);
		offset = decoded.offset;
	}
	byte(0x0a);
	byte(1);
	for (const entry of entries) {
		assert.equal(readUint32(bytes, offset), entry.checksum);
		offset += 4;
	}
	byte(0);
	byte(0x08);
	byte(0);
	byte(0);
	byte(0x05);
	decoded = readNumber(bytes, offset);
	assert.equal(decoded.value, entries.length);
	offset = decoded.offset;
	byte(0x11);
	decoded = readNumber(bytes, offset);
	const nameBytes = 1 + entries.reduce((sum, entry) => sum + 2 * (entry.name.length + 1), 0);
	assert.equal(decoded.value, nameBytes);
	offset = decoded.offset;
	byte(0);
	for (const entry of entries) {
		for (let index = 0; index < entry.name.length; index += 1) {
			assert.equal(bytes[offset++]! | (bytes[offset++]! << 8), entry.name.charCodeAt(index));
		}
		byte(0);
		byte(0);
	}
	byte(0);
	byte(0);
	assert.equal(offset, bytes.byteLength);
}

function readNumber(bytes: Uint8Array, offset: number): { readonly value: number; readonly offset: number } {
	const first = bytes[offset++]!;
	let mask = 0x80;
	let value = 0n;
	for (let additionalBytes = 0; additionalBytes < 8; additionalBytes += 1) {
		if ((first & mask) === 0) {
			value |= BigInt(first & (mask - 1)) << BigInt(8 * additionalBytes);
			return { value: Number(value), offset };
		}
		value |= BigInt(bytes[offset++]!) << BigInt(8 * additionalBytes);
		mask >>>= 1;
	}
	return { value: Number(value), offset };
}

function readUint32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function readUint64(bytes: Uint8Array, offset: number): number {
	return Number(new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true));
}

function crc32(bytes: Uint8Array): number {
	let checksum = 0xffff_ffff;
	for (const byte of bytes) {
		checksum ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb8_8320 : 0);
		}
	}
	return (checksum ^ 0xffff_ffff) >>> 0;
}

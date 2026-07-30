/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BlobWriter,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipWriter,
} from '@zip.js/zip.js';

import {
	SCAPE_ARCHIVE_BYTE_SOURCE_MAXIMUM_READ_BYTES,
	createBlobScapeArchiveByteSource,
	createScapeArchiveByteSource,
} from '../src/common/editor/scape-archive-byte-source.ts';
import {
	validateScapeArchiveByteSourceLayout,
	validateScapeArchiveLayout,
} from '../src/common/editor/scape-archive-layout.ts';
import { SCAPE_MAXIMUM_STRUCTURAL_WITNESS_BYTES } from '../src/common/editor/scape-archive-layout-witness.ts';
import {
	withScapeArchiveByteSource,
	withScapeArchiveReader,
} from '../src/common/editor/scape-archive-reader.ts';

const END_SIGNATURE = 0x06054b50;
const END_MAXIMUM_BYTES = 22 + 0xffff;

test('structural witnesses retain only the canonical writer profile', () => {
	assert.equal(SCAPE_MAXIMUM_STRUCTURAL_WITNESS_BYTES, 69_271_649);
});

test('bounded byte-source archive reads preserve Blob entry metadata and bodies', async () => {
	const archive = await writeArchive();
	const fromBlob = await readEntries((action) => withScapeArchiveReader(
		archive,
		undefined,
		action,
	));
	const archiveBytes = new Uint8Array(await archive.arrayBuffer());
	const providerReadLengths: number[] = [];
	const source = createScapeArchiveByteSource({
		size: archiveBytes.byteLength,
		maximumReadBytes: 7,
		read: ({ offset, length }) => {
			providerReadLengths.push(length);
			return archiveBytes.slice(offset, offset + length);
		},
	});
	const fromSource = await readEntries((action) => withScapeArchiveByteSource(
		source,
		undefined,
		action,
	));

	assert.deepEqual(fromSource, fromBlob);
	assert.ok(providerReadLengths.length > 10);
	assert.ok(providerReadLengths.every((length) => length <= 7));
	assert.ok(providerReadLengths.every((length) => length < archive.size));
});

test('overlap-only checks do not prefetch from the start of a large leading entry', async () => {
	const firstBody = new Uint8Array(4 * 1024 ** 2 + 1);
	const trailingName = 'tail.bin';
	const writer = new ZipWriter(new BlobWriter('application/zip'), {
		dataDescriptor: true,
		extendedTimestamp: false,
		level: 0,
		useWebWorkers: false,
	});
	await writer.add('large.bin', new Uint8ArrayReader(firstBody), { level: 0 });
	await writer.add(trailingName, new Uint8ArrayReader(Uint8Array.of(1)), { level: 0 });
	const archive = await writer.close() as Blob;
	const archiveBytes = new Uint8Array(await archive.arrayBuffer());
	const local = new DataView(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength);
	assert.equal(local.getUint32(0, true), 0x0403_4b50);
	const firstPayloadStart = 30 + local.getUint16(26, true) + local.getUint16(28, true);
	const firstPayloadEnd = firstPayloadStart + firstBody.byteLength;
	const ranges: Array<Readonly<{ offset: number; length: number }>> = [];
	const source = createScapeArchiveByteSource({
		size: archiveBytes.byteLength,
		read: ({ offset, length }) => {
			ranges.push(Object.freeze({ offset, length }));
			return archiveBytes.slice(offset, offset + length);
		},
	});

	await withScapeArchiveByteSource(source, undefined, async (entries) => {
		assert.equal(entries.length, 2);
		assert.equal(entries[0]?.filename, 'large.bin');
		assert.equal(entries[1]?.filename, trailingName);
		assert.equal(entries[1]?.uncompressedSize, 1);
		for (const entry of entries) {
			if (typeof entry.getData !== 'function') throw new TypeError('The ZIP entry body reader is missing.');
			await entry.getData(new WritableStream<Uint8Array>(), {
				strictness: 'strict',
				checkOverlappingEntryOnly: true,
			});
		}
	});

	assert.ok(firstBody.byteLength > 4 * 1024 ** 2);
	assert.ok(ranges.length > 0);
	const firstPayloadUnavoidableSuffix = firstPayloadEnd - END_MAXIMUM_BYTES;
	assert.equal(ranges.some(({ offset, length }) => (
		offset < firstPayloadUnavoidableSuffix && offset + length > firstPayloadStart
	)), false, `overlap-only checks never prefetch before the unavoidable EOCD-search suffix: ${JSON.stringify(ranges)}`);
});

test('byte sources reject invalid ranges and inexact provider results before publication', async () => {
	let providerReads = 0;
	const short = createScapeArchiveByteSource({
		size: 8,
		read: ({ length }) => {
			providerReads += 1;
			return new Uint8Array(Math.max(0, length - 1));
		},
	});

	await assert.rejects(
		short.read({ offset: 0, length: 4 }),
		/incomplete byte range/iu,
	);
	assert.equal(providerReads, 1);
	await assert.rejects(
		short.read({ offset: 7, length: 2 }),
		/invalid byte range/iu,
	);
	await assert.rejects(
		short.read({
			offset: 0,
			length: SCAPE_ARCHIVE_BYTE_SOURCE_MAXIMUM_READ_BYTES + 1,
		}),
		/unbounded byte range/iu,
	);
	assert.equal(providerReads, 1);
	assert.throws(
		() => createScapeArchiveByteSource({ size: Number.MAX_SAFE_INTEGER + 1, read: () => new Uint8Array() }),
		/safe non-negative size/iu,
	);
	assert.throws(
		() => createScapeArchiveByteSource({ size: 1, maximumReadBytes: 0, read: () => new Uint8Array() }),
		/safe positive integer/iu,
	);
	assert.throws(
		() => createScapeArchiveByteSource({
			size: 1,
			maximumReadBytes: SCAPE_ARCHIVE_BYTE_SOURCE_MAXIMUM_READ_BYTES + 1,
			read: () => new Uint8Array(),
		}),
		/exceeds its hard limit/iu,
	);
});

test('byte sources measure and copy provider bytes through native typed-array slots', async () => {
	class ForgedLengthBytes extends Uint8Array {
		override get byteLength(): number {
			return 4;
		}
	}
	const source = createScapeArchiveByteSource({
		size: 4,
		read: () => new ForgedLengthBytes([1, 2, 3]),
	});

	await assert.rejects(
		source.read({ offset: 0, length: 4 }),
		/incomplete byte range/iu,
	);
	const proxied = createScapeArchiveByteSource({
		size: 3,
		read: () => new Proxy(Uint8Array.of(1, 2, 3), {}),
	});
	await assert.rejects(
		proxied.read({ offset: 0, length: 3 }),
		/non-byte range/iu,
	);
	const providerBytes = Uint8Array.of(1, 2, 3);
	const copied = createScapeArchiveByteSource({
		size: providerBytes.byteLength,
		read: () => providerBytes,
	});
	const result = await copied.read({ offset: 0, length: providerBytes.byteLength });
	providerBytes.fill(9);
	assert.deepEqual(result, Uint8Array.of(1, 2, 3));
});

test('byte-source cancellation is prompt and exact without provider cooperation', async () => {
	let providerReads = 0;
	let settle: ((bytes: Uint8Array) => void) | undefined;
	const pending = new Promise<Uint8Array>((resolve) => { settle = resolve; });
	const source = createScapeArchiveByteSource({
		size: 4,
		read: () => {
			providerReads += 1;
			return pending;
		},
	});
	assert.deepEqual(await source.read({ offset: 4, length: 0 }), new Uint8Array());
	assert.equal(providerReads, 0);
	const controller = new AbortController();
	const reason = new Error('stop pending byte read');
	const operation = source.read({ offset: 0, length: 4, signal: controller.signal });
	controller.abort(reason);
	await assert.rejects(operation, (error: unknown) => error === reason);
	assert.equal(providerReads, 1);
	settle?.(Uint8Array.of(1, 2, 3, 4));
});

test('Blob byte sources use captured platform size and slice operations', async () => {
	class HostileBlob extends Blob {
		override get size(): number {
			throw new Error('hostile size override');
		}

		override slice(): Blob {
			throw new Error('hostile slice override');
		}

		override async arrayBuffer(): Promise<ArrayBuffer> {
			throw new Error('hostile arrayBuffer override');
		}
	}
	const source = createBlobScapeArchiveByteSource(new HostileBlob([Uint8Array.of(1, 2, 3)]));

	assert.equal(source.size, 3);
	assert.deepEqual(await source.read({ offset: 1, length: 2 }), Uint8Array.of(2, 3));
});

test('archive parsing cannot replace the structurally admitted byte-source view', async () => {
	const firstBody = new Uint8Array(256 * 1024);
	const admitted = new Uint8Array(await (await writeArchive('first.bin', firstBody)).arrayBuffer());
	const replaced = new Uint8Array(await (await writeArchive('other.bin', firstBody)).arrayBuffer());
	assert.equal(replaced.byteLength, admitted.byteLength);
	const centralOffset = classicCentralOffset(admitted);
	let replacementActive = false;
	const replacementReads: Array<Readonly<{ length: number; offset: number }>> = [];
	const source = createScapeArchiveByteSource({
		size: admitted.byteLength,
		read: ({ offset, length }) => {
			const bytes = replacementActive ? replaced : admitted;
			if (replacementActive) replacementReads.push({ length, offset });
			const result = bytes.slice(offset, offset + length);
			if (offset < centralOffset && offset + length === centralOffset) replacementActive = true;
			return result;
		},
	});

	const entries = await readEntries((action) => withScapeArchiveByteSource(source, undefined, action));
	assert.deepEqual(entries.map((entry) => entry.filename), ['first.bin', 'second.bin']);
	assert.equal(entries[0]?.body.length, firstBody.byteLength);
	assert.ok(replacementReads.length > 0);
	const witnessedTailOffset = admitted.byteLength - END_MAXIMUM_BYTES;
	assert.ok(replacementReads.every(({ offset, length }) => offset + length <= witnessedTailOffset));
});

test('structural admission rejects inconsistent overlapping provider observations', async () => {
	const admitted = new Uint8Array(await (await writeArchive()).arrayBuffer());
	const replaced = new Uint8Array(await (await writeArchive('other.bin')).arrayBuffer());
	let reads = 0;
	let actionCalled = false;
	const source = createScapeArchiveByteSource({
		size: admitted.byteLength,
		read: ({ offset, length }) => {
			reads += 1;
			const bytes = reads === 1 ? admitted : replaced;
			return bytes.slice(offset, offset + length);
		},
	});

	await assert.rejects(
		withScapeArchiveByteSource(source, undefined, async () => {
			actionCalled = true;
		}),
		/changed during structural validation/iu,
	);
	assert.equal(actionCalled, false);
});

test('structural admission retains central-entry comments outside the ZIP tail', async () => {
	const firstComment = 'a'.repeat(40_000);
	const admitted = new Uint8Array(await (await writeCommentedArchive(firstComment)).arrayBuffer());
	const replaced = new Uint8Array(await (await writeCommentedArchive('b'.repeat(40_000))).arrayBuffer());
	assert.equal(replaced.byteLength, admitted.byteLength);
	assert.ok(admitted.byteLength > 65_557);
	const centralOffset = classicCentralOffset(admitted);
	let replacementActive = false;
	const source = createScapeArchiveByteSource({
		size: admitted.byteLength,
		read: ({ offset, length }) => {
			const bytes = replacementActive ? replaced : admitted;
			const result = bytes.slice(offset, offset + length);
			if (offset < centralOffset && offset + length === centralOffset) replacementActive = true;
			return result;
		},
	});

	const comments = await withScapeArchiveByteSource(source, undefined, async (entries) => (
		entries.map((entry) => (entry as ScapeArchiveEntryWithComment).comment)
	));
	assert.deepEqual(comments, [firstComment, 'c'.repeat(40_000)]);
	assert.equal(replacementActive, true);
});

test('byte-source and Blob layout validation reject the same malformed archive', async () => {
	const archive = await writeArchive();
	const bytes = new Uint8Array(await archive.arrayBuffer());
	const endOffset = findLastSignature(bytes, END_SIGNATURE);
	const bytesView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	bytesView.setUint32(endOffset + 16, bytesView.getUint32(endOffset + 16, true) + 1, true);
	const malformed = new Blob([bytes]);

	const blobError = await rejectionOf(() => validateScapeArchiveLayout(malformed));
	const sourceError = await rejectionOf(() => validateScapeArchiveByteSourceLayout(
		createBlobScapeArchiveByteSource(malformed),
	));
	assert.match(String(blobError), /central-directory boundary/iu);
	assert.equal(String(sourceError), String(blobError));
});

test('byte-source layout validation stops between bounded reads with the exact abort reason', async () => {
	const archive = await writeArchive();
	const bytes = new Uint8Array(await archive.arrayBuffer());
	const controller = new AbortController();
	const reason = new Error('stop byte-source layout');
	const readLengths: number[] = [];
	const source = createScapeArchiveByteSource({
		size: bytes.byteLength,
		read: ({ offset, length }) => {
			readLengths.push(length);
			const result = bytes.slice(offset, offset + length);
			if (readLengths.length === 1) controller.abort(reason);
			return result;
		},
	});

	await assert.rejects(
		validateScapeArchiveByteSourceLayout(source, controller.signal),
		(error: unknown) => error === reason,
	);
	assert.equal(readLengths.length, 1);
});

type EntrySnapshot = Readonly<{
	filename: string;
	compressedSize: number;
	uncompressedSize: number;
	body: readonly number[];
}>;

type ScapeArchiveEntryWithComment = import('../src/common/editor/scape-archive-envelope.ts').ScapeArchiveEntry
	& Readonly<{ comment: string }>;

async function readEntries(
	read: (
		action: (entries: readonly import('../src/common/editor/scape-archive-envelope.ts').ScapeArchiveEntry[]) => Promise<EntrySnapshot[]>,
	) => Promise<EntrySnapshot[]>,
): Promise<EntrySnapshot[]> {
	return read(async (entries) => Promise.all(entries.map(async (entry) => {
		if (typeof entry.getData !== 'function') throw new TypeError('The ZIP entry body reader is missing.');
		const getData = entry.getData as unknown as (
			writer: Uint8ArrayWriter,
			options: Readonly<{ strictness: 'strict' }>,
		) => Promise<Uint8Array>;
		const body = await getData(new Uint8ArrayWriter(), { strictness: 'strict' });
		return Object.freeze({
			filename: entry.filename,
			compressedSize: entry.compressedSize,
			uncompressedSize: entry.uncompressedSize,
			body: Object.freeze([...body]),
		});
	})));
}

async function writeArchive(
	firstName = 'first.bin',
	firstBody = Uint8Array.of(1, 2, 3),
): Promise<Blob> {
	const writer = new ZipWriter(new BlobWriter('application/zip'), {
		dataDescriptor: true,
		extendedTimestamp: false,
		level: 0,
		useWebWorkers: false,
	});
	await writer.add(firstName, new Uint8ArrayReader(firstBody), { level: 0 });
	await writer.add('second.bin', new Uint8ArrayReader(Uint8Array.of(4, 5)), { level: 0 });
	return await writer.close() as Blob;
}

async function writeCommentedArchive(firstComment: string): Promise<Blob> {
	const writer = new ZipWriter(new BlobWriter('application/zip'), {
		dataDescriptor: true,
		extendedTimestamp: false,
		level: 0,
		useWebWorkers: false,
	});
	await writer.add('first.bin', new Uint8ArrayReader(Uint8Array.of(1)), {
		comment: firstComment,
		level: 0,
	});
	await writer.add('second.bin', new Uint8ArrayReader(Uint8Array.of(2)), {
		comment: 'c'.repeat(40_000),
		level: 0,
	});
	return await writer.close() as Blob;
}

async function rejectionOf(operation: () => Promise<unknown>): Promise<unknown> {
	try {
		await operation();
	} catch (error) {
		return error;
	}
	throw new Error('Expected the operation to reject.');
}

function findLastSignature(bytes: Uint8Array, signature: number): number {
	const bytesView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = bytes.byteLength - 4; offset >= 0; offset -= 1) {
		if (bytesView.getUint32(offset, true) === signature) return offset;
	}
	throw new Error('ZIP signature not found.');
}

function classicCentralOffset(bytes: Uint8Array): number {
	const endOffset = findLastSignature(bytes, END_SIGNATURE);
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(endOffset + 16, true);
}

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeBextPayload } from '../src/common/editor/broadcast-wave.ts';
import {
	inspectWavBlobPcm,
	streamWavBlobPcm,
} from '../src/common/editor/wav-import.js';

const UINT32_SENTINEL = 0xffff_ffff;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

interface ChunkFixture {
	readonly id: string;
	readonly bytes: Uint8Array;
	readonly sentinel?: boolean;
}

interface Ds64Entry {
	readonly id: string;
	readonly size: bigint;
}

interface Rf64FixtureOptions {
	readonly chunks?: readonly ChunkFixture[];
	readonly dataBytes?: Uint8Array;
	readonly formatBytes?: Uint8Array;
	readonly sampleCount?: bigint;
	readonly dataSize?: bigint;
	readonly riffSize?: bigint;
	readonly tableEntries?: readonly Ds64Entry[];
}

test('compact RF64 PCM inspects and decodes without changing the WAV descriptor shape', async () => {
	const pcm = int16Bytes([-32_768, -16_384, 0, 16_384, 32_767]);
	const blob = blobOf(createRf64Fixture({ dataBytes: pcm, sampleCount: 5n }), 'audio/wav');
	const descriptor = await inspectWavBlobPcm(blob);

	assert.equal(descriptor.container, 'wav');
	assert.equal(descriptor.sampleFormat, 'int16');
	assert.equal(descriptor.frameCount, 5);
	assert.equal(descriptor.dataOffset, 80);
	assert.equal(descriptor.dataByteLength, pcm.byteLength);
	assert.equal(descriptor.riffByteLength, blob.size);
	assert.equal(Object.hasOwn(descriptor, 'rf64'), false);

	const packets: Float32Array[][] = [];
	const result = await streamWavBlobPcm(blob, {
		descriptor,
		chunkFrames: 2,
		onChunk(channels: Float32Array[]) {
			packets.push(channels);
		},
	});
	assert.equal(result.chunkCount, 3);
	assert.deepEqual(
		packets.flatMap((channels) => [...channels[0]]),
		[-1, -0.5, 0, 0.5, 32_767 / 32_768],
	);
});

test('RF64 preserves BEXT metadata and keeps PCM unread during inspection', async () => {
	const bext = encodeBextPayload({
		description: 'RF64 field recording',
		originator: 'Soundscaper',
		timeReference: '9007199254740993',
	});
	const bytes = createRf64Fixture({
		chunks: [
			{ id: 'bext', bytes: bext },
			{ id: 'fmt ', bytes: createFormatBytes() },
			{ id: 'data', bytes: int16Bytes([1, 2, 3]), sentinel: true },
		],
		dataSize: 6n,
		sampleCount: 3n,
	});
	const tracked = createTrackedBlob(blobOf(bytes));
	const descriptor = await inspectWavBlobPcm(tracked);

	assert.ok(descriptor.bext);
	assert.equal(descriptor.bext.description, 'RF64 field recording');
	assert.equal(descriptor.bext.originator, 'Soundscaper');
	assert.equal(descriptor.bext.timeReference, '9007199254740993');
	assert.deepEqual(descriptor.metadataWarnings, []);
	assert.equal(tracked.reads.some(({ start }) => start === descriptor.dataOffset), false);
	assert.ok(tracked.reads.every(({ byteLength }) => byteLength <= bext.byteLength));
});

test('RF64 ds64 table entries resolve repeated sentinel chunk IDs in encounter order', async () => {
	const bytes = createRf64Fixture({
		chunks: [
			{ id: 'JUNK', bytes: Uint8Array.of(1), sentinel: true },
			{ id: 'JUNK', bytes: Uint8Array.of(2, 3), sentinel: true },
			{ id: 'fmt ', bytes: createFormatBytes() },
			{ id: 'data', bytes: int16Bytes([1]), sentinel: true },
		],
		tableEntries: [
			{ id: 'JUNK', size: 1n },
			{ id: 'JUNK', size: 2n },
		],
		dataSize: 2n,
		sampleCount: 1n,
	});
	const blob = blobOf(bytes);
	const descriptor = await inspectWavBlobPcm(blob, { maxRiffChunks: 5 });
	assert.equal(descriptor.frameCount, 1);
	await assert.rejects(
		inspectWavBlobPcm(blob, { maxRiffChunks: 4 }),
		/4-chunk inspection limit/,
	);
});

test('RF64 inspection skips a sparse PCM payload larger than four GiB', async () => {
	const dataBytes = 0x1_0000_0000;
	const tailOffset = 80 + dataBytes;
	const tailPayload = encodeBextPayload({ description: 'Metadata beyond four GiB' });
	const tail = createChunk('bext', tailPayload);
	const sourceBytes = tailOffset + tail.byteLength;
	const prefix = new Uint8Array(80);
	const view = new DataView(prefix.buffer);
	writeAscii(prefix, 0, 'RF64');
	view.setUint32(4, UINT32_SENTINEL, true);
	writeAscii(prefix, 8, 'WAVE');
	writeAscii(prefix, 12, 'ds64');
	view.setUint32(16, 28, true);
	view.setBigUint64(20, BigInt(sourceBytes - 8), true);
	view.setBigUint64(28, BigInt(dataBytes), true);
	view.setBigUint64(36, BigInt(dataBytes / 2), true);
	view.setUint32(44, 0, true);
	writeChunk(prefix, 48, 'fmt ', createFormatBytes(), 16);
	writeAscii(prefix, 72, 'data');
	view.setUint32(76, UINT32_SENTINEL, true);
	const sparse = createMappedSparseBlob([
		{ offset: 0, bytes: prefix },
		{ offset: tailOffset, bytes: tail },
	], sourceBytes);

	const descriptor = await inspectWavBlobPcm(sparse);
	assert.equal(descriptor.frameCount, dataBytes / 2);
	assert.equal(descriptor.dataByteLength, dataBytes);
	assert.equal(descriptor.riffByteLength, sourceBytes);
	assert.equal(descriptor.sourceByteLength, sourceBytes);
	assert.equal(descriptor.bext?.description, 'Metadata beyond four GiB');
	assert.equal(sparse.reads.some(({ start }) => start === tailOffset), true);
	assert.equal(sparse.reads.some(({ start }) => start > 80 && start < tailOffset), false);
	assert.ok(sparse.reads.every(({ byteLength }) => byteLength <= tailPayload.byteLength));
});

test('RF64 rejects invalid container and mandatory ds64 structures', async (t) => {
	const valid = createRf64Fixture({ dataBytes: int16Bytes([1]), sampleCount: 1n });

	await t.test('BW64 is outside the supported format', async () => {
		const bytes = valid.slice();
		writeAscii(bytes, 0, 'BW64');
		await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /BW64 WAV files are not supported/);
	});
	await t.test('finite RF64 top-level sizes take precedence over ds64', async () => {
		const bytes = valid.slice();
		new DataView(bytes.buffer).setUint32(4, bytes.byteLength - 8, true);
		new DataView(bytes.buffer).setBigUint64(20, 4n, true);
		assert.equal((await inspectWavBlobPcm(blobOf(bytes))).riffByteLength, bytes.byteLength);
	});
	await t.test('ds64 must be the first chunk', async () => {
		const bytes = valid.slice();
		writeAscii(bytes, 12, 'JUNK');
		await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /first RF64 chunk must be ds64/i);
	});
	await t.test('ds64 fixed body and table must fit its declared payload', async () => {
		const short = valid.slice();
		new DataView(short.buffer).setUint32(16, 16, true);
		await assert.rejects(inspectWavBlobPcm(blobOf(short)), /ds64 chunk is too small/i);

		const table = createRf64Fixture({
			dataBytes: int16Bytes([1]),
			sampleCount: 1n,
			tableEntries: [{ id: 'JUNK', size: 2n }],
		});
		new DataView(table.buffer).setUint32(16, 28, true);
		await assert.rejects(inspectWavBlobPcm(blobOf(table)), /ds64 table is truncated/i);
	});
	await t.test('ds64 payload size must exactly match its declared table', async () => {
		const bytes = createRf64Fixture({
			dataBytes: int16Bytes([1]),
			sampleCount: 1n,
			tableEntries: [{ id: 'JUNK', size: 2n }],
		});
		new DataView(bytes.buffer).setUint32(44, 0, true);
		await assert.rejects(
			inspectWavBlobPcm(blobOf(bytes)),
			/ds64 chunk size.*table length/i,
		);
	});
	await t.test('ds64 tables obey the configured inspection bound', async () => {
		const bytes = createRf64Fixture({
			dataBytes: int16Bytes([1]),
			sampleCount: 1n,
			tableEntries: Array.from({ length: 5 }, (_, index) => ({ id: `J${String(index).padStart(3, '0')}`, size: 0n })),
		});
		await assert.rejects(
			inspectWavBlobPcm(blobOf(bytes), { maxRiffChunks: 4 }),
			/ds64 table exceeds the 4-entry inspection limit/i,
		);
	});
	await t.test('duplicate ds64 chunks are rejected', async () => {
		const bytes = createRf64Fixture({
			chunks: [
				{ id: 'ds64', bytes: new Uint8Array(28) },
				{ id: 'fmt ', bytes: createFormatBytes() },
				{ id: 'data', bytes: int16Bytes([1]), sentinel: true },
			],
			dataSize: 2n,
			sampleCount: 1n,
		});
		await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /multiple ds64 chunks/i);
	});
});

test('RF64 rejects unsafe, truncated, and inconsistent 64-bit sizes', async (t) => {
	await t.test('unsafe uint64 values', async () => {
		for (const offset of [20, 28, 36]) {
			const bytes = createRf64Fixture({ dataBytes: int16Bytes([1]), sampleCount: 1n });
			new DataView(bytes.buffer).setBigUint64(offset, MAX_SAFE_BIGINT + 1n, true);
			await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /safe integer range/i);
		}
		const table = createRf64Fixture({
			dataBytes: int16Bytes([1]),
			sampleCount: 1n,
			tableEntries: [{ id: 'JUNK', size: MAX_SAFE_BIGINT + 1n }],
		});
		await assert.rejects(inspectWavBlobPcm(blobOf(table)), /safe integer range/i);
	});
	await t.test('RIFF and data extents must fit the Blob', async () => {
		const riff = createRf64Fixture({ dataBytes: int16Bytes([1]), sampleCount: 1n });
		new DataView(riff.buffer).setBigUint64(20, BigInt(riff.byteLength + 100), true);
		await assert.rejects(inspectWavBlobPcm(blobOf(riff)), /RF64 payload is truncated/i);

		const data = createRf64Fixture({ dataBytes: int16Bytes([1]), dataSize: 100n, sampleCount: 1n });
		await assert.rejects(inspectWavBlobPcm(blobOf(data)), /data.*chunk is truncated/i);
	});
	await t.test('sample count must match the PCM frame count', async () => {
		const mismatch = createRf64Fixture({ dataBytes: int16Bytes([1, 2]), sampleCount: 3n });
		await assert.rejects(inspectWavBlobPcm(blobOf(mismatch)), /ds64 sample count.*PCM frame count/i);
		const zero = createRf64Fixture({ dataBytes: int16Bytes([1, 2]), sampleCount: 0n });
		await assert.rejects(inspectWavBlobPcm(blobOf(zero)), /ds64 sample count.*PCM frame count/i);
	});
	await t.test('data size must contain complete PCM frames', async () => {
		const bytes = createRf64Fixture({
			formatBytes: createFormatBytes({ channelCount: 2 }),
			dataBytes: Uint8Array.of(1, 2, 3),
			dataSize: 3n,
			sampleCount: 0n,
		});
		await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /inside an interleaved PCM frame/);
	});
});

test('RF64 applies the EBU fact sample-count substitution rule', async (t) => {
	const pcm = int16Bytes([1, 2]);
	const chunks = (factSampleCount: number) => [
		{ id: 'fact', bytes: uint32Bytes(factSampleCount) },
		{ id: 'fmt ', bytes: createFormatBytes() },
		{ id: 'data', bytes: pcm, sentinel: true },
	];

	await t.test('a finite fact value takes precedence over ds64', async () => {
		const compatible = createRf64Fixture({
			chunks: chunks(2),
			dataBytes: pcm,
			dataSize: BigInt(pcm.byteLength),
			sampleCount: 3n,
		});
		assert.equal((await inspectWavBlobPcm(blobOf(compatible))).frameCount, 2);

		const mismatch = createRf64Fixture({
			chunks: chunks(3),
			dataBytes: pcm,
			dataSize: BigInt(pcm.byteLength),
			sampleCount: 2n,
		});
		await assert.rejects(inspectWavBlobPcm(blobOf(mismatch)), /fact sample count.*PCM frame count/i);
	});

	await t.test('a fact sentinel selects the ds64 value', async () => {
		const bytes = createRf64Fixture({
			chunks: chunks(UINT32_SENTINEL),
			dataBytes: pcm,
			dataSize: BigInt(pcm.byteLength),
			sampleCount: 2n,
		});
		assert.equal((await inspectWavBlobPcm(blobOf(bytes))).frameCount, 2);
	});

	await t.test('the fact sample-count field must be complete', async () => {
		const bytes = createRf64Fixture({
			chunks: [
				{ id: 'fact', bytes: Uint8Array.of(1, 2) },
				{ id: 'fmt ', bytes: createFormatBytes() },
				{ id: 'data', bytes: pcm, sentinel: true },
			],
			dataBytes: pcm,
			dataSize: BigInt(pcm.byteLength),
			sampleCount: 2n,
		});
		await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /RF64 fact chunk is too small/i);
	});
});

test('RF64 rejects an omitted final alignment byte for odd PCM data', async () => {
	const bytes = createRf64Fixture({
		formatBytes: createFormatBytes({ bitDepth: 8 }),
		dataBytes: Uint8Array.of(128),
		dataSize: 1n,
		sampleCount: 1n,
	});
	const unpadded = bytes.slice(0, -1);
	new DataView(unpadded.buffer).setBigUint64(20, BigInt(unpadded.byteLength - 8), true);
	await assert.rejects(inspectWavBlobPcm(blobOf(unpadded)), /data.*missing its pad byte/i);
});

test('RF64 requires every sentinel and ds64 table entry to match a real chunk', async (t) => {
	await t.test('unlisted sentinel chunk', async () => {
		const bytes = createRf64Fixture({
			chunks: [
				{ id: 'JUNK', bytes: Uint8Array.of(1, 2), sentinel: true },
				{ id: 'fmt ', bytes: createFormatBytes() },
				{ id: 'data', bytes: int16Bytes([1]), sentinel: true },
			],
			dataSize: 2n,
			sampleCount: 1n,
		});
		await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /no ds64 table size/i);
	});
	await t.test('unmatched table entry', async () => {
		const bytes = createRf64Fixture({
			dataBytes: int16Bytes([1]),
			sampleCount: 1n,
			tableEntries: [{ id: 'JUNK', size: 2n }],
		});
		await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /unused ds64 table entry.*JUNK/i);
	});
	await t.test('finite data sizes take precedence over ds64', async () => {
		const bytes = createRf64Fixture({
			chunks: [
				{ id: 'fmt ', bytes: createFormatBytes() },
				{ id: 'data', bytes: int16Bytes([1]), sentinel: false },
			],
			dataSize: 4n,
			sampleCount: 1n,
		});
		assert.equal((await inspectWavBlobPcm(blobOf(bytes))).dataByteLength, 2);
	});
});

function createRf64Fixture(options: Rf64FixtureOptions = {}): Uint8Array {
	const format = options.formatBytes ?? createFormatBytes();
	const data = options.dataBytes ?? int16Bytes([0]);
	const chunks = options.chunks ?? [
		{ id: 'fmt ', bytes: format },
		{ id: 'data', bytes: data, sentinel: true },
	];
	const entries = options.tableEntries ?? [];
	const ds64Payload = new Uint8Array(28 + entries.length * 12);
	const ds64View = new DataView(ds64Payload.buffer);
	ds64View.setBigUint64(8, options.dataSize ?? BigInt(data.byteLength), true);
	ds64View.setBigUint64(16, options.sampleCount ?? BigInt(data.byteLength / 2), true);
	ds64View.setUint32(24, entries.length, true);
	entries.forEach((entry, index) => {
		const offset = 28 + index * 12;
		writeAscii(ds64Payload, offset, entry.id);
		ds64View.setBigUint64(offset + 4, entry.size, true);
	});
	const physicalChunks = [
		createChunk('ds64', ds64Payload),
		...chunks.map((chunk) => createChunk(
			chunk.id,
			chunk.bytes,
			chunk.sentinel ? UINT32_SENTINEL : chunk.bytes.byteLength,
		)),
	];
	const byteLength = 12 + physicalChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const output = new Uint8Array(byteLength);
	const view = new DataView(output.buffer);
	writeAscii(output, 0, 'RF64');
	view.setUint32(4, UINT32_SENTINEL, true);
	writeAscii(output, 8, 'WAVE');
	let offset = 12;
	for (const chunk of physicalChunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	view.setBigUint64(20, options.riffSize ?? BigInt(output.byteLength - 8), true);
	return output;
}

function createChunk(id: string, bytes: Uint8Array, declaredSize = bytes.byteLength): Uint8Array {
	const output = new Uint8Array(8 + bytes.byteLength + (bytes.byteLength & 1));
	writeChunk(output, 0, id, bytes, declaredSize);
	return output;
}

function writeChunk(output: Uint8Array, offset: number, id: string, bytes: Uint8Array, declaredSize: number): void {
	writeAscii(output, offset, id);
	new DataView(output.buffer, output.byteOffset, output.byteLength).setUint32(offset + 4, declaredSize, true);
	output.set(bytes, offset + 8);
}

function createFormatBytes(options: { readonly channelCount?: number; readonly bitDepth?: 8 | 16 } = {}): Uint8Array {
	const channelCount = options.channelCount ?? 1;
	const bitDepth = options.bitDepth ?? 16;
	const sampleRate = 48_000;
	const blockAlign = channelCount * bitDepth / 8;
	const bytes = new Uint8Array(16);
	const view = new DataView(bytes.buffer);
	view.setUint16(0, 1, true);
	view.setUint16(2, channelCount, true);
	view.setUint32(4, sampleRate, true);
	view.setUint32(8, sampleRate * blockAlign, true);
	view.setUint16(12, blockAlign, true);
	view.setUint16(14, bitDepth, true);
	return bytes;
}

function uint32Bytes(value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, true);
	return bytes;
}

function int16Bytes(samples: readonly number[]): Uint8Array {
	const bytes = new Uint8Array(samples.length * 2);
	const view = new DataView(bytes.buffer);
	samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
	return bytes;
}

function blobOf(bytes: Uint8Array, type = ''): Blob {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return new Blob([buffer], { type });
}

function createTrackedBlob(blob: Blob): {
	readonly size: number;
	readonly reads: { readonly start: number; readonly end: number; readonly byteLength: number }[];
	slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
} {
	const reads: { start: number; end: number; byteLength: number }[] = [];
	return {
		size: blob.size,
		reads,
		slice(start = 0, end = blob.size) {
			const part = blob.slice(start, end);
			return {
				async arrayBuffer() {
					const buffer = await part.arrayBuffer();
					reads.push({ start, end, byteLength: buffer.byteLength });
					return buffer;
				},
			};
		},
	};
}

function createMappedSparseBlob(
	regions: readonly { readonly offset: number; readonly bytes: Uint8Array }[],
	size: number,
): {
	readonly size: number;
	readonly reads: { readonly start: number; readonly end: number; readonly byteLength: number }[];
	slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
} {
	const reads: { start: number; end: number; byteLength: number }[] = [];
	return {
		size,
		reads,
		slice(start = 0, end = size) {
			return {
				async arrayBuffer() {
					const region = regions.find(({ offset, bytes }) => start >= offset && end <= offset + bytes.byteLength);
					if (!region) throw new Error(`Sparse fixture unexpectedly read ${start}-${end}.`);
					const bytes = region.bytes.slice(start - region.offset, end - region.offset);
					reads.push({ start, end, byteLength: bytes.byteLength });
					return bytes.buffer;
				},
			};
		},
	};
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
	if (value.length !== 4) throw new Error('Fixture chunk IDs must contain four characters.');
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

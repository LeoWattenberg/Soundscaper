import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';

const UINT32_SENTINEL = 0xffff_ffff;

interface ChunkFixture {
	readonly id: string;
	readonly bytes: Uint8Array;
	readonly sentinel?: boolean;
}

test('compact BW64 PCM uses ds64 sizes and ignores its dummy uint64', async () => {
	const pcm = int16Bytes([-32_768, 0, 32_767]);
	const bytes = createBw64Fixture({ dataBytes: pcm, dummy: 0xffff_ffff_ffff_ffffn });
	const blob = blobOf(bytes, 'audio/wav');
	const descriptor = await inspectWavBlobPcm(blob);

	assert.equal(descriptor.container, 'wav');
	assert.equal(descriptor.sampleFormat, 'int16');
	assert.equal(descriptor.frameCount, 3);
	assert.equal(descriptor.dataByteLength, pcm.byteLength);
	assert.equal(descriptor.riffByteLength, blob.size);
	assert.equal(Object.hasOwn(descriptor, 'bw64'), false);

	const decoded: number[] = [];
	await streamWavBlobPcm(blob, {
		descriptor,
		onChunk(channels: Float32Array[]) { decoded.push(...channels[0]); },
	});
	assert.deepEqual(decoded, [-1, 0, 32_767 / 32_768]);
});

test('BW64 shares ds64 sentinel tables while retaining classic multichannel PCM', async () => {
	const format = createFormatBytes({ channelCount: 6, bitDepth: 24 });
	const pcm = new Uint8Array(6 * 3);
	const bytes = createBw64Fixture({
		formatBytes: format,
		dataBytes: pcm,
		chunks: [
			{ id: 'JUNK', bytes: Uint8Array.of(1), sentinel: true },
			{ id: 'fmt ', bytes: format },
			{ id: 'data', bytes: pcm, sentinel: true },
		],
		tableEntries: [{ id: 'JUNK', size: 1n }],
	});
	const descriptor = await inspectWavBlobPcm(blobOf(bytes));
	assert.equal(descriptor.channelCount, 6);
	assert.equal(descriptor.bitDepth, 24);
	assert.equal(descriptor.frameCount, 1);
	assert.equal(descriptor.formatTag, 1);
});

test('BW64 requires a sentinel top size and ds64 as its first chunk', async (t) => {
	const valid = createBw64Fixture();

	await t.test('top-level sentinel', async () => {
		const bytes = valid.slice();
		new DataView(bytes.buffer).setUint32(4, bytes.byteLength - 8, true);
		await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /BW64.*top-level.*sentinel/i);
	});
	await t.test('mandatory first ds64', async () => {
		const bytes = valid.slice();
		writeAscii(bytes, 12, 'JUNK');
		await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /first BW64 chunk must be ds64/i);
	});
	await t.test('duplicate ds64', async () => {
		const bytes = createBw64Fixture({
			chunks: [
				{ id: 'ds64', bytes: new Uint8Array(28) },
				{ id: 'fmt ', bytes: createFormatBytes() },
				{ id: 'data', bytes: int16Bytes([0]), sentinel: true },
			],
		});
		await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /BW64.*multiple ds64/i);
	});
});

test('BW64 validates RIFF and data sizes but not the ds64 dummy', async (t) => {
	await t.test('unsafe RIFF size', async () => {
		const bytes = createBw64Fixture();
		new DataView(bytes.buffer).setBigUint64(20, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true);
		await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /BW64 ds64 RIFF size.*safe integer/i);
	});
	await t.test('unsafe data size', async () => {
		const bytes = createBw64Fixture();
		new DataView(bytes.buffer).setBigUint64(28, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true);
		await assert.rejects(inspectWavBlobPcm(blobOf(bytes)), /BW64 ds64 data size.*safe integer/i);
	});
	await t.test('dummy mismatch', async () => {
		const bytes = createBw64Fixture({ dataBytes: int16Bytes([1, 2]), dummy: 1n });
		assert.equal((await inspectWavBlobPcm(blobOf(bytes))).frameCount, 2);
	});
});

interface Bw64FixtureOptions {
	readonly chunks?: readonly ChunkFixture[];
	readonly dataBytes?: Uint8Array;
	readonly formatBytes?: Uint8Array;
	readonly dummy?: bigint;
	readonly dataSize?: bigint;
	readonly riffSize?: bigint;
	readonly tableEntries?: readonly { readonly id: string; readonly size: bigint }[];
}

function createBw64Fixture(options: Bw64FixtureOptions = {}): Uint8Array {
	const format = options.formatBytes ?? createFormatBytes();
	const data = options.dataBytes ?? int16Bytes([0]);
	const chunks = options.chunks ?? [
		{ id: 'fmt ', bytes: format },
		{ id: 'data', bytes: data, sentinel: true },
	];
	const entries = options.tableEntries ?? [];
	const ds64 = new Uint8Array(28 + entries.length * 12);
	const ds64View = new DataView(ds64.buffer);
	ds64View.setBigUint64(8, options.dataSize ?? BigInt(data.byteLength), true);
	ds64View.setBigUint64(16, options.dummy ?? 0n, true);
	ds64View.setUint32(24, entries.length, true);
	entries.forEach((entry, index) => {
		const offset = 28 + index * 12;
		writeAscii(ds64, offset, entry.id);
		ds64View.setBigUint64(offset + 4, entry.size, true);
	});
	const physicalChunks = [
		createChunk('ds64', ds64),
		...chunks.map((chunk) => createChunk(chunk.id, chunk.bytes, chunk.sentinel ? UINT32_SENTINEL : chunk.bytes.byteLength)),
	];
	const output = new Uint8Array(12 + physicalChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	const view = new DataView(output.buffer);
	writeAscii(output, 0, 'BW64');
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

function createChunk(id: string, payload: Uint8Array, declaredSize = payload.byteLength): Uint8Array {
	const output = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	writeAscii(output, 0, id);
	new DataView(output.buffer).setUint32(4, declaredSize, true);
	output.set(payload, 8);
	return output;
}

function createFormatBytes(options: { readonly channelCount?: number; readonly bitDepth?: 16 | 24 } = {}): Uint8Array {
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

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

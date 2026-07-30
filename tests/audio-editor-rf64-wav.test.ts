import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createWavHeader,
	createWavStreamEncoder,
	inspectWavLayout,
} from '../src/common/editor/wav.js';

const UINT32_MAX = 0xffff_ffff;

test('WAV layout switches from RIFF to RF64 immediately after the exact RIFF size boundary', () => {
	const exactFrames = Math.floor((UINT32_MAX - 36) / 2);
	assert.equal(Number.isInteger(exactFrames), true);

	const riff = inspectWavLayout({
		channelCount: 1,
		totalFrames: exactFrames,
		bitDepth: 16,
	});
	assert.deepEqual(riff, {
		container: 'riff',
		byteLength: UINT32_MAX + 7,
		headerByteLength: 44,
		riffSize: UINT32_MAX - 1,
		dataByteLength: UINT32_MAX - 37,
		dataPadByteLength: 0,
		trailingByteLength: 0,
		bextByteLength: 0,
	});

	const riffHeader = createWavHeader({
		channelCount: 1,
		totalFrames: exactFrames,
		bitDepth: 16,
	});
	assert.equal(ascii(riffHeader, 0, 4), 'RIFF');
	assert.equal(viewOf(riffHeader).getUint32(4, true), UINT32_MAX - 1);
	assert.equal(viewOf(riffHeader).getUint32(40, true), UINT32_MAX - 37);

	const rf64 = inspectWavLayout({
		channelCount: 1,
		totalFrames: exactFrames + 1,
		bitDepth: 16,
	});
	assert.equal(rf64.container, 'rf64');
	assert.equal(rf64.headerByteLength, 80);
	assert.equal(rf64.dataByteLength, UINT32_MAX - 35);
	assert.equal(rf64.dataPadByteLength, 0);
	assert.equal(rf64.riffSize, 72 + rf64.dataByteLength);
	assert.equal(rf64.byteLength, rf64.riffSize + 8);

	const oddRf64 = inspectWavLayout({
		channelCount: 1,
		totalFrames: 1_431_655_755,
		bitDepth: 24,
	});
	assert.equal(oddRf64.container, 'rf64');
	assert.equal(oddRf64.dataByteLength & 1, 1);
	assert.equal(oddRf64.dataPadByteLength, 1);
	assert.equal(oddRf64.riffSize, 72 + oddRf64.dataByteLength + 1);
});

test('RF64 header writes ds64 before BEXT, fmt, and data with 64-bit final sizes', () => {
	const totalFrames = 1_431_655_601;
	const options = {
		channelCount: 1,
		totalFrames,
		bitDepth: 24 as const,
		bext: { description: 'Large broadcast master' },
		metadata: { title: 'Large broadcast master' },
	};
	const layout = inspectWavLayout(options);
	assert.equal(layout.container, 'rf64');
	assert.equal(layout.dataByteLength & 1, 1);
	assert.equal(layout.dataPadByteLength, 1);
	assert.ok(layout.trailingByteLength > 0);

	const header = createWavHeader({
		...options,
		trailingByteLength: layout.trailingByteLength,
	});
	const view = viewOf(header);
	assert.equal(ascii(header, 0, 4), 'RF64');
	assert.equal(view.getUint32(4, true), UINT32_MAX);
	assert.equal(ascii(header, 8, 4), 'WAVE');
	assert.equal(ascii(header, 12, 4), 'ds64');
	assert.equal(view.getUint32(16, true), 28);
	assert.equal(view.getBigUint64(20, true), BigInt(layout.riffSize));
	assert.equal(view.getBigUint64(28, true), BigInt(layout.dataByteLength));
	assert.equal(view.getBigUint64(36, true), BigInt(totalFrames));
	assert.equal(view.getUint32(44, true), 0);
	assert.equal(ascii(header, 48, 4), 'bext');
	const bextByteLength = 8 + view.getUint32(52, true) + (view.getUint32(52, true) & 1);
	const formatOffset = 48 + bextByteLength;
	assert.equal(ascii(header, formatOffset, 4), 'fmt ');
	assert.equal(ascii(header, formatOffset + 24, 4), 'data');
	assert.equal(view.getUint32(formatOffset + 28, true), UINT32_MAX);
	assert.equal(header.byteLength, layout.headerByteLength);
	assert.equal(
		layout.riffSize,
		72 + layout.bextByteLength + layout.dataByteLength
			+ layout.dataPadByteLength + layout.trailingByteLength,
	);
});

test('RF64 requires streaming collection and rejects before emitting a header', () => {
	let emitted = false;
	assert.throws(() => createWavStreamEncoder({
		channelCount: 1,
		totalFrames: 1_431_655_754,
		bitDepth: 24,
		collect: true,
		onChunk() { emitted = true; },
	}), /RF64.*stream/i);
	assert.equal(emitted, false);

	const chunks: Uint8Array[] = [];
	const encoder = createWavStreamEncoder({
		channelCount: 1,
		totalFrames: 1_431_655_754,
		bitDepth: 24,
		collect: false,
		onChunk(chunk: Uint8Array) { chunks.push(chunk); },
	});
	assert.equal(chunks.length, 1);
	assert.equal(ascii(chunks[0], 0, 4), 'RF64');
	assert.equal(encoder.byteLength, chunks[0].byteLength);
});

test('the shared streaming finalizer emits an odd PCM pad before the actual ID3 chunk', async () => {
	type ChunkInfo = {
		readonly header: boolean;
		readonly frameOffset: number;
		readonly metadata?: boolean;
		readonly padding?: boolean;
	};
	const emitted: Array<{ readonly chunk: Uint8Array; readonly info: ChunkInfo }> = [];
	const options = {
		sampleRate: 48_000,
		channelCount: 1,
		totalFrames: 1,
		bitDepth: 24 as const,
		dither: false,
		bext: { description: 'Trailer ordering control' },
		metadata: { title: 'Trailer ordering control' },
		collect: false,
		onChunk(chunk: Uint8Array, info: ChunkInfo) { emitted.push({ chunk, info }); },
	};
	const encoder = createWavStreamEncoder(options);
	encoder.write([Float32Array.of(0)]);
	const result = encoder.finalize() as { readonly byteLength: number };
	await encoder.settled();

	assert.equal(ascii(emitted[0].chunk, 0, 4), 'RIFF');
	assert.equal(emitted[1].chunk.byteLength, 3);
	assert.deepEqual(emitted[2], {
		chunk: Uint8Array.of(0),
		info: { header: false, padding: true, frameOffset: 1 },
	});
	assert.equal(emitted[3].info.metadata, true);
	assert.equal(ascii(emitted[3].chunk, 0, 4), 'id3 ');
	const joined = joinBytes(emitted.map(({ chunk }) => chunk));
	const dataEnd = emitted[0].chunk.byteLength + emitted[1].chunk.byteLength;
	assert.equal(joined[dataEnd], 0);
	assert.equal(ascii(joined, dataEnd + 1, 4), 'id3 ');
	assert.equal(result.byteLength, joined.byteLength);

	const rf64Layout = inspectWavLayout({
		...options,
		totalFrames: 1_431_655_601,
	});
	assert.equal(rf64Layout.container, 'rf64');
	assert.equal(rf64Layout.dataByteLength & 1, 1);
	assert.equal(rf64Layout.dataPadByteLength, 1);
	assert.equal(ascii(createWavHeader({ ...options, totalFrames: 1_431_655_601 }), 0, 4), 'RF64');
});

test('WAV layout rejects unsafe declared and derived byte sizes', () => {
	assert.throws(() => inspectWavLayout({
		totalFrames: Number.MAX_SAFE_INTEGER + 1,
		channelCount: 1,
		bitDepth: 16,
	}), /totalFrames.*safe integer/i);
	assert.throws(() => inspectWavLayout({
		totalFrames: Number.MAX_SAFE_INTEGER,
		channelCount: 1,
		bitDepth: 16,
	}), /safe integer range/i);
	assert.throws(() => inspectWavLayout({
		totalFrames: 0,
		trailingByteLength: Number.MAX_SAFE_INTEGER,
	}), /safe integer range/i);
	assert.throws(() => inspectWavLayout({ sampleRate: 2 ** 32 }), /sampleRate.*32-bit/i);
	assert.throws(() => inspectWavLayout({ channelCount: 0x1_0000 }), /channelCount.*16-bit/i);
	assert.throws(() => inspectWavLayout({ sampleRate: 0xffff_ffff, channelCount: 2 }), /byte rate.*32-bit/i);
});

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function viewOf(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((byteLength, chunk) => byteLength + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

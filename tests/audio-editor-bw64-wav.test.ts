import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createWavHeader,
	createWavStreamEncoder,
	encodeWav,
	inspectWavLayout,
} from '../src/common/editor/wav.js';

const UINT32_SENTINEL = 0xffff_ffff;

test('explicit BW64 always writes ds64 and classic integer PCM below four GiB', () => {
	const chna = riffChunk('chna', Uint8Array.of(1, 2, 3, 4));
	const axml = riffChunk('axml', new TextEncoder().encode('<ebuCoreMain/>'));
	const options = {
		container: 'bw64' as const,
		sampleRate: 48_000,
		channelCount: 6,
		totalFrames: 1,
		bitDepth: 24 as const,
		preDataChunks: [chna],
		trailingChunks: [axml],
	};
	const layout = inspectWavLayout(options);
	const header = createWavHeader(options);
	const view = dataView(header);

	assert.equal(layout.container, 'bw64');
	assert.equal(layout.headerByteLength, 12 + 36 + 24 + chna.byteLength + 8);
	assert.equal(layout.dataByteLength, 18);
	assert.equal(layout.trailingByteLength, axml.byteLength);
	assert.equal(layout.riffSize, layout.byteLength - 8);
	assert.equal(ascii(header, 0, 4), 'BW64');
	assert.equal(view.getUint32(4, true), UINT32_SENTINEL);
	assert.equal(ascii(header, 12, 4), 'ds64');
	assert.equal(view.getUint32(16, true), 28);
	assert.equal(view.getBigUint64(20, true), BigInt(layout.riffSize));
	assert.equal(view.getBigUint64(28, true), 18n);
	assert.equal(view.getBigUint64(36, true), 0n, 'BW64 uses a dummy value, not an RF64 sample count');
	assert.equal(ascii(header, 48, 4), 'fmt ');
	assert.equal(view.getUint32(52, true), 16);
	assert.equal(view.getUint16(56, true), 1, 'BW64 uses classic WAVE_FORMAT_PCM for its bed');
	assert.equal(view.getUint16(58, true), 6);
	assert.equal(ascii(header, 72, 4), 'chna');
	assert.equal(ascii(header, 72 + chna.byteLength, 4), 'data');
	assert.equal(view.getUint32(76 + chna.byteLength, true), UINT32_SENTINEL);
});

test('BW64 streaming places caller chunks around PCM and before generated metadata', async () => {
	const chna = riffChunk('chna', Uint8Array.of(0, 1));
	const axml = riffChunk('axml', new TextEncoder().encode('<audioFormatExtended/>'));
	type ChunkInfo = {
		readonly header: boolean;
		readonly frameOffset: number;
		readonly metadata?: boolean;
		readonly padding?: boolean;
	};
	const emitted: Array<{ readonly chunk: Uint8Array; readonly info: ChunkInfo }> = [];
	const encoder = createWavStreamEncoder({
		container: 'bw64',
		channelCount: 1,
		totalFrames: 1,
		bitDepth: 24,
		dither: false,
		preDataChunks: chna,
		trailingChunks: axml,
		metadata: { title: 'ADM master' },
		collect: false,
		onChunk(chunk: Uint8Array, info: ChunkInfo) { emitted.push({ chunk, info }); },
	});
	encoder.write([Float32Array.of(0)]);
	const result = encoder.finalize() as { readonly byteLength: number; readonly metadataBytes: number };
	await encoder.settled();

	assert.equal(ascii(emitted[0].chunk, 0, 4), 'BW64');
	assert.ok(findChunk(emitted[0].chunk, 'chna') < findChunk(emitted[0].chunk, 'data'));
	assert.equal(emitted[1].chunk.byteLength, 3);
	assert.deepEqual(emitted[2], {
		chunk: Uint8Array.of(0),
		info: { header: false, padding: true, frameOffset: 1 },
	});
	assert.equal(ascii(emitted[3].chunk, 0, 4), 'axml');
	assert.equal(emitted[3].info.metadata, true);
	assert.equal(ascii(emitted[4].chunk, 0, 4), 'id3 ');
	const joined = joinBytes(emitted.map(({ chunk }) => chunk));
	assert.equal(result.byteLength, joined.byteLength);
	assert.equal(result.metadataBytes, axml.byteLength + emitted[4].chunk.byteLength);
});

test('BW64 encodes 20-bit precision MSB-aligned in 24-bit sample containers', () => {
	const encoded = encodeWav([Float32Array.of(-1, 0, (2 ** 19 - 1) / 2 ** 19)], {
		container: 'bw64',
		sampleRate: 48_000,
		bitDepth: 20,
		dither: 'none',
	});
	const formatOffset = findChunk(encoded, 'fmt ');
	const dataOffset = findChunk(encoded, 'data');
	const view = dataView(encoded);

	assert.equal(view.getUint16(formatOffset + 8, true), 0xfffe);
	assert.equal(view.getUint16(formatOffset + 20, true), 3);
	assert.equal(view.getUint16(formatOffset + 22, true), 24);
	assert.equal(view.getUint16(formatOffset + 26, true), 20);
	assert.equal(view.getUint32(formatOffset + 16, true), 48_000 * 3);
	assert.deepEqual([...encoded.subarray(dataOffset + 8, dataOffset + 17)], [
		0x00, 0x00, 0x80,
		0x00, 0x00, 0x00,
		0xf0, 0xff, 0x7f,
	]);
});

test('BW64 encoding constraints do not alter automatic RIFF and RF64 selection', () => {
	const autoOptions = { channelCount: 2, totalFrames: 1, bitDepth: 24 as const };
	assert.deepEqual(createWavHeader(autoOptions), createWavHeader({ ...autoOptions, container: 'auto' }));
	assert.equal(inspectWavLayout(autoOptions).container, 'riff');
	assert.equal(inspectWavLayout({
		...autoOptions,
		totalFrames: 1_431_655_754,
		channelCount: 1,
	}).container, 'rf64');
	assert.throws(() => createWavHeader({ container: 'bw64', totalFrames: 1, float: true }), /BW64.*integer PCM/i);
	assert.throws(() => createWavHeader({ container: 'bw64', totalFrames: 1, bitDepth: 32 }), /BW64.*16-bit, 20-bit, or 24-bit/i);
	assert.throws(() => createWavHeader({ container: 'bw64', totalFrames: 1, channelCount: 0 }), /BW64.*1 through 32/i);
	assert.throws(() => createWavHeader({ container: 'bw64', totalFrames: 1, channelCount: 1.5 }), /BW64.*1 through 32/i);
	assert.throws(() => createWavHeader({ container: 'bw64', totalFrames: 1, channelCount: 33 }), /BW64.*32 channels/i);
	assert.throws(() => createWavHeader({ container: 'wave64', totalFrames: 1 }), /container/i);
});

test('caller-supplied RIFF chunks must be complete, aligned, and non-structural', () => {
	assert.throws(() => createWavHeader({
		container: 'bw64',
		preDataChunks: Uint8Array.of(1, 2, 3),
	}), /preDataChunks.*RIFF chunk/i);
	assert.throws(() => createWavHeader({
		container: 'bw64',
		trailingChunks: riffChunk('data', Uint8Array.of(1, 2)),
	}), /trailingChunks.*structural.*data/i);
	const malformed = riffChunk('axml', Uint8Array.of(1));
	new DataView(malformed.buffer).setUint32(4, 3, true);
	assert.throws(() => createWavHeader({
		container: 'bw64',
		trailingChunks: malformed,
	}), /trailingChunks.*size/i);
});

function riffChunk(id: string, payload: Uint8Array): Uint8Array {
	const bytes = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	writeAscii(bytes, 0, id);
	new DataView(bytes.buffer).setUint32(4, payload.byteLength, true);
	bytes.set(payload, 8);
	return bytes;
}

function findChunk(bytes: Uint8Array, id: string): number {
	for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
		if (ascii(bytes, offset, 4) === id) return offset;
	}
	return -1;
}

function dataView(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.byteLength;
	}
	return output;
}

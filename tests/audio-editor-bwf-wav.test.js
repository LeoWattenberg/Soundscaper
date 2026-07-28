import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createWavHeader, createWavStreamEncoder, encodeWav } from '../src/common/editor/wav.js';

test('Broadcast WAV writes a v2 bext before fmt and data while retaining trailing ID3 metadata', async () => {
	const channels = [Float32Array.of(-1, 0, 1)];
	const options = {
		sampleRate: 48_000,
		bitDepth: 16,
		dither: false,
		bext: {
			description: 'Broadcast master',
			originator: 'Soundscaper',
			timeReference: '9007199254740993',
			loudnessValue: -23,
			codingHistory: 'A=PCM,F=48000,W=16,M=mono,T=Soundscaper',
		},
		metadata: { title: 'Broadcast master' },
	};
	const collected = encodeWav(channels, options);
	const view = new DataView(collected.buffer);
	assert.equal(view.getUint32(4, true), collected.byteLength - 8);
	assert.equal(textAt(collected, 12, 4), 'bext');
	const bextBytes = view.getUint32(16, true);
	assert.ok(bextBytes > 602);
	const bextPayload = 20;
	assert.equal(textAt(collected, bextPayload, 16), 'Broadcast master');
	const timeReference = BigInt(view.getUint32(bextPayload + 338, true))
		+ (BigInt(view.getUint32(bextPayload + 342, true)) << 32n);
	assert.equal(timeReference.toString(), '9007199254740993');
	assert.equal(view.getUint16(bextPayload + 346, true), 2);
	assert.equal(view.getInt16(bextPayload + 412, true), -2300);
	assert.equal([...collected.slice(bextPayload + 422, bextPayload + 602)].every((value) => value === 0), true);
	const formatOffset = bextPayload + bextBytes + (bextBytes & 1);
	assert.equal(textAt(collected, formatOffset, 4), 'fmt ');
	assert.equal(textAt(collected, formatOffset + 24, 4), 'data');
	const dataBytes = view.getUint32(formatOffset + 28, true);
	assert.equal(textAt(collected, formatOffset + 32 + dataBytes, 4), 'id3 ');

	const emitted = [];
	const streaming = createWavStreamEncoder({
		...options,
		channelCount: 1,
		totalFrames: 3,
		collect: false,
		onChunk(chunk) { emitted.push(chunk); },
	});
	streaming.write(channels);
	const result = streaming.finalize();
	await streaming.settled();
	const streamed = new Uint8Array(emitted.reduce((size, chunk) => size + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of emitted) {
		streamed.set(chunk, offset);
		offset += chunk.byteLength;
	}
	assert.equal(result.byteLength, collected.byteLength);
	assert.deepEqual(streamed, collected);
});

test('Broadcast WAV word-aligns odd 24-bit mono data before optional ID3 metadata', async () => {
	const channels = [Float32Array.of(-1, 0, 1)];
	const options = {
		sampleRate: 48_000,
		bitDepth: 24,
		dither: false,
		bext: { description: 'Odd-length broadcast master' },
		metadata: { title: 'Odd-length broadcast master' },
	};
	const collected = encodeWav(channels, options);
	const view = new DataView(collected.buffer, collected.byteOffset, collected.byteLength);
	const bextBytes = view.getUint32(16, true);
	const formatOffset = 20 + bextBytes + (bextBytes & 1);
	const dataBytes = view.getUint32(formatOffset + 28, true);
	const dataEnd = formatOffset + 32 + dataBytes;
	assert.equal(dataBytes, 9);
	assert.equal(collected[dataEnd], 0);
	assert.equal(textAt(collected, dataEnd + 1, 4), 'id3 ');
	assert.equal(view.getUint32(4, true), collected.byteLength - 8);

	const descriptor = await inspectWavBlobPcm(new Blob([collected]));
	assert.equal(descriptor.frameCount, 3);
	assert.equal(descriptor.bitDepth, 24);
	assert.equal(descriptor.riffByteLength, collected.byteLength);

	const emitted = [];
	const streaming = createWavStreamEncoder({
		...options,
		channelCount: 1,
		totalFrames: 3,
		collect: false,
		onChunk(chunk) { emitted.push(chunk); },
	});
	streaming.write(channels);
	const result = streaming.finalize();
	await streaming.settled();
	const streamed = joinBytes(emitted);
	assert.equal(streaming.byteLength, collected.byteLength);
	assert.equal(result.byteLength, collected.byteLength);
	assert.deepEqual(streamed, collected);

	const withoutId3 = encodeWav(channels, { ...options, metadata: {} });
	assert.equal(withoutId3.at(-1), 0);
	assert.equal(new DataView(withoutId3.buffer).getUint32(4, true), withoutId3.byteLength - 8);
	assert.equal((await inspectWavBlobPcm(new Blob([withoutId3]))).riffByteLength, withoutId3.byteLength);
});

test('Broadcast WAV switches to RF64 when its padded classic RIFF layout overflows', () => {
	const header = createWavHeader({
		channelCount: 1,
		totalFrames: 1_431_655_547,
		bitDepth: 24,
		bext: { codingHistory: 'ABCDE' },
	});
	assert.equal(textAt(header, 0, 4), 'RF64');
	assert.equal(new DataView(header.buffer).getUint32(4, true), 0xffff_ffff);
});

test('plain WAV preserves its unpadded 44-byte-layout output for odd PCM byte counts', () => {
	assert.deepEqual(
		encodeWav([Float32Array.of(0)], { sampleRate: 48_000, bitDepth: 24, dither: false }),
		Uint8Array.of(
			82, 73, 70, 70, 39, 0, 0, 0, 87, 65, 86, 69,
			102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0,
			128, 187, 0, 0, 128, 50, 2, 0, 3, 0, 24, 0,
			100, 97, 116, 97, 3, 0, 0, 0, 0, 0, 0,
		),
	);
});

test('Broadcast WAV enforces integer PCM while supporting extensible multichannel output', () => {
	assert.throws(() => encodeWav([Float32Array.of(0)], { float: true, bext: {} }), /Broadcast WAV.*float|16.*24/i);
	const multichannel = encodeWav([
		Float32Array.of(0), Float32Array.of(0), Float32Array.of(0),
	], { bitDepth: 24, bext: {} });
	const formatOffset = findChunk(multichannel, 'fmt ');
	assert.ok(formatOffset > 0);
	assert.equal(new DataView(multichannel.buffer).getUint16(formatOffset + 8, true), 0xfffe);
});

function findChunk(bytes, id) {
	for (let offset = 12; offset <= bytes.byteLength - 8;) {
		if (textAt(bytes, offset, 4) === id) return offset;
		const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
		offset += 8 + size + (size & 1);
	}
	return -1;
}

function textAt(bytes, offset, length) {
	return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function joinBytes(chunks) {
	const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

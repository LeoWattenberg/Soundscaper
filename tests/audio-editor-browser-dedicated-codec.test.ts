/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	decodeDedicatedAudioFile,
	encodeDedicatedAudioPcm,
	type BrowserDedicatedAudioFormat,
} from '../src/common/editor/browser-dedicated-audio-codec.ts';

const PAYLOADS: Readonly<Record<BrowserDedicatedAudioFormat, URL>> = Object.freeze({
	flac: new URL('../src/common/editor/flac/flac.wasm', import.meta.url),
	mp3: new URL('../src/common/editor/lame/lame.wasm', import.meta.url),
	'ogg-vorbis': new URL('../src/common/editor/vorbis/vorbis.wasm', import.meta.url),
	opus: new URL('../src/common/editor/opus/opus.wasm', import.meta.url),
	wavpack: new URL('../src/common/editor/wavpack/wavpack.wasm', import.meta.url),
	mp2: new URL('../src/common/editor/twolame/twolame.wasm', import.meta.url),
});

const CASES = Object.freeze([
	Object.freeze({ format: 'flac', settings: { compressionLevel: 5 }, signature: 'fLaC' }),
	Object.freeze({ format: 'mp3', settings: { bitrateKbps: 128 }, signature: null }),
	Object.freeze({ format: 'ogg-vorbis', settings: { quality: 5 }, signature: 'OggS' }),
	Object.freeze({ format: 'opus', settings: { bitrateKbps: 128 }, signature: 'OggS' }),
	Object.freeze({ format: 'wavpack', settings: { compressionLevel: 2 }, signature: 'wvpk' }),
	Object.freeze({ format: 'mp2', settings: { bitrateKbps: 192 }, signature: null }),
] satisfies readonly Readonly<{
	format: BrowserDedicatedAudioFormat;
	settings: Readonly<Record<string, number>>;
	signature: string | null;
}>[]);

for (const entry of CASES) {
	test(`browser dedicated ${entry.format} encoder returns a complete media file`, async () => {
		const frameCount = entry.format === 'mp2' ? 4_608 : 4_800;
		const channelCount = 2;
		const sampleRate = 48_000;
		const input = sinePcm(frameCount, channelCount, sampleRate);
		const payload = await readFile(PAYLOADS[entry.format]);
		const output = await encodeDedicatedAudioPcm({
			format: entry.format,
			input: new Uint8Array(input.buffer),
			frameCount,
			channelCount,
			sampleRate,
			settings: entry.settings,
			maximumOutputBytes: 2 * 1024 * 1024,
		}, { loadPayload: async () => payload });

		assert.ok(output.byteLength > 32);
		if (entry.signature !== null) {
			assert.equal(new TextDecoder().decode(output.subarray(0, 4)), entry.signature);
		} else {
			assert.equal(output[0], 0xff);
			assert.equal((output[1]! & 0xe0), 0xe0);
		}
		if (entry.format === 'opus') {
			assert.notEqual(indexOfAscii(output, 'OpusHead'), -1);
		}
		const decodeFormat = entry.format === 'ogg-vorbis' ? 'ogg-vorbis' : entry.format;
		const decodePayload = await readFile(decodeFormat === 'mp3' || decodeFormat === 'mp2'
			? new URL('../src/common/editor/mpg123/mpg123.wasm', import.meta.url)
			: PAYLOADS[entry.format]);
		const decoded = await decodeDedicatedAudioFile({
			format: decodeFormat,
			input: output,
			maximumOutputBytes: 4 * 1024 * 1024,
		}, { loadPayload: async () => decodePayload });
		assert.equal(decoded.sampleRate, sampleRate);
		assert.equal(decoded.channelCount, channelCount);
		assert.equal(decoded.frameCount, frameCount);
		assert.equal(decoded.interleaved.byteLength, frameCount * channelCount * 4);
		assert.equal(readInterleaved(decoded.interleaved).every(Number.isFinite), true);
		if (entry.format === 'flac' || entry.format === 'wavpack') {
			const source = new Float32Array(input.buffer);
			const roundTrip = readInterleaved(decoded.interleaved);
			assert.ok(Math.abs(roundTrip[17]! - source[17]!) < 0.000_001);
		}
	});
}

test('browser dedicated codecs reject tuples outside the reviewed native profiles before loading payloads', async () => {
	const cases: readonly Readonly<{
		format: BrowserDedicatedAudioFormat;
		channelCount: number;
		sampleRate: number;
		settings: Readonly<Record<string, number>>;
	}>[] = [
		{ format: 'opus', channelCount: 2, sampleRate: 48_000, settings: { bitrateKbps: 384 } },
		{ format: 'mp3', channelCount: 2, sampleRate: 48_000, settings: { bitrateKbps: 32 } },
		{ format: 'mp3', channelCount: 1, sampleRate: 44_100, settings: { bitrateKbps: 17 } },
		{ format: 'mp2', channelCount: 2, sampleRate: 48_000, settings: { bitrateKbps: 80 } },
		{ format: 'mp2', channelCount: 1, sampleRate: 48_000, settings: { bitrateKbps: 256 } },
		{ format: 'flac', channelCount: 2, sampleRate: 48_000, settings: { compressionLevel: 5, quality: 1 } },
	];
	let payloadLoads = 0;
	for (const entry of cases) {
		const frameCount = 64;
		await assert.rejects(() => encodeDedicatedAudioPcm({
			format: entry.format,
			channelCount: entry.channelCount,
			sampleRate: entry.sampleRate,
			settings: entry.settings,
			input: new Uint8Array(frameCount * entry.channelCount * Float32Array.BYTES_PER_ELEMENT),
			frameCount,
			maximumOutputBytes: 64 * 1024,
		}, {
			async loadPayload() {
				payloadLoads += 1;
				throw new Error('invalid profiles must not load a payload');
			},
		}), RangeError);
	}
	assert.equal(payloadLoads, 0);
});

function sinePcm(frameCount: number, channelCount: number, sampleRate: number): Float32Array {
	const result = new Float32Array(frameCount * channelCount);
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			result[frame * channelCount + channel] = Math.sin(
				2 * Math.PI * (channel === 0 ? 440 : 660) * frame / sampleRate,
			) * 0.25;
		}
	}
	return result;
}

function indexOfAscii(bytes: Uint8Array, text: string): number {
	const expected = new TextEncoder().encode(text);
	for (let offset = 0; offset <= bytes.byteLength - expected.byteLength; offset += 1) {
		if (expected.every((byte, index) => bytes[offset + index] === byte)) return offset;
	}
	return -1;
}

function readInterleaved(bytes: Uint8Array): number[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return Array.from({ length: bytes.byteLength / 4 }, (_value, index) => view.getFloat32(index * 4, true));
}

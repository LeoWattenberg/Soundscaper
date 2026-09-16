/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';

const cases = [
	{ format: 'flac', extension: 'flac', type: 'audio/flac', settings: { compressionLevel: 5 } },
	{ format: 'mp3', extension: 'mp3', type: 'audio/mpeg', settings: { bitrateKbps: 192 } },
	{ format: 'mp2', extension: 'mp2', type: 'audio/mpeg', settings: { bitrateKbps: 192 } },
	{ format: 'opus', extension: 'opus', type: 'audio/ogg', settings: { bitrateKbps: 128, vbrMode: 1 } },
	{ format: 'ogg-vorbis', extension: 'ogg', type: 'audio/ogg', settings: { quality: 6 } },
] as const;

test('reviewed FLAC, Vorbis and MP3 ignore native support advertisements before publication', async () => {
	const originalDecoder = globalThis.AudioDecoder;
	const originalFetch = globalThis.fetch;
	let nativeOpened = 0;
	class AdvertisedDecoder {
		static isConfigSupported(config: AudioDecoderConfig) { return Promise.resolve({ supported: true, config }); }
		constructor() { nativeOpened++; throw new Error('Advertised native codec cannot decode.'); }
	}
	globalThis.AudioDecoder = AdvertisedDecoder as unknown as typeof AudioDecoder;
	globalThis.fetch = async (url) => { assert.ok(url instanceof URL); return new Response(await readFile(url)); };
	try {
		for (const entry of cases.filter(({ format }) => ['flac', 'ogg-vorbis', 'mp3'].includes(format))) {
			const pcm = Float32Array.from({ length: 4800 * 2 }, (_value, index) => Math.sin(index / 20) / 4);
			const encoded = await encodeDedicatedAudioPcm({ format: entry.format, input: new Uint8Array(pcm.buffer),
				frameCount: 4800, channelCount: 2, sampleRate: 48000, settings: entry.settings, maximumOutputBytes: 1024 ** 2,
			}, { loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
			const prepared = await prepareStreamedAudioImport(new File([encoded], `native.${entry.extension}`, { type: entry.type }));
			let frames = 0;
			await prepared.stream({ chunkFrames: 2048, onChunk(channels) { frames += channels[0]!.length; } });
			assert.equal(frames, 4800, entry.format);
		}
		assert.equal(nativeOpened, 0);
	} finally { globalThis.AudioDecoder = originalDecoder; globalThis.fetch = originalFetch; }
});

for (const entry of cases) test(`reviewed ${entry.format} fallback decodes packets into bounded source chunks without AudioDecoder`, async () => {
	assert.equal(typeof globalThis.AudioDecoder, 'undefined');
	const frames = 48_000;
	const pcm = new Float32Array(frames * 2);
	for (let frame = 0; frame < frames; frame++) {
		pcm[frame * 2] = Math.sin(frame * Math.PI * 2 * 440 / 48_000) * 0.2;
		pcm[frame * 2 + 1] = Math.cos(frame * Math.PI * 2 * 220 / 48_000) * 0.1;
	}
	const output = await encodeDedicatedAudioPcm({ format: entry.format, input: new Uint8Array(pcm.buffer),
		frameCount: frames, channelCount: 2, sampleRate: 48_000, settings: entry.settings,
		maximumOutputBytes: 2 * 1024 * 1024,
	}, { loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		assert.ok(url instanceof URL && url.protocol === 'file:');
		return new Response(await readFile(url));
	};
	try {
		class AudioOriginal extends File { override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('whole-file read forbidden'); } }
		const original = new AudioOriginal([output], `recording.${entry.extension}`, { type: entry.type });
		const prepared = await prepareStreamedAudioImport(original);
		assert.equal(prepared.descriptor.channelCount, 2);
		assert.equal(prepared.descriptor.sampleRate, 48_000);
		if (entry.format !== 'mp2') assert.equal(prepared.descriptor.frameCount, frames, 'Codec priming and end padding are excluded');
		let decodedFrames = 0;
		let maximumChunkFrames = 0;
		let energy = 0;
		let firstSample: number | undefined;
		await prepared.stream({ chunkFrames: 16_384, onChunk(channels) {
			assert.equal(channels.length, 2);
			decodedFrames += channels[0]!.length;
			maximumChunkFrames = Math.max(maximumChunkFrames, channels[0]!.length);
			firstSample ??= channels[1]![0];
			for (const sample of channels[0]!) energy += sample * sample;
		} });
		assert.equal(decodedFrames, prepared.descriptor.frameCount);
		assert.ok(decodedFrames >= frames - 1 && decodedFrames <= frames + 2304);
		assert.ok(maximumChunkFrames <= 16_384);
		assert.ok(energy > 100 && energy < 2000);
		if (entry.format === 'mp3') assert.ok(Math.abs(firstSample! - 0.1) < 0.03, 'The first source sample follows synthesis and encoder delay');
	} finally { globalThis.fetch = originalFetch; }
});

test('reviewed Opus packet decoding preserves the OpusHead output gain', async () => {
	const pcm = Float32Array.from({ length: 48_000 * 2 }, (_sample, index) => Math.sin(Math.floor(index / 2) * 0.03) * 0.05);
	const encoded = await encodeDedicatedAudioPcm({ format: 'opus', input: new Uint8Array(pcm.buffer),
		frameCount: 48_000, channelCount: 2, sampleRate: 48_000, settings: { bitrateKbps: 128, vbrMode: 1 }, maximumOutputBytes: 2 * 1024 ** 2,
	}, { loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
	const adjusted = encoded.slice();
	const segments = adjusted[26]!;
	const body = 27 + segments;
	new DataView(adjusted.buffer).setInt16(body + 16, 6 * 256, true);
	let pageSize = body;
	for (let index = 0; index < segments; index += 1) pageSize += adjusted[27 + index]!;
	let checksum = 0;
	for (let index = 0; index < pageSize; index += 1) {
		checksum ^= (index >= 22 && index < 26 ? 0 : adjusted[index]!) << 24;
		for (let bit = 0; bit < 8; bit += 1) checksum = (checksum << 1) ^ (checksum & 0x8000_0000 ? 0x04c1_1db7 : 0);
	}
	new DataView(adjusted.buffer).setUint32(22, checksum >>> 0, true);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url) => { assert.ok(url instanceof URL); return new Response(await readFile(url)); };
	try {
		const energy = async (input: Uint8Array<ArrayBuffer>): Promise<number> => {
			const prepared = await prepareStreamedAudioImport(new File([input], 'gain.opus', { type: 'audio/ogg' }));
			let total = 0;
			await prepared.stream({ chunkFrames: 16_384, onChunk(channels) {
				for (const sample of channels[0]!) total += sample * sample;
			} });
			return total;
		};
		assert.ok(Math.abs((await energy(adjusted)) / (await energy(encoded)) - 10 ** 0.6) < 0.0001);
		const damaged = encoded.slice();
		damaged[damaged.length - 1]! ^= 1;
		await assert.rejects(prepareStreamedAudioImport(new File([damaged], 'damaged.opus', { type: 'audio/ogg' })), /Ogg source page checksum failed/);
	} finally { globalThis.fetch = originalFetch; }
});

test('desktop import refuses renderer WASM fallback even after browser decoders were registered', async () => {
	const output = await encodeDedicatedAudioPcm({ format: 'flac', input: new Uint8Array(48_000 * 8),
		frameCount: 48_000, channelCount: 2, sampleRate: 48_000, settings: { compressionLevel: 5 },
		maximumOutputBytes: 2 * 1024 * 1024,
	}, { loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
	const originalFetch = globalThis.fetch;
	globalThis.fetch = () => { throw new Error('Desktop renderer payload fetch is forbidden.'); };
	try {
		await assert.rejects(prepareStreamedAudioImport(new File([output], 'desktop.flac', { type: 'audio/flac' }), {
			reviewedFallback: false,
		}), /desktop browser cannot incrementally decode/);
	} finally { globalThis.fetch = originalFetch; }
});

test('desktop native admission never enables browser WASM after an advertised decoder fails', async () => {
	const output = await encodeDedicatedAudioPcm({ format: 'flac', input: new Uint8Array(4800 * 8),
		frameCount: 4800, channelCount: 2, sampleRate: 48000, settings: { compressionLevel: 5 }, maximumOutputBytes: 1024 ** 2,
	}, { loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
	const originalDecoder = globalThis.AudioDecoder;
	const originalFetch = globalThis.fetch;
	let nativeOpened = 0;
	class AdvertisedDecoder {
		static isConfigSupported(config: AudioDecoderConfig) { return Promise.resolve({ supported: true, config }); }
		constructor() { nativeOpened++; throw new Error('Desktop native decoder failed.'); }
	}
	globalThis.AudioDecoder = AdvertisedDecoder as unknown as typeof AudioDecoder;
	globalThis.fetch = () => { throw new Error('Desktop renderer payload fetch is forbidden.'); };
	try {
		const prepared = await prepareStreamedAudioImport(new File([output], 'desktop.flac', { type: 'audio/flac' }), { reviewedFallback: false });
		await assert.rejects(prepared.stream({ chunkFrames: 8192, onChunk() { assert.fail('Failed native decoding must not reach storage.'); } }), /Desktop native decoder failed/u);
		assert.equal(nativeOpened, 1);
	} finally { globalThis.AudioDecoder = originalDecoder; globalThis.fetch = originalFetch; }
});

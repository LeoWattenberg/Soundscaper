/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { disableReviewedAudioImportDecoders } from '../src/common/editor/browser-reviewed-streamed-audio-decoders.ts';
import { openDesktopMpegLayerIIImportSession } from '../src/common/editor/desktop-mpeg-layer-ii-import.ts';

test('actual MPEG LayerII uses the reviewed decoder despite native mp3 support without changing later LayerIII imports', async () => {
	const pcm = Float32Array.from({ length: 48_000 * 2 }, (_value, index) => Math.sin(Math.floor(index / 2) * 0.05) * 0.3);
	const encoded = async (format: 'mp2' | 'mp3') => encodeDedicatedAudioPcm({ format,
		input: new Uint8Array(pcm.buffer), frameCount: 48_000, channelCount: 2, sampleRate: 48_000,
		settings: { bitrateKbps: 192 }, maximumOutputBytes: 1024 * 1024,
	}, { loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
	const [mp2, mp3] = await Promise.all([encoded('mp2'), encoded('mp3')]);
	const originalFetch = globalThis.fetch;
	const originalDecoder = globalThis.AudioDecoder;
	let nativeConstructors = 0;
	class NativeMp3Decoder {
		static isConfigSupported(config: AudioDecoderConfig) { return Promise.resolve({ supported: true, config }); }
		constructor() { nativeConstructors++; throw new Error('native MP3 decoder was selected'); }
	}
	globalThis.AudioDecoder = NativeMp3Decoder as unknown as typeof AudioDecoder;
	globalThis.fetch = async (url) => { assert.ok(url instanceof URL); return new Response(await readFile(url)); };
	disableReviewedAudioImportDecoders();
	try {
		// ID3/container framing and a misleading extension do not change the actual MPEG layer.
		const id3 = Uint8Array.of(73, 68, 51, 4, 0, 0, 0, 0, 0, 0);
		const layer2 = await prepareStreamedAudioImport(new File([id3, mp2], 'renamed.mp3', { type: 'audio/mpeg' }));
		let frames = 0;
		let energy = 0;
		await layer2.stream({ chunkFrames: 16_384, onChunk(channels) {
			frames += channels[0]!.length;
			for (const value of channels[0]!) energy += value * value;
		} });
		assert.equal(frames, layer2.descriptor.frameCount);
		assert.ok(energy > 100);
		assert.equal(nativeConstructors, 0);
		const layer3 = await prepareStreamedAudioImport(new File([mp3], 'renamed.mp2', { type: 'audio/mpeg' }));
		await assert.rejects(layer3.stream({ chunkFrames: 16_384, onChunk() {} }), /native MP3 decoder was selected/u);
		assert.equal(nativeConstructors, 1);
	} finally {
		disableReviewedAudioImportDecoders();
		globalThis.fetch = originalFetch;
		globalThis.AudioDecoder = originalDecoder;
	}
});

test('small desktop LayerII imports use the capped utility port after admission with bounded original reads', async () => {
	const encoded = await encodeDedicatedAudioPcm({ format: 'mp2', input: new Uint8Array(48_000 * 8),
		frameCount: 48_000, channelCount: 2, sampleRate: 48_000, settings: { bitrateKbps: 192 }, maximumOutputBytes: 1024 * 1024,
	}, { loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
	class RangeFile extends File {
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Whole original read forbidden'); }
		override slice(start?: number, end?: number, type?: string): Blob {
			assert.ok((end ?? this.size) - (start ?? 0) <= 4 * 1024 * 1024);
			return super.slice(start, end, type);
		}
	}
	const originalFetch = globalThis.fetch;
	globalThis.fetch = () => { throw new Error('Desktop renderer decoder payload fetch forbidden'); };
	let utilityCalls = 0;
	let expectedFrames = 0;
	try {
		const id3 = Uint8Array.of(73, 68, 51, 4, 0, 0, 0, 0, 0, 0);
		const prepared = await prepareStreamedAudioImport(new RangeFile([id3, encoded], 'renamed.mp3', { type: 'audio/mpeg' }), {
			reviewedFallback: false, desktopCodec: { decode(file, options) {
				utilityCalls++;
				assert.ok(file instanceof File);
				assert.equal(file.size, encoded.byteLength + id3.length);
				assert.equal(options.format, 'mp2');
				assert.equal(options.maximumOutputBytes, 128 * 1024 * 1024);
				return Promise.resolve({ sampleRate: 48_000, channels: [new Float32Array(expectedFrames), new Float32Array(expectedFrames)] });
			} },
		});
		expectedFrames = prepared.descriptor.frameCount;
		assert.equal(utilityCalls, 0, 'Utility PCM allocation waits until after importer preflight');
		let importedFrames = 0;
		await prepared.stream({ chunkFrames: 16_384, onChunk(channels) {
			assert.ok(channels[0]!.length <= 16_384); importedFrames += channels[0]!.length;
		} });
		assert.equal(importedFrames, expectedFrames);
		assert.equal(utilityCalls, 1);
	} finally { globalThis.fetch = originalFetch; }
});

test('desktop LayerII refuses large input, large decoded geometry, and missing utility capability before any decode', () => {
	const codec = { decode() { throw new Error('No utility decode should start'); } };
	const geometry = { sampleRate: 48_000, channelCount: 2, durationSeconds: 1, timelineOrigin: 0 };
	class LargeOriginal extends Blob { override get size() { return 32 * 1024 * 1024 + 1; } }
	for (const attempt of [
		() => openDesktopMpegLayerIIImportSession(new LargeOriginal(), geometry, undefined, codec),
		() => openDesktopMpegLayerIIImportSession(new Blob(['mp2']), { ...geometry, durationSeconds: 3600 }, undefined, codec),
		() => openDesktopMpegLayerIIImportSession(new Blob(['mp2']), geometry),
	]) assert.throws(attempt, /32 MiB input and 128 MiB decoded PCM/u);
});

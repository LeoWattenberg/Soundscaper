/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { floatWave } from './helpers/float32-wave-fixture.ts';
import { createExternalMediaAudioDecoder } from '../src/common/editor/external-media-audio-decoder.ts';
import { attachExternalMedia } from '../src/common/editor/desktop-external-media.ts';

const samples = new Float32Array([0.25, -0.5, 0.75, 0]);
const source = { kind: 'audio', id: 'audio', name: 'source.wav', sampleRate: 48_000, channelCount: 1, frameCount: 4, chunkFrames: 4 };
const refuse = async (): Promise<never> => { throw new Error('Unexpected codec decode.'); };

test('external WAV audio rebuilds the exact samples using the maintained PCM reader', async () => {
	const decode = createExternalMediaAudioDecoder({ decodeNative: refuse, decodeCodec: refuse });
	const file = new Blob([new Uint8Array(floatWave(48_000, 1, new Uint8Array(samples.buffer)))]);
	assert.deepEqual(await decode(file, source), [samples]);
	await assert.rejects(decode(file, { ...source, sampleRate: 44_100 }), /does not match/u);
	await assert.rejects(decode(file, { ...source, frameCount: 8 }), /does not match/u);
});

test('containers rejected by the PCM reader can reopen through the desktop codec', async () => {
	const wave = floatWave(48_000, 1, new Uint8Array(samples.buffer));
	new DataView(wave.buffer).setUint16(20, 6, true);
	const file = new Blob([new Uint8Array(wave)]);
	let calls = 0;
	const decode = createExternalMediaAudioDecoder({ decodeNative: refuse, decodeCodec: async (input, settings) => {
		assert.equal(input, file); assert.equal(settings.sampleRate, 48_000); calls += 1;
		return { channels: [samples], sampleRate: 48_000 };
	} });
	assert.deepEqual(await decode(file, source), [samples]);
	assert.equal(calls, 1);
});

test('video companion audio retains import padding and cancellation', async () => {
	const file = new Blob(['video']);
	const videoAudio = attachExternalMedia(source, { reference: 'video-original', byteLength: file.size,
		sha256: 'a'.repeat(64) }, 'video-audio');
	const decode = createExternalMediaAudioDecoder({ decodeCodec: refuse, decodeNative: async (_bytes, rate) => {
		assert.equal(rate, null);
		return { channels: [samples.subarray(0, 2)], sampleRate: 48_000 };
	} });
	assert.deepEqual(await decode(file, videoAudio), [new Float32Array([0.25, -0.5, 0, 0])]);
	await assert.rejects(decode(file, videoAudio, AbortSignal.abort()), (error: unknown) => error instanceof Error && error.name === 'AbortError');
});

test('video companion audio reuses its original native decode rate on another output device', async () => {
	const file = new Blob(['video']);
	const videoAudio = attachExternalMedia(source, { reference: 'video-original', byteLength: file.size,
		sha256: 'a'.repeat(64), decodeSampleRate: 44_100 }, 'video-audio');
	const decode = createExternalMediaAudioDecoder({ decodeCodec: refuse, decodeNative: async (_bytes, rate) => {
		assert.equal(rate, 44_100);
		return { channels: [samples], sampleRate: 44_100 };
	} });
	const result = await decode(file, videoAudio);
	assert.equal(result[0]!.length, source.frameCount);
	assert.ok(result[0]!.every(Number.isFinite));
});

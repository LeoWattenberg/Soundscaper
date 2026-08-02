/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	encodeRenderedAudio,
	type RenderedAudioEncodingPlan,
	type RenderedAudioEncodingRuntime,
} from '../src/common/editor/controller/rendered-audio-encoding.ts';

interface TestBuffer {
	readonly sampleRate: number;
	readonly channels: readonly Float32Array[];
}

function buffer(sampleRate = 48_000, frameCount = 4): TestBuffer {
	return Object.freeze({
		sampleRate,
		channels: Object.freeze([
			Float32Array.from({ length: frameCount }, (_, frame) => (frame + 1) / 10),
			Float32Array.from({ length: frameCount }, (_, frame) => -(frame + 1) / 10),
		]),
	});
}

function plan(overrides: Partial<RenderedAudioEncodingPlan> = {}): RenderedAudioEncodingPlan {
	return {
		format: 'wav',
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		outputFrames: 4,
		encoding: { bitDepth: 24, floatingPoint: false, sampleFormat: 'int24' },
		channelMapping: { mode: 'stereo' },
		ditherMode: 'triangular',
		metadata: { title: 'Mix' },
		markers: [],
		ixml: null,
		cart: null,
		...overrides,
	};
}

function fixture() {
	const calls: string[] = [];
	const wavInputs: Array<readonly Float32Array[]> = [];
	const wavOptions: Array<Readonly<Record<string, unknown>>> = [];
	const aiffOptions: Array<Readonly<Record<string, unknown>>> = [];
	const ffmpegInputs: Uint8Array[] = [];
	const ffmpegSettings: Array<Readonly<Record<string, unknown>>> = [];
	const resampleRequests: Array<Readonly<{ sampleRate: number; outputFrames: number }>> = [];
	const runtime: RenderedAudioEncodingRuntime = {
		applyMediaChannelMapping(this: unknown, channels) {
			assert.equal(this, undefined);
			calls.push('map');
			return channels;
		},
		audioBufferChannels(this: unknown, value) {
			assert.equal(this, undefined);
			calls.push('channels');
			return (value as TestBuffer).channels;
		},
		copy: { encoding: 'Encoding' },
		encodeAiff(this: unknown, _channels, options) {
			assert.equal(this, undefined);
			calls.push('aiff');
			aiffOptions.push(options);
			return Uint8Array.of(4, 5);
		},
		encodeWav(this: unknown, channels, options) {
			assert.equal(this, undefined);
			calls.push('wav');
			wavInputs.push(channels);
			wavOptions.push(options);
			return Uint8Array.of(1, 2, 3);
		},
		ffmpeg: {
			async encode(bytes, format, settings) {
				calls.push(`ffmpeg:${format}`);
				ffmpegInputs.push(bytes);
				ffmpegSettings.push(settings);
				return { bytes: Uint8Array.of(9), mimeType: `encoded/${format}` };
			},
		},
		async resampleBuffer(this: unknown, _input, sampleRate, _context, _copy, outputFrames) {
			assert.equal(this, undefined);
			calls.push('resample');
			resampleRequests.push({ sampleRate, outputFrames });
			return buffer(sampleRate, outputFrames);
		},
		setStatus(this: unknown, message) {
			assert.equal(this, undefined);
			calls.push(`status:${message}`);
		},
		throwIfAborted(this: unknown, signal) {
			assert.equal(this, undefined);
			calls.push('abort-check');
			if (signal.aborted) throw signal.reason;
		},
	};
	return {
		runtime, calls, wavInputs, wavOptions, aiffOptions, ffmpegInputs, ffmpegSettings, resampleRequests,
	};
}

test('rendered native WAV and AIFF encoding preserves the existing mapped container options', async () => {
	const wav = fixture();
	const wavResult = await encodeRenderedAudio(wav.runtime, {
		rendered: buffer(),
		plan: plan(),
		settings: { bitDepth: 16, measureLoudness: false },
		signal: new AbortController().signal,
	});
	assert.deepEqual(wavResult, { bytes: Uint8Array.of(1, 2, 3), mimeType: 'audio/wav' });
	assert.deepEqual(wav.calls, ['abort-check', 'abort-check', 'channels', 'map', 'wav']);
	assert.equal(wav.wavOptions[0]?.bitDepth, 24);
	assert.equal(wav.wavOptions[0]?.float, false);
	assert.equal(wav.wavOptions[0]?.sampleFormat, 'int24');
	assert.equal(wav.wavOptions[0]?.dither, 'triangular');
	assert.deepEqual(wav.wavOptions[0]?.metadata, { title: 'Mix' });

	const aiff = fixture();
	const aiffResult = await encodeRenderedAudio(aiff.runtime, {
		rendered: buffer(),
		plan: plan({ format: 'aiff', mimeType: 'audio/aiff' }),
		settings: {},
		signal: new AbortController().signal,
	});
	assert.deepEqual(aiffResult, { bytes: Uint8Array.of(4, 5), mimeType: 'audio/aiff' });
	assert.equal(aiff.aiffOptions.length, 1);
	assert.equal(aiff.wavOptions.length, 0);
});

test('rendered BWF encoding resamples to the exact plan length and merges measured loudness', async () => {
	const evidence = fixture();
	await encodeRenderedAudio(evidence.runtime, {
		rendered: buffer(44_100, 3),
		plan: plan({
			format: 'bwf',
			outputFrames: 6,
			bext: { description: 'Broadcast mix', version: 2 },
		}),
		settings: { measureLoudness: true },
		signal: new AbortController().signal,
	});
	assert.deepEqual(evidence.resampleRequests, [{ sampleRate: 48_000, outputFrames: 6 }]);
	assert.equal(evidence.wavInputs[0]?.[0]?.length, 6);
	const bext = evidence.wavOptions[0]?.bext as Readonly<Record<string, unknown>>;
	assert.equal(bext.description, 'Broadcast mix');
	assert.equal(bext.version, 2);
	for (const field of [
		'loudnessValue', 'loudnessRange', 'maxTruePeakLevel', 'maxMomentaryLoudness', 'maxShortTermLoudness',
	]) assert.equal(Object.hasOwn(bext, field), true, field);
});

test('rendered compressed encoding preserves integer staging and FFmpeg dither ownership', async () => {
	const flac = fixture();
	const flacResult = await encodeRenderedAudio(flac.runtime, {
		rendered: buffer(),
		plan: plan({
			format: 'flac', mimeType: 'audio/flac',
			encoding: { bitDepth: 24, sampleFormat: 'int24' },
		}),
		settings: { bitDepth: 24 },
		signal: new AbortController().signal,
	});
	assert.deepEqual(flacResult, { bytes: Uint8Array.of(9), mimeType: 'encoded/flac' });
	assert.deepEqual(flac.calls.slice(-4), ['wav', 'abort-check', 'status:Encoding', 'ffmpeg:flac']);
	assert.equal(flac.wavOptions[0]?.bitDepth, 24);
	assert.equal(flac.wavOptions[0]?.float, false);
	assert.equal(flac.wavOptions[0]?.dither, 'triangular');
	assert.equal(flac.ffmpegSettings[0]?.applyDither, false);

	const wavpack = fixture();
	await encodeRenderedAudio(wavpack.runtime, {
		rendered: buffer(),
		plan: plan({
			format: 'wavpack', mimeType: 'audio/x-wavpack',
			encoding: { bitDepth: 24, sampleFormat: 'int24' },
		}),
		settings: { bitDepth: 24 },
		signal: new AbortController().signal,
	});
	assert.equal(wavpack.wavOptions[0]?.bitDepth, 32);
	assert.equal(wavpack.wavOptions[0]?.float, true);
	assert.equal(wavpack.wavOptions[0]?.dither, 'none');
	assert.equal(wavpack.ffmpegSettings[0]?.applyDither, true);
	assert.deepEqual(wavpack.ffmpegInputs[0], Uint8Array.of(1, 2, 3));
});

test('rendered encoding refuses an already-aborted operation before touching audio', async () => {
	const evidence = fixture();
	const controller = new AbortController();
	const reason = new Error('cancelled');
	controller.abort(reason);
	await assert.rejects(
		encodeRenderedAudio(evidence.runtime, {
			rendered: buffer(), plan: plan(), settings: {}, signal: controller.signal,
		}),
		(error) => error === reason,
	);
	assert.deepEqual(evidence.calls, ['abort-check']);
});

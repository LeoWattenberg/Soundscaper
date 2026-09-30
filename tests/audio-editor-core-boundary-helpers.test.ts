/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	browserWebCodecsAudioConfiguration,
	browserWebCodecsAudioFullCodecString,
	probeBrowserWebCodecsAudioEncoding,
} from '../src/common/editor/browser-webcodecs-audio-profile.ts';
import { ComplementaryCrossover } from '../src/common/editor/complementary-crossover.ts';
import { safeFfmpegWorkerFsName } from '../src/common/editor/ffmpeg-workerfs-name.ts';
import {
	DEFAULT_FREQUENCY_WAVEFORM_FINEST_BLOCK_SIZE,
	frequencyWaveformFinestBlockSize,
	frequencyWaveformNeedsWindow,
} from '../src/common/editor/frequency-waveform-resolution.ts';

test('WORKERFS names cannot resolve to a parent or current directory', () => {
	assert.equal(safeFfmpegWorkerFsName('.', 'input.wav'), 'input.wav');
	assert.equal(safeFfmpegWorkerFsName('..', 'input.wav'), 'input.wav');
	assert.equal(safeFfmpegWorkerFsName('../take\\one.wav', 'input.wav'), '..-take-one.wav');
});

test('WORKERFS fallbacks are sanitized instead of reintroducing path separators', () => {
	const name = safeFfmpegWorkerFsName('', '../fallback\0.wav');
	assert.equal(name, '..-fallback-.wav');
	assert.doesNotMatch(name, /[\\/\0]/u);
	assert.equal(safeFfmpegWorkerFsName('', '..'), 'file');
});

test('frequency resolution falls back when persisted block-size coercion throws', () => {
	assert.equal(frequencyWaveformFinestBlockSize({ levels: [{ blockSize: Symbol('bad') }] }),
		DEFAULT_FREQUENCY_WAVEFORM_FINEST_BLOCK_SIZE);
	const hostile = Object.create(null) as Record<string, unknown>;
	let getterRan = false;
	Object.defineProperty(hostile, 'levels', { get(): never {
		getterRan = true;
		throw new Error('getter must not run');
	} });
	assert.equal(frequencyWaveformFinestBlockSize(hostile), DEFAULT_FREQUENCY_WAVEFORM_FINEST_BLOCK_SIZE);
	assert.equal(getterRan, false);
});

test('frequency resolution admits only positive safe block sizes and finer finite viewports', () => {
	assert.equal(frequencyWaveformFinestBlockSize({ levels: [{ blockSize: '512' }] }), 512);
	for (const blockSize of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
		assert.equal(frequencyWaveformFinestBlockSize({ levels: [{ blockSize }] }),
			DEFAULT_FREQUENCY_WAVEFORM_FINEST_BLOCK_SIZE);
	}
	assert.equal(frequencyWaveformNeedsWindow(511.5, { levels: [{ blockSize: 512 }] }), true);
	assert.equal(frequencyWaveformNeedsWindow(512, { levels: [{ blockSize: 512 }] }), false);
	assert.equal(frequencyWaveformNeedsWindow(Number.NaN, { levels: [{ blockSize: 512 }] }), false);
});

test('a complementary crossover refuses invalid sample-rate and channel geometry', () => {
	for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(() => new ComplementaryCrossover(rate, 1, 1_000), /sample rate/iu);
	}
	for (const channels of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => new ComplementaryCrossover(48_000, channels, 1_000), /channel count/iu);
	}
});

test('a complementary crossover refuses a frequency that would poison its state', () => {
	for (const frequency of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(() => new ComplementaryCrossover(48_000, 1, frequency), /frequency/iu);
	}
	const crossover = new ComplementaryCrossover(48_000, 1, 1_000);
	assert.throws(() => crossover.configure(Number.NaN), /frequency/iu);
	crossover.tick();
	assert.equal(Number.isFinite(crossover.low(1, 0)), true);
});

test('reset clears crossover history at the latest configured frequency', () => {
	const crossover = new ComplementaryCrossover(48_000, 1, 1_000);
	crossover.configure(5_000);
	for (let index = 0; index < 500; index += 1) {
		crossover.tick();
		crossover.low(index % 2, 0);
	}
	crossover.reset();
	const fresh = new ComplementaryCrossover(48_000, 1, 5_000);
	for (const input of [1, 0, -1, 0.5]) {
		assert.equal(crossover.low(input, 0), fresh.low(input, 0));
	}
});

test('WebCodecs audio profiles preserve their exact codec-specific configuration', () => {
	assert.deepEqual(browserWebCodecsAudioConfiguration('aac', {
		sampleRate: 48_000, channelCount: 2, bitrate: 192_000,
	}), {
		codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000,
		aac: { format: 'aac' },
	});
	assert.equal(browserWebCodecsAudioFullCodecString('opus'), 'opus');
});

test('WebCodecs audio profiles reject unknown codecs instead of silently selecting Opus', () => {
	assert.throws(() => browserWebCodecsAudioConfiguration('flac' as never, {
		sampleRate: 48_000, channelCount: 2, bitrate: 192_000,
	}), /codec/iu);
	assert.throws(() => browserWebCodecsAudioFullCodecString('flac' as never), /codec/iu);
});

test('WebCodecs audio probing contains missing, rejected, and throwing capability probes', async () => {
	const geometry = { sampleRate: 48_000, channelCount: 2, bitrate: 192_000 };
	assert.equal(await probeBrowserWebCodecsAudioEncoding('aac', geometry, undefined), false);
	assert.equal(await probeBrowserWebCodecsAudioEncoding('aac', geometry, {
		isConfigSupported: async () => ({ supported: false }),
	}), false);
	assert.equal(await probeBrowserWebCodecsAudioEncoding('aac', geometry, {
		isConfigSupported: async () => { throw new Error('probe failed'); },
	}), false);
	assert.equal(await probeBrowserWebCodecsAudioEncoding('opus', geometry, {
		isConfigSupported: async () => ({ supported: true }),
	}), true);
});

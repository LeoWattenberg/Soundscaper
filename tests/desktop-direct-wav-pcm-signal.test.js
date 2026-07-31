/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DIRECT_AIFF_SMOKE_FILE_BYTES, DIRECT_WAV_SMOKE_FILE_BYTES } from '../desktop/direct-wav-smoke.js';
import { DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE } from '../scripts/lib/desktop-direct-aiff-smoke-file.mjs';
import {
	DESKTOP_DIRECT_WAV_SIGNAL_LIMITS,
	createDesktopDirectWavPcmSignalAnalyzer,
	validateDesktopDirectWavPcmSignalEvidence,
} from '../scripts/lib/desktop-direct-wav-pcm-signal.mjs';
import {
	DESKTOP_DIRECT_WAV_SMOKE_FIXTURE,
	verifyDesktopDirectWavFile,
} from '../scripts/lib/desktop-direct-wav-smoke-evidence.mjs';

const SMALL_GEOMETRY = Object.freeze({
	sampleRate: 48_000,
	channelCount: 16,
	bitDepth: 16,
	frameCount: 5,
});
const SMALL_LIMITS = Object.freeze({
	minimumNonzeroFrames: 4,
	minimumPositiveFrames: 2,
	minimumNegativeFrames: 2,
	minimumZeroCrossings: 1,
	maximumZeroCrossings: 1,
	minimumPeakAbsoluteSample: 100,
	maximumPeakAbsoluteSample: 100,
	maximumAbsoluteMeanSample: 0,
	minimumRmsSample: 63,
	maximumRmsSample: 64,
});

test('PCM signal analyzer retains at most one partial frame across one-byte pushes', () => {
	const bytes = interleavedPcm([-100, -1, 0, 1, 100], SMALL_GEOMETRY.channelCount);
	const analyzer = createDesktopDirectWavPcmSignalAnalyzer(SMALL_GEOMETRY);
	for (const byte of bytes) analyzer.push(Uint8Array.of(byte));
	const signal = analyzer.finish();

	assert.deepEqual(signal, {
		frameCount: 5,
		channelComparisons: 75,
		channelMismatchSamples: 0,
		maximumCarryBytes: 31,
		nonzeroFrames: 4,
		positiveFrames: 2,
		negativeFrames: 2,
		zeroCrossings: 1,
		peakAbsoluteSample: 100,
		sampleSum: 0,
		sampleSquareSum: 20_002,
		meanSample: 0,
		rmsSample: Math.sqrt(4_000.4),
	});
	assert.equal(Object.isFrozen(signal), true);
	assert.deepEqual(
		validateDesktopDirectWavPcmSignalEvidence(signal, SMALL_GEOMETRY, SMALL_LIMITS),
		signal,
	);
});

test('PCM signal validation rejects channel drift, silence, DC, and wrong level statistics', () => {
	const cases = [
		['channel mapping', [-100, -1, 0, 1, 100], { frame: 2, channel: 15, sample: 1 }],
		['nonzero signal', [0, 0, 0, 0, 0], null],
		['positive and negative', [100, 100, 100, 100, 100], null],
		['peak', [-10, -10, 0, 10, 10], null],
	];
	for (const [message, samples, mutation] of cases) {
		const analyzer = createDesktopDirectWavPcmSignalAnalyzer(SMALL_GEOMETRY);
		analyzer.push(interleavedPcm(samples, SMALL_GEOMETRY.channelCount, mutation));
		assert.throws(
			() => validateDesktopDirectWavPcmSignalEvidence(analyzer.finish(), SMALL_GEOMETRY, SMALL_LIMITS),
			new RegExp(message, 'iu'),
		);
	}
	const valid = analyze([-100, -1, 0, 1, 100]);
	for (const [field, value, message] of [
		['meanSample', 1, 'mean'],
		['rmsSample', 62, 'RMS'],
		['zeroCrossings', 0, 'crossing'],
	]) {
		assert.throws(
			() => validateDesktopDirectWavPcmSignalEvidence({ ...valid, [field]: value }, SMALL_GEOMETRY, SMALL_LIMITS),
			new RegExp(message, 'iu'),
		);
	}
});

test('PCM signal analyzer rejects incomplete and excess frame streams', () => {
	const bytes = interleavedPcm([-100, -1, 0, 1, 100], SMALL_GEOMETRY.channelCount);
	const incomplete = createDesktopDirectWavPcmSignalAnalyzer(SMALL_GEOMETRY);
	incomplete.push(bytes.subarray(0, bytes.byteLength - 1));
	assert.throws(() => incomplete.finish(), /partial PCM frame/iu);

	const excess = createDesktopDirectWavPcmSignalAnalyzer(SMALL_GEOMETRY);
	excess.push(interleavedPcm([-100, -1, 0, 1, 100, 101], SMALL_GEOMETRY.channelCount));
	assert.throws(() => excess.finish(), /frame count/iu);
	assert.throws(() => excess.push(new Uint8Array(0)), /finished/iu);
});

test('reference signal limits admit the observed 6,335,992-frame tone evidence', () => {
	assert.deepEqual(DESKTOP_DIRECT_WAV_SIGNAL_LIMITS, {
		minimumNonzeroFrames: 6_300_000,
		minimumPositiveFrames: 3_100_000,
		minimumNegativeFrames: 3_100_000,
		minimumZeroCrossings: 7_240,
		maximumZeroCrossings: 7_280,
		minimumPeakAbsoluteSample: 9_175,
		maximumPeakAbsoluteSample: 10_486,
		maximumAbsoluteMeanSample: 16,
		minimumRmsSample: 6_554,
		maximumRmsSample: 7_373,
	});
	const geometry = { channelCount: 16, bitDepth: 16, frameCount: 6_335_992 };
	const signal = {
		frameCount: geometry.frameCount,
		channelComparisons: geometry.frameCount * 15,
		channelMismatchSamples: 0,
		maximumCarryBytes: 31,
		nonzeroFrames: 6_335_333,
		positiveFrames: 3_167_671,
		negativeFrames: 3_167_662,
		zeroCrossings: 7_259,
		peakAbsoluteSample: 9_830,
		sampleSum: 2_612,
		sampleSquareSum: 306_120_561_101_570,
		meanSample: 0.000_412_247_995_262_620_3,
		rmsSample: 6_950.866_384_869_063,
	};
	assert.deepEqual(validateDesktopDirectWavPcmSignalEvidence(signal, geometry), signal);
});

test('PCM signal evidence retains exact statistics for the long authored-BW64 geometry', () => {
	const geometry = { channelCount: 6, bitDepth: 16, frameCount: 16_896_000 };
	const limits = {
		minimumNonzeroFrames: 16_800_000,
		minimumPositiveFrames: 8_300_000,
		minimumNegativeFrames: 8_300_000,
		minimumZeroCrossings: 19_340,
		maximumZeroCrossings: 19_380,
		minimumPeakAbsoluteSample: 9_175,
		maximumPeakAbsoluteSample: 10_486,
		maximumAbsoluteMeanSample: 16,
		minimumRmsSample: 6_554,
		maximumRmsSample: 7_373,
	};
	const signal = {
		frameCount: geometry.frameCount,
		channelComparisons: geometry.frameCount * 5,
		channelMismatchSamples: 0,
		maximumCarryBytes: 11,
		nonzeroFrames: 16_894_240,
		positiveFrames: 8_447_120,
		negativeFrames: 8_447_120,
		zeroCrossings: 19_359,
		peakAbsoluteSample: 9_830,
		sampleSum: 0,
		sampleSquareSum: 816_000_000_000_000,
		meanSample: 0,
		rmsSample: Math.sqrt(816_000_000_000_000 / geometry.frameCount),
	};
	assert.deepEqual(
		validateDesktopDirectWavPcmSignalEvidence(signal, geometry, limits),
		signal,
	);
	assert.doesNotThrow(() => createDesktopDirectWavPcmSignalAnalyzer(geometry));
});

test('renderer and verifier share one derived completed-file byte contract', () => {
	const output = DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output;
	assert.equal(output.dataBytes, output.frameCount * output.channelCount * output.bitDepth / 8);
	assert.equal(output.byteLength, 44 + output.dataBytes);
	assert.equal(DIRECT_WAV_SMOKE_FILE_BYTES, output.byteLength);
	assert.equal(DIRECT_AIFF_SMOKE_FILE_BYTES, DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE.output.byteLength);
});

test('completed-file verification produces identical signal evidence across one-byte and odd reads', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'direct-wav-signal-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const samples = [-100, -1, 0, 1, 100];
	const wav = pcmWav(SMALL_GEOMETRY, interleavedPcm(samples, SMALL_GEOMETRY.channelCount));
	const path = join(root, 'signal.wav');
	await writeFile(path, wav);

	const oneByte = await verifyDesktopDirectWavFile(path, {
		expected: SMALL_GEOMETRY,
		readChunkBytes: 1,
		signalLimits: SMALL_LIMITS,
	});
	const odd = await verifyDesktopDirectWavFile(path, {
		expected: SMALL_GEOMETRY,
		readChunkBytes: 7,
		signalLimits: SMALL_LIMITS,
	});
	const byChunkBytes = new Map([[1, oneByte], [7, odd]]);
	for (const readChunkBytes of [31, 32, 33, 1024 * 1024]) {
		byChunkBytes.set(readChunkBytes, await verifyDesktopDirectWavFile(path, {
			expected: SMALL_GEOMETRY, readChunkBytes, signalLimits: SMALL_LIMITS,
		}));
	}
	const { maximumCarryBytes: baselineCarry, ...baselineSignal } = oneByte.signal;
	for (const result of byChunkBytes.values()) {
		const { maximumCarryBytes, ...stableSignal } = result.signal;
		assert.deepEqual(stableSignal, baselineSignal);
		assert.ok(maximumCarryBytes <= SMALL_GEOMETRY.channelCount * 2 - 1);
	}
	assert.equal(baselineCarry, 31);
	assert.equal(oneByte.maximumReadChunkBytes, 1);
	assert.equal(odd.maximumReadChunkBytes, 7);
	assert.equal(oneByte.sha256, createHash('sha256').update(wav).digest('hex'));
	await t.test('header, declared size, and symbolic outputs still fail closed', async (subtest) => {
		const malformed = Buffer.from(wav);
		malformed.write('RIFX', 0);
		const malformedPath = join(root, 'malformed.wav');
		await writeFile(malformedPath, malformed);
		await assert.rejects(() => verifyDesktopDirectWavFile(malformedPath, {
			expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS,
		}), /RIFF/iu);
		const oversizedPath = join(root, 'oversized.wav');
		await writeFile(oversizedPath, wav);
		await appendFile(oversizedPath, Buffer.of(0));
		await assert.rejects(() => verifyDesktopDirectWavFile(oversizedPath, {
			expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS,
		}), /byte length/iu);
		const link = join(root, 'link.wav');
		try {
			await symlink(path, link);
		} catch (error) {
			if (error?.code === 'EPERM') return subtest.skip('symbolic links are unavailable');
			throw error;
		}
		await assert.rejects(() => verifyDesktopDirectWavFile(link, {
			expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS,
		}), /regular.*file|symbolic/iu);
	});

	const mutated = Buffer.from(wav);
	mutated.writeInt16LE(1, 44 + (2 * SMALL_GEOMETRY.channelCount + 15) * 2);
	await writeFile(path, mutated);
	await assert.rejects(() => verifyDesktopDirectWavFile(path, {
		expected: SMALL_GEOMETRY,
		readChunkBytes: 33,
		signalLimits: SMALL_LIMITS,
	}), /channel mapping/iu);
});

function analyze(samples) {
	const analyzer = createDesktopDirectWavPcmSignalAnalyzer(SMALL_GEOMETRY);
	analyzer.push(interleavedPcm(samples, SMALL_GEOMETRY.channelCount));
	return analyzer.finish();
}

function interleavedPcm(samples, channelCount, mutation = null) {
	const bytes = new Uint8Array(samples.length * channelCount * 2);
	const view = new DataView(bytes.buffer);
	for (let frame = 0; frame < samples.length; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			const sample = mutation?.frame === frame && mutation.channel === channel
				? mutation.sample
				: samples[frame];
			view.setInt16((frame * channelCount + channel) * 2, sample, true);
		}
	}
	return bytes;
}

function pcmWav(expected, pcm) {
	const bytes = Buffer.alloc(44 + pcm.byteLength);
	bytes.write('RIFF', 0);
	bytes.writeUInt32LE(bytes.byteLength - 8, 4);
	bytes.write('WAVE', 8);
	bytes.write('fmt ', 12);
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(expected.channelCount, 22);
	bytes.writeUInt32LE(expected.sampleRate, 24);
	bytes.writeUInt32LE(expected.sampleRate * expected.channelCount * 2, 28);
	bytes.writeUInt16LE(expected.channelCount * 2, 32);
	bytes.writeUInt16LE(16, 34);
	bytes.write('data', 36);
	bytes.writeUInt32LE(pcm.byteLength, 40);
	bytes.set(pcm, 44);
	return bytes;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	DESKTOP_DIRECT_PCM_SIGNAL_LIMITS,
	DESKTOP_DIRECT_WAV_SIGNAL_LIMITS,
	createDesktopDirectPcmSignalAnalyzer,
	validateDesktopDirectPcmSignalEvidence,
} from '../scripts/lib/desktop-direct-wav-pcm-signal.mjs';
import {
	DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE,
	validateDesktopDirectAiffFileEvidence,
	verifyDesktopDirectAiffFile,
} from '../scripts/lib/desktop-direct-aiff-smoke-file.mjs';

const SMALL_GEOMETRY = Object.freeze({
	sampleRate: 48_000,
	sampleRateHex: '400ebb80000000000000',
	channelCount: 2,
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

test('direct-AIFF completed geometry is one exact integer FORM contract', () => {
	assert.deepEqual(DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE, {
		output: {
			sampleRate: 384_000,
			sampleRateHex: '4011bb80000000000000',
			channelCount: 16,
			bitDepth: 16,
			frameCount: 6_336_000,
			headerBytes: 54,
			dataBytes: 202_752_000,
			byteLength: 202_752_054,
		},
	});
	assert.equal(Object.isFrozen(DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE.output), true);
});

test('completed AIFF file evidence validation admits only the exact verifier shape', () => {
	const valid = productionFileEvidence();
	assert.deepEqual(validateDesktopDirectAiffFileEvidence(valid), valid);
	assert.equal(Object.isFrozen(validateDesktopDirectAiffFileEvidence(valid)), true);
	assert.equal(Object.isFrozen(validateDesktopDirectAiffFileEvidence(valid).aiff), true);
	assert.equal(Object.isFrozen(validateDesktopDirectAiffFileEvidence(valid).signal), true);
	for (const mutation of [
		(value) => { value.unexpected = true; },
		(value) => { delete value.sha256; },
		(value) => { value.sha256 = 'A'.repeat(64); },
		(value) => { value.maximumReadChunkBytes = 1024 * 1024 + 1; },
		(value) => { value.aiff.trailingBytes = 1; },
		(value) => { value.aiff.unexpected = 0; },
		(value) => { value.signal.frameCount -= 1; },
	]) {
		const evidence = structuredClone(valid);
		mutation(evidence);
		assert.throws(() => validateDesktopDirectAiffFileEvidence(evidence), /AIFF|PCM/iu);
	}
});

test('AIFF verification rechecks mutation metadata and the completed path identity', async () => {
	const source = await readFile(new URL('../scripts/lib/desktop-direct-aiff-smoke-file.mjs', import.meta.url), 'utf8');
	assert.match(source, /current\.isSymbolicLink\(\)/u);
	assert.match(source, /current\.mtimeMs !== expected\.mtimeMs/u);
	assert.match(source, /current\.ctimeMs !== expected\.ctimeMs/u);
	assert.match(source, /afterPath = await lstat\(path\)/u);
	assert.match(source, /assertStableIdentity\(afterPath, pathMetadata, 'during path validation'\)/u);
});

test('generic PCM signal aliases preserve little endian and opt into big endian explicitly', () => {
	assert.equal(DESKTOP_DIRECT_PCM_SIGNAL_LIMITS, DESKTOP_DIRECT_WAV_SIGNAL_LIMITS);
	const samples = [-100, -1, 0, 1, 100];
	const expected = expectedSignal(3);
	const bigEndian = createDesktopDirectPcmSignalAnalyzer(SMALL_GEOMETRY, { byteOrder: 'big-endian' });
	const bytes = interleavedPcm(samples, SMALL_GEOMETRY.channelCount, false);
	for (const byte of bytes) bigEndian.push(Uint8Array.of(byte));
	assert.deepEqual(bigEndian.finish(), expected);

	const littleEndian = createDesktopDirectPcmSignalAnalyzer(SMALL_GEOMETRY);
	littleEndian.push(interleavedPcm(samples, SMALL_GEOMETRY.channelCount, true));
	assert.deepEqual(littleEndian.finish(), { ...expected, maximumCarryBytes: 0 });
	assert.deepEqual(
		validateDesktopDirectPcmSignalEvidence(expected, SMALL_GEOMETRY, SMALL_LIMITS),
		expected,
	);
	assert.throws(
		() => createDesktopDirectPcmSignalAnalyzer(SMALL_GEOMETRY, { byteOrder: 'native' }),
		/byte order/iu,
	);
});

test('completed AIFF verification is stable across one-byte and odd streaming reads', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'direct-aiff-file-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const samples = [-100, -1, 0, 1, 100];
	const aiff = pcmAiff(SMALL_GEOMETRY, interleavedPcm(samples, SMALL_GEOMETRY.channelCount, false));
	const path = join(root, 'completed.aiff');
	await writeFile(path, aiff);

	const oneByte = await verifyDesktopDirectAiffFile(path, {
		expected: SMALL_GEOMETRY,
		readChunkBytes: 1,
		signalLimits: SMALL_LIMITS,
	});
	const odd = await verifyDesktopDirectAiffFile(path, {
		expected: SMALL_GEOMETRY,
		readChunkBytes: 7,
		signalLimits: SMALL_LIMITS,
	});
	assert.deepEqual(oneByte.aiff, {
		formId: 'FORM',
		formBytes: 74,
		typeId: 'AIFF',
		commId: 'COMM',
		commBytes: 18,
		channelCount: 2,
		frameCount: 5,
		bitsPerSample: 16,
		sampleRateHex: SMALL_GEOMETRY.sampleRateHex,
		soundId: 'SSND',
		soundBytes: 28,
		offset: 0,
		blockSize: 0,
		pcmOffset: 54,
		pcmBytes: 20,
		dataPadBytes: 0,
		trailingBytes: 0,
	});
	assert.deepEqual(oneByte.aiff, odd.aiff);
	assert.deepEqual(
		omitCarry(oneByte.signal),
		omitCarry(odd.signal),
	);
	assert.ok(oneByte.signal.maximumCarryBytes <= 3);
	assert.ok(odd.signal.maximumCarryBytes <= 3);
	assert.equal(oneByte.maximumReadChunkBytes, 1);
	assert.equal(odd.maximumReadChunkBytes, 7);
	assert.equal(oneByte.byteLength, aiff.byteLength);
	assert.equal(oneByte.sha256, createHash('sha256').update(aiff).digest('hex'));
	assert.equal(Object.isFrozen(oneByte.aiff), true);
	assert.equal(Object.isFrozen(oneByte.signal), true);

	await t.test('regular non-symbolic output is required', async (subtest) => {
		const link = join(root, 'linked.aiff');
		try {
			await symlink(path, link);
		} catch (error) {
			if (error?.code === 'EPERM') return subtest.skip('symbolic links are unavailable');
			throw error;
		}
		await assert.rejects(
			() => verifyDesktopDirectAiffFile(link, { expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS }),
			/regular.*file|symbolic/iu,
		);
	});
});

test('completed AIFF verification rejects geometry corruption, trailing bytes, and wrong-endian PCM', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'direct-aiff-corruption-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const pcm = interleavedPcm([-100, -1, 0, 1, 100], SMALL_GEOMETRY.channelCount, false);
	const valid = pcmAiff(SMALL_GEOMETRY, pcm);
	const mutations = [
		['FORM', (bytes) => bytes.write('F0RM', 0)],
		['FORM byte length', (bytes) => bytes.writeUInt32BE(bytes.byteLength - 9, 4)],
		['AIFF type', (bytes) => bytes.write('AIFC', 8)],
		['COMM', (bytes) => bytes.write('C0MM', 12)],
		['COMM size', (bytes) => bytes.writeUInt32BE(19, 16)],
		['sample rate', (bytes) => { bytes[28] ^= 1; }],
		['SSND', (bytes) => bytes.write('S5ND', 38)],
		['SSND size', (bytes) => bytes.writeUInt32BE(27, 42)],
		['offset', (bytes) => bytes.writeUInt32BE(1, 46)],
		['block size', (bytes) => bytes.writeUInt32BE(1, 50)],
	];
	for (const [label, mutate] of mutations) {
		const bytes = Buffer.from(valid);
		mutate(bytes);
		const path = join(root, `${label.replaceAll(' ', '-')}.aiff`);
		await writeFile(path, bytes);
		await assert.rejects(
			() => verifyDesktopDirectAiffFile(path, { expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS }),
			new RegExp(label, 'iu'),
		);
	}

	const trailing = join(root, 'trailing.aiff');
	await writeFile(trailing, valid);
	await appendFile(trailing, Buffer.of(0));
	await assert.rejects(
		() => verifyDesktopDirectAiffFile(trailing, { expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS }),
		/byte length|trailing/iu,
	);

	const wrongEndian = join(root, 'wrong-endian.aiff');
	await writeFile(wrongEndian, pcmAiff(
		SMALL_GEOMETRY,
		interleavedPcm([-100, -1, 0, 1, 100], SMALL_GEOMETRY.channelCount, true),
	));
	await assert.rejects(
		() => verifyDesktopDirectAiffFile(wrongEndian, { expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS }),
		/peak|signal/iu,
	);
});

function expectedSignal(maximumCarryBytes) {
	return {
		frameCount: 5,
		channelComparisons: 5,
		channelMismatchSamples: 0,
		maximumCarryBytes,
		nonzeroFrames: 4,
		positiveFrames: 2,
		negativeFrames: 2,
		zeroCrossings: 1,
		peakAbsoluteSample: 100,
		sampleSum: 0,
		sampleSquareSum: 20_002,
		meanSample: 0,
		rmsSample: Math.sqrt(4_000.4),
	};
}

function productionFileEvidence() {
	const output = DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE.output;
	return {
		byteLength: output.byteLength,
		sha256: 'a'.repeat(64),
		maximumReadChunkBytes: 1024 * 1024,
		aiff: {
			formId: 'FORM',
			formBytes: output.byteLength,
			typeId: 'AIFF',
			commId: 'COMM',
			commBytes: 18,
			channelCount: output.channelCount,
			frameCount: output.frameCount,
			bitsPerSample: output.bitDepth,
			sampleRateHex: output.sampleRateHex,
			soundId: 'SSND',
			soundBytes: output.dataBytes + 8,
			offset: 0,
			blockSize: 0,
			pcmOffset: output.headerBytes,
			pcmBytes: output.dataBytes,
			dataPadBytes: 0,
			trailingBytes: 0,
		},
		signal: {
			frameCount: output.frameCount,
			channelComparisons: output.frameCount * (output.channelCount - 1),
			channelMismatchSamples: 0,
			maximumCarryBytes: 0,
			nonzeroFrames: 6_300_000,
			positiveFrames: 3_150_000,
			negativeFrames: 3_150_000,
			zeroCrossings: 7_260,
			peakAbsoluteSample: 10_000,
			sampleSum: 0,
			sampleSquareSum: output.frameCount * 7_000 ** 2,
			meanSample: 0,
			rmsSample: 7_000,
		},
	};
}

function omitCarry(value) {
	const { maximumCarryBytes: _maximumCarryBytes, ...stable } = value;
	return stable;
}

function interleavedPcm(samples, channelCount, littleEndian) {
	const bytes = new Uint8Array(samples.length * channelCount * 2);
	const view = new DataView(bytes.buffer);
	for (let frame = 0; frame < samples.length; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			view.setInt16((frame * channelCount + channel) * 2, samples[frame], littleEndian);
		}
	}
	return bytes;
}

function pcmAiff(expected, pcm) {
	const bytes = Buffer.alloc(54 + pcm.byteLength);
	bytes.write('FORM', 0);
	bytes.writeUInt32BE(bytes.byteLength - 8, 4);
	bytes.write('AIFF', 8);
	bytes.write('COMM', 12);
	bytes.writeUInt32BE(18, 16);
	bytes.writeUInt16BE(expected.channelCount, 20);
	bytes.writeUInt32BE(expected.frameCount, 22);
	bytes.writeUInt16BE(expected.bitDepth, 26);
	bytes.set(Buffer.from(expected.sampleRateHex, 'hex'), 28);
	bytes.write('SSND', 38);
	bytes.writeUInt32BE(pcm.byteLength + 8, 42);
	bytes.writeUInt32BE(0, 46);
	bytes.writeUInt32BE(0, 50);
	bytes.set(pcm, 54);
	return bytes;
}

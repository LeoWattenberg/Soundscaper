/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createWavHeader } from '../src/common/editor/wav.js';
import {
	DESKTOP_DIRECT_BWF_SMOKE_FIXTURE,
	validateDesktopDirectBwfFileEvidence,
	verifyDesktopDirectBwfFile,
} from '../scripts/lib/desktop-direct-bwf-smoke-file.mjs';

const PACKAGED_BWF_UMID = [
	'060a2b340101010501010d0013000000',
	'0123456789abcdef0123456789abcdef',
	'112233445566778899aabbccddeeff00',
	'ffeeddccbbaa99887766554433221100',
].join('');
const SMALL_GEOMETRY = Object.freeze({
	sampleRate: 384_000,
	channelCount: 4,
	bitDepth: 16,
	frameCount: 5,
	bextPayloadBytes: 689,
	bextChunkBytes: 698,
	formatBytes: 40,
	headerByteLength: 766,
	dataBytes: 40,
	dataPadBytes: 0,
	trailingBytes: 0,
	byteLength: 806,
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

test('direct-BWF completed geometry and authored BEXT form one exact fixture contract', () => {
	assert.deepEqual(DESKTOP_DIRECT_BWF_SMOKE_FIXTURE, {
		input: { sampleRate: 48_000, timeReference: '6000' },
		output: {
			sampleRate: 384_000,
			channelCount: 16,
			bitDepth: 16,
			frameCount: 6_336_000,
			bextPayloadBytes: 689,
			bextChunkBytes: 698,
			formatBytes: 40,
			headerByteLength: 766,
			dataBytes: 202_752_000,
			dataPadBytes: 0,
			trailingBytes: 0,
			byteLength: 202_752_766,
		},
		bext: {
			description: 'Soundscaper packaged BWF smoke',
			originator: 'Soundscaper',
			originatorReference: 'PACKAGED-BWF-0001',
			originationDate: '2026-07-30',
			originationTime: '12:34:56',
			timeReference: '48000',
			version: 2,
			umid: PACKAGED_BWF_UMID,
			loudnessValue: null,
			loudnessRange: null,
			maxTruePeakLevel: null,
			maxMomentaryLoudness: null,
			maxShortTermLoudness: null,
			codingHistory: 'A=PCM,F=48000,W=16,M=stereo,T=SmokeFixture\nA=PCM,F=384000,W=16,M=multi,T=Soundscaper\n',
		},
	});
	assert.equal(Object.isFrozen(DESKTOP_DIRECT_BWF_SMOKE_FIXTURE), true);
	assert.equal(Object.isFrozen(DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.output), true);
	assert.equal(Object.isFrozen(DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.bext), true);
	assert.match(DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.bext.umid, /^[a-f\d]{128}$/u);
	assert.equal(Buffer.from(DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.bext.umid, 'hex').byteLength, 64);
	assert.equal(
		Number(DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.input.timeReference)
			* DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.output.sampleRate
			/ DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.input.sampleRate,
		Number(DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.bext.timeReference),
	);
	assert.equal(Buffer.byteLength(
		DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.bext.codingHistory.replaceAll('\n', '\r\n'),
		'ascii',
	), 87);
});

test('completed BWF evidence validation admits only the exact production verifier shape', () => {
	const valid = productionFileEvidence();
	const validated = validateDesktopDirectBwfFileEvidence(valid);
	assert.deepEqual(validated, valid);
	assert.equal(Object.isFrozen(validated), true);
	assert.equal(Object.isFrozen(validated.riff), true);
	assert.equal(Object.isFrozen(validated.bext), true);
	assert.equal(Object.isFrozen(validated.signal), true);
	for (const mutation of [
		(value) => { value.unexpected = true; },
		(value) => { delete value.sha256; },
		(value) => { value.sha256 = 'A'.repeat(64); },
		(value) => { value.maximumReadChunkBytes = 1024 * 1024 + 1; },
		(value) => { value.riff.trailingBytes = 1; },
		(value) => { value.riff.unexpected = 0; },
		(value) => { value.bext.description = 'Different'; },
		(value) => { value.bext.umid = value.bext.umid.toUpperCase(); },
		(value) => { value.bext.unexpected = 0; },
		(value) => { value.signal.frameCount -= 1; },
	]) {
		const evidence = structuredClone(valid);
		mutation(evidence);
		assert.throws(() => validateDesktopDirectBwfFileEvidence(evidence), /BWF|PCM/iu);
	}
});

test('completed BWF verification streams exact RIFF, BEXT, extensible fmt, and signal evidence', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'direct-bwf-file-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const samples = [-100, -1, 0, 1, 100];
	const bwf = pcmBwf(SMALL_GEOMETRY, samples);
	assert.equal(bwf.subarray(368, 432).toString('hex'), PACKAGED_BWF_UMID);
	const path = join(root, 'completed-bwf.wav');
	await writeFile(path, bwf);

	const oneByte = await verifyDesktopDirectBwfFile(path, {
		expected: SMALL_GEOMETRY,
		readChunkBytes: 1,
		signalLimits: SMALL_LIMITS,
	});
	const odd = await verifyDesktopDirectBwfFile(path, {
		expected: SMALL_GEOMETRY,
		readChunkBytes: 11,
		signalLimits: SMALL_LIMITS,
	});
	assert.deepEqual(oneByte.riff, expectedRiff(SMALL_GEOMETRY));
	assert.deepEqual(oneByte.bext, DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.bext);
	assert.deepEqual(omitCarry(oneByte.signal), omitCarry(odd.signal));
	assert.ok(oneByte.signal.maximumCarryBytes <= 7);
	assert.ok(odd.signal.maximumCarryBytes <= 7);
	assert.equal(oneByte.maximumReadChunkBytes, 1);
	assert.equal(odd.maximumReadChunkBytes, 11);
	assert.equal(oneByte.byteLength, bwf.byteLength);
	assert.equal(oneByte.sha256, createHash('sha256').update(bwf).digest('hex'));
	assert.equal(Object.isFrozen(oneByte.riff), true);
	assert.equal(Object.isFrozen(oneByte.bext), true);
	assert.equal(Object.isFrozen(oneByte.signal), true);

	await t.test('regular non-symbolic output is required', async (subtest) => {
		const link = join(root, 'linked-bwf.wav');
		try {
			await symlink(path, link);
		} catch (error) {
			if (error?.code === 'EPERM') return subtest.skip('symbolic links are unavailable');
			throw error;
		}
		await assert.rejects(
			() => verifyDesktopDirectBwfFile(link, { expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS }),
			/regular.*file|symbolic/iu,
		);
	});
});

test('completed BWF verification rejects chunk, geometry, and BEXT metadata corruption', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'direct-bwf-corruption-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const valid = pcmBwf(SMALL_GEOMETRY, [-100, -1, 0, 1, 100]);
	const mutations = [
		['RIFF id', (bytes) => bytes.write('RIFX', 0)],
		['RIFF byte length', (bytes) => bytes.writeUInt32LE(bytes.byteLength - 9, 4)],
		['WAVE id', (bytes) => bytes.write('WAVX', 8)],
		['bext order', (bytes) => bytes.write('fmt ', 12)],
		['bext payload', (bytes) => bytes.writeUInt32LE(688, 16)],
		['BEXT description', (bytes) => { bytes[20] ^= 1; }],
		['BEXT originator', (bytes) => { bytes[276] ^= 1; }],
		['BEXT originator reference', (bytes) => { bytes[308] ^= 1; }],
		['BEXT date', (bytes) => { bytes[340] ^= 1; }],
		['BEXT time', (bytes) => { bytes[350] ^= 1; }],
		['BEXT time reference', (bytes) => { bytes[358] ^= 1; }],
		['BEXT version', (bytes) => bytes.writeUInt16LE(1, 366)],
		['BEXT UMID', (bytes) => { bytes[368] ^= 0xff; }],
		['BEXT loudness', (bytes) => bytes.writeUInt16LE(0, 432)],
		['BEXT reserved', (bytes) => { bytes[442] = 1; }],
		['BEXT coding history', (bytes) => { bytes[622] ^= 1; }],
		['bext pad', (bytes) => { bytes[709] = 1; }],
		['fmt order', (bytes) => bytes.write('data', 710)],
		['fmt payload', (bytes) => bytes.writeUInt32LE(16, 714)],
		['format tag', (bytes) => bytes.writeUInt16LE(1, 718)],
		['channel count', (bytes) => bytes.writeUInt16LE(3, 720)],
		['sample rate', (bytes) => bytes.writeUInt32LE(48_000, 722)],
		['byte rate', (bytes) => bytes.writeUInt32LE(1, 726)],
		['block alignment', (bytes) => bytes.writeUInt16LE(1, 730)],
		['bits per sample', (bytes) => bytes.writeUInt16LE(24, 732)],
		['extension size', (bytes) => bytes.writeUInt16LE(0, 734)],
		['valid bits', (bytes) => bytes.writeUInt16LE(15, 736)],
		['channel mask', (bytes) => bytes.writeUInt32LE(0, 738)],
		['PCM subformat', (bytes) => { bytes[742] ^= 1; }],
		['data order', (bytes) => bytes.write('JUNK', 758)],
		['data byte length', (bytes) => bytes.writeUInt32LE(39, 762)],
	];
	for (const [label, mutate] of mutations) {
		const bytes = Buffer.from(valid);
		mutate(bytes);
		const path = join(root, `${label.replaceAll(' ', '-')}.wav`);
		await writeFile(path, bytes);
		await assert.rejects(
			() => verifyDesktopDirectBwfFile(path, { expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS }),
			new RegExp(label, 'iu'),
		);
	}

	const trailing = join(root, 'trailing.wav');
	await writeFile(trailing, valid);
	await appendFile(trailing, Buffer.of(0));
	await assert.rejects(
		() => verifyDesktopDirectBwfFile(trailing, { expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS }),
		/byte length|trailing/iu,
	);

	const mismatched = Buffer.from(valid);
	mismatched.writeInt16LE(1, SMALL_GEOMETRY.headerByteLength + 2);
	const mismatchedPath = join(root, 'channel-mismatch.wav');
	await writeFile(mismatchedPath, mismatched);
	await assert.rejects(
		() => verifyDesktopDirectBwfFile(mismatchedPath, { expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS }),
		/channel mapping/iu,
	);
});

test('completed BWF verification rejects non-normalized paths and invalid expected schemas', async () => {
	await assert.rejects(() => verifyDesktopDirectBwfFile('relative.wav'), /absolute|normalized/iu);
	await assert.rejects(() => verifyDesktopDirectBwfFile('/tmp/direct-bwf/../file.wav'), /absolute|normalized/iu);
	await assert.rejects(() => verifyDesktopDirectBwfFile('/tmp/bad\0file.wav'), /path/iu);
	for (const expected of [
		null,
		{ ...SMALL_GEOMETRY, unexpected: true },
		{ ...SMALL_GEOMETRY, channelCount: 2 },
		{ ...SMALL_GEOMETRY, bitDepth: 24 },
		{ ...SMALL_GEOMETRY, headerByteLength: 765 },
		{ ...SMALL_GEOMETRY, dataBytes: 39 },
		{ ...SMALL_GEOMETRY, byteLength: 805 },
	]) {
		await assert.rejects(
			() => verifyDesktopDirectBwfFile('/tmp/missing-bwf.wav', { expected }),
			/BWF/iu,
		);
	}
});

function pcmBwf(expected, samples) {
	const header = createWavHeader({
		sampleRate: expected.sampleRate,
		channelCount: expected.channelCount,
		totalFrames: expected.frameCount,
		bitDepth: expected.bitDepth,
		bext: DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.bext,
		channelMask: expected.channelCount === 32 ? 0xffff_ffff : (2 ** expected.channelCount - 1) >>> 0,
	});
	assert.equal(header.byteLength, expected.headerByteLength);
	const pcm = Buffer.alloc(samples.length * expected.channelCount * 2);
	for (let frame = 0; frame < samples.length; frame += 1) {
		for (let channel = 0; channel < expected.channelCount; channel += 1) {
			pcm.writeInt16LE(samples[frame], (frame * expected.channelCount + channel) * 2);
		}
	}
	return Buffer.concat([header, pcm]);
}

function expectedRiff(expected) {
	return {
		riffId: 'RIFF',
		riffBytes: expected.byteLength,
		waveId: 'WAVE',
		bextId: 'bext',
		bextOffset: 12,
		bextPayloadBytes: 689,
		bextPadBytes: 1,
		formatId: 'fmt ',
		formatOffset: 710,
		formatBytes: 40,
		formatTag: 0xfffe,
		channelCount: expected.channelCount,
		sampleRate: expected.sampleRate,
		byteRate: expected.sampleRate * expected.channelCount * 2,
		blockAlign: expected.channelCount * 2,
		bitsPerSample: expected.bitDepth,
		extensionBytes: 22,
		validBitsPerSample: expected.bitDepth,
		channelMask: expected.channelCount === 32 ? 0xffff_ffff : (2 ** expected.channelCount - 1) >>> 0,
		subformatGuid: '0100000000001000800000aa00389b71',
		dataId: 'data',
		dataOffset: 758,
		dataBytes: expected.dataBytes,
		pcmOffset: expected.headerByteLength,
		dataPadBytes: 0,
		trailingBytes: 0,
		frameCount: expected.frameCount,
	};
}

function productionFileEvidence() {
	const output = DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.output;
	return {
		byteLength: output.byteLength,
		sha256: 'a'.repeat(64),
		maximumReadChunkBytes: 1024 * 1024,
		riff: expectedRiff(output),
		bext: { ...DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.bext },
		signal: {
			frameCount: output.frameCount,
			channelComparisons: output.frameCount * 15,
			channelMismatchSamples: 0,
			maximumCarryBytes: 31,
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

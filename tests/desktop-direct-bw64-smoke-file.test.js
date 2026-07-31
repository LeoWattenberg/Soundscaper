/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createAdmChna,
	createRiffAxmlChunk,
	createRiffChnaChunk,
} from '../src/common/editor/adm-metadata.ts';
import { createWavHeader } from '../src/common/editor/wav.js';
import {
	DESKTOP_DIRECT_BW64_SIGNAL_LIMITS,
	DESKTOP_DIRECT_BW64_SMOKE_FIXTURE,
	validateDesktopDirectBw64FileEvidence,
	verifyDesktopDirectBw64File,
} from '../scripts/lib/desktop-direct-bw64-smoke-file.mjs';

const SMALL_GEOMETRY = Object.freeze({
	sampleRate: 384_000,
	channelCount: 6,
	bitDepth: 16,
	frameCount: 5,
	dataBytes: 60,
	headerByteLength: 1_028,
	axmlOffset: 1_088,
	byteLength: 3_568,
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

test('authored-BW64 completed geometry and metadata form one exact packaged fixture', () => {
	assert.deepEqual(DESKTOP_DIRECT_BW64_SMOKE_FIXTURE, {
		input: {
			sampleRate: 48_000,
			channelCount: 6,
			bitDepth: 16,
			frameCount: 2_112_000,
			floatPcmBytes: 50_688_000,
			timeReference: '6000',
		},
		plan: {
			sampleRate: 384_000,
			channelCount: 6,
			frameCount: 16_896_000,
			floatPcmBytes: 405_504_000,
			directThresholdBytes: 402_653_184,
		},
		output: {
			sampleRate: 384_000,
			channelCount: 6,
			bitDepth: 16,
			frameCount: 16_896_000,
			blockAlign: 12,
			dataBytes: 202_752_000,
			ds64PayloadBytes: 28,
			bextPayloadBytes: 688,
			bextChunkBytes: 696,
			formatBytes: 16,
			chnaPayloadBytes: 244,
			chnaChunkBytes: 252,
			axmlPayloadBytes: 2_472,
			axmlChunkBytes: 2_480,
			headerByteLength: 1_028,
			dataPadBytes: 0,
			byteLength: 202_755_508,
		},
		offsets: {
			ds64: 12,
			bext: 48,
			format: 744,
			chna: 768,
			data: 1_020,
			pcm: 1_028,
			axml: 202_753_028,
		},
		bext: {
			description: 'Soundscaper packaged BW64 smoke',
			originator: 'Soundscaper',
			originatorReference: 'PACKAGED-BW64-0001',
			originationDate: '2026-07-30',
			originationTime: '12:34:56',
			timeReference: '48000',
			version: 2,
			umid: '',
			loudnessValue: null,
			loudnessRange: null,
			maxTruePeakLevel: null,
			maxMomentaryLoudness: null,
			maxShortTermLoudness: null,
			codingHistory: 'A=PCM,F=48000,W=16,M=multi,T=SmokeFixture\nA=PCM,F=384000,W=16,M=multi,T=Soundscaper\n',
		},
		adm: {
			programmeName: 'Soundscaper packaged BW64 programme',
			programmeLanguage: '',
			contentName: 'Soundscaper packaged BW64 content',
			contentLanguage: '',
			bedName: 'Soundscaper packaged BW64 5.1 bed',
			layout: '5.1',
		},
		hashes: {
			bextPayload: '3fb39b40831a4ef0691749814e5c77b39ddc3e918d5c9e28c6f99e7ac292e61f',
			chnaPayload: '101309702cbb73f2568ccd1347580efe9a0fb5a7472356188062e7b17ee81f50',
			axmlPayload: '57bbe061083b62444af1bdb99481e746bc07eeb8d4a73c3fbfbd22fa7b18d243',
		},
	});
	assert.equal(Object.isFrozen(DESKTOP_DIRECT_BW64_SMOKE_FIXTURE), true);
	assert.equal(Object.isFrozen(DESKTOP_DIRECT_BW64_SMOKE_FIXTURE.output), true);
	assert.equal(DESKTOP_DIRECT_BW64_SMOKE_FIXTURE.input.floatPcmBytes > 32 * 1024 ** 2, true);
	assert.equal(
		DESKTOP_DIRECT_BW64_SMOKE_FIXTURE.plan.floatPcmBytes
			> DESKTOP_DIRECT_BW64_SMOKE_FIXTURE.plan.directThresholdBytes,
		true,
	);
	assert.deepEqual(DESKTOP_DIRECT_BW64_SIGNAL_LIMITS, {
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
	});
});

test('completed authored-BW64 evidence validation admits only the exact verifier shape', () => {
	const valid = productionFileEvidence();
	const validated = validateDesktopDirectBw64FileEvidence(valid);
	assert.deepEqual(validated, valid);
	assert.equal(Object.isFrozen(validated), true);
	assert.equal(Object.isFrozen(validated.riff), true);
	assert.equal(Object.isFrozen(validated.chna.entries), true);
	for (const mutation of [
		(value) => { value.unexpected = true; },
		(value) => { delete value.sha256; },
		(value) => { value.sha256 = 'A'.repeat(64); },
		(value) => { value.maximumReadChunkBytes = 1024 * 1024 + 1; },
		(value) => { value.riff.sampleCount = 1; },
		(value) => { value.bext.description = 'Different'; },
		(value) => { value.chna.entries[5].trackRef = 'AC_00010005_00'; },
		(value) => { value.axml.bedName = 'Different'; },
		(value) => { value.signal.frameCount -= 1; },
	]) {
		const evidence = structuredClone(valid);
		mutation(evidence);
		assert.throws(() => validateDesktopDirectBw64FileEvidence(evidence), /BW64|PCM/iu);
	}
});

test('completed authored-BW64 verification streams exact structure, metadata, and signal', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'direct-bw64-file-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const samples = [-100, -1, 0, 1, 100];
	const bw64 = pcmBw64(SMALL_GEOMETRY, samples);
	const path = join(root, 'completed-bw64.wav');
	await writeFile(path, bw64);

	const oneByte = await verifyDesktopDirectBw64File(path, {
		expected: SMALL_GEOMETRY,
		readChunkBytes: 1,
		signalLimits: SMALL_LIMITS,
	});
	const awkward = await verifyDesktopDirectBw64File(path, {
		expected: SMALL_GEOMETRY,
		readChunkBytes: 13,
		signalLimits: SMALL_LIMITS,
	});
	assert.deepEqual(oneByte.riff, expectedRiff(SMALL_GEOMETRY));
	assert.deepEqual(oneByte.bext, expectedBext());
	assert.deepEqual(oneByte.chna, expectedChna());
	assert.deepEqual(oneByte.axml, expectedAxml());
	assert.deepEqual(omitCarry(oneByte.signal), omitCarry(awkward.signal));
	assert.ok(oneByte.signal.maximumCarryBytes <= 11);
	assert.ok(awkward.signal.maximumCarryBytes <= 11);
	assert.equal(oneByte.maximumReadChunkBytes, 1);
	assert.equal(awkward.maximumReadChunkBytes, 13);
	assert.equal(oneByte.byteLength, bw64.byteLength);
	assert.equal(oneByte.sha256, createHash('sha256').update(bw64).digest('hex'));

	await t.test('regular non-symbolic output is required', async (subtest) => {
		const link = join(root, 'linked-bw64.wav');
		try {
			await symlink(path, link);
		} catch (error) {
			if (error?.code === 'EPERM') return subtest.skip('symbolic links are unavailable');
			throw error;
		}
		await assert.rejects(
			() => verifyDesktopDirectBw64File(link, { expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS }),
			/regular.*file|symbolic/iu,
		);
	});
});

test('completed authored-BW64 verification rejects structural and metadata corruption', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'direct-bw64-corruption-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const valid = pcmBw64(SMALL_GEOMETRY, [-100, -1, 0, 1, 100]);
	const mutations = [
		['BW64 id', (bytes) => bytes.write('BW6X', 0)],
		['RIFF sentinel', (bytes) => bytes.writeUInt32LE(bytes.byteLength - 8, 4)],
		['WAVE id', (bytes) => bytes.write('WAVX', 8)],
		['ds64 order', (bytes) => bytes.write('JUNK', 12)],
		['ds64 payload', (bytes) => bytes.writeUInt32LE(27, 16)],
		['ds64 RIFF size', (bytes) => bytes.writeBigUInt64LE(BigInt(bytes.byteLength - 9), 20)],
		['ds64 data size', (bytes) => bytes.writeBigUInt64LE(59n, 28)],
		['sample count', (bytes) => bytes.writeBigUInt64LE(5n, 36)],
		['table length', (bytes) => bytes.writeUInt32LE(1, 44)],
		['bext order', (bytes) => bytes.write('JUNK', 48)],
		['BEXT payload', (bytes) => { bytes[56] ^= 1; }],
		['fmt order', (bytes) => bytes.write('JUNK', 744)],
		['fmt payload', (bytes) => bytes.writeUInt32LE(40, 748)],
		['format tag', (bytes) => bytes.writeUInt16LE(0xfffe, 752)],
		['channel count', (bytes) => bytes.writeUInt16LE(2, 754)],
		['sample rate', (bytes) => bytes.writeUInt32LE(48_000, 756)],
		['byte rate', (bytes) => bytes.writeUInt32LE(1, 760)],
		['block alignment', (bytes) => bytes.writeUInt16LE(1, 764)],
		['bits per sample', (bytes) => bytes.writeUInt16LE(24, 766)],
		['chna order', (bytes) => bytes.write('JUNK', 768)],
		['CHNA payload', (bytes) => { bytes[780] ^= 1; }],
		['data order', (bytes) => bytes.write('JUNK', 1_020)],
		['data sentinel', (bytes) => bytes.writeUInt32LE(60, 1_024)],
		['AXML payload', (bytes) => { bytes[SMALL_GEOMETRY.axmlOffset + 8] ^= 1; }],
	];
	for (const [label, mutate] of mutations) {
		const bytes = Buffer.from(valid);
		mutate(bytes);
		const path = join(root, `${label.replaceAll(' ', '-')}.wav`);
		await writeFile(path, bytes);
		await assert.rejects(
			() => verifyDesktopDirectBw64File(path, { expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS }),
			new RegExp(label, 'iu'),
		);
	}

	const mismatched = Buffer.from(valid);
	mismatched.writeInt16LE(1, SMALL_GEOMETRY.headerByteLength + 2);
	const mismatchedPath = join(root, 'channel-mismatch.wav');
	await writeFile(mismatchedPath, mismatched);
	await assert.rejects(
		() => verifyDesktopDirectBw64File(mismatchedPath, { expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS }),
		/channel mapping/iu,
	);

	const trailing = join(root, 'trailing.wav');
	await writeFile(trailing, valid);
	await appendFile(trailing, Buffer.of(0));
	await assert.rejects(
		() => verifyDesktopDirectBw64File(trailing, { expected: SMALL_GEOMETRY, signalLimits: SMALL_LIMITS }),
		/byte length|trailing/iu,
	);
});

test('completed authored-BW64 verification rejects non-normalized paths and invalid schemas', async () => {
	await assert.rejects(() => verifyDesktopDirectBw64File('relative.wav'), /absolute|normalized/iu);
	await assert.rejects(() => verifyDesktopDirectBw64File('/tmp/direct-bw64/../file.wav'), /absolute|normalized/iu);
	await assert.rejects(() => verifyDesktopDirectBw64File('/tmp/bad\0file.wav'), /path/iu);
	for (const expected of [
		null,
		{ ...SMALL_GEOMETRY, unexpected: true },
		{ ...SMALL_GEOMETRY, channelCount: 2 },
		{ ...SMALL_GEOMETRY, bitDepth: 24 },
		{ ...SMALL_GEOMETRY, headerByteLength: 1_027 },
		{ ...SMALL_GEOMETRY, dataBytes: 59 },
		{ ...SMALL_GEOMETRY, axmlOffset: 1_087 },
		{ ...SMALL_GEOMETRY, byteLength: 3_567 },
	]) {
		await assert.rejects(
			() => verifyDesktopDirectBw64File('/tmp/missing-bw64.wav', { expected }),
			/BW64/iu,
		);
	}
});

function pcmBw64(expected, samples) {
	const fixture = DESKTOP_DIRECT_BW64_SMOKE_FIXTURE;
	const chna = createRiffChnaChunk(createAdmChna({ layout: '5.1' }));
	const axml = createRiffAxmlChunk(fixture.adm);
	const header = createWavHeader({
		container: 'bw64',
		sampleRate: expected.sampleRate,
		channelCount: expected.channelCount,
		totalFrames: expected.frameCount,
		bitDepth: expected.bitDepth,
		bext: fixture.bext,
		preDataChunks: chna,
		trailingChunks: axml,
	});
	assert.equal(header.byteLength, expected.headerByteLength);
	const pcm = Buffer.alloc(samples.length * expected.channelCount * 2);
	for (let frame = 0; frame < samples.length; frame += 1) {
		for (let channel = 0; channel < expected.channelCount; channel += 1) {
			pcm.writeInt16LE(samples[frame], (frame * expected.channelCount + channel) * 2);
		}
	}
	const bytes = Buffer.concat([header, pcm, axml]);
	assert.equal(bytes.byteLength, expected.byteLength);
	return bytes;
}

function expectedRiff(expected) {
	return {
		riffId: 'BW64', riffBytes32: 0xffff_ffff, riffBytes: expected.byteLength,
		waveId: 'WAVE', ds64Id: 'ds64', ds64Offset: 12, ds64PayloadBytes: 28,
		dataBytes: expected.dataBytes, sampleCount: 0, tableLength: 0,
		bextId: 'bext', bextOffset: 48, bextPayloadBytes: 688, bextPadBytes: 0,
		formatId: 'fmt ', formatOffset: 744, formatBytes: 16, formatTag: 1,
		channelCount: expected.channelCount, sampleRate: expected.sampleRate,
		byteRate: expected.sampleRate * expected.channelCount * 2,
		blockAlign: expected.channelCount * 2, bitsPerSample: expected.bitDepth,
		chnaId: 'chna', chnaOffset: 768, chnaPayloadBytes: 244, chnaPadBytes: 0,
		dataId: 'data', dataOffset: 1_020, dataBytes32: 0xffff_ffff,
		pcmOffset: expected.headerByteLength, dataPadBytes: 0,
		axmlId: 'axml', axmlOffset: expected.axmlOffset, axmlPayloadBytes: 2_472,
		axmlPadBytes: 0, trailingBytes: 0, frameCount: expected.frameCount,
	};
}

function expectedBext() {
	return {
		...DESKTOP_DIRECT_BW64_SMOKE_FIXTURE.bext,
		payloadSha256: DESKTOP_DIRECT_BW64_SMOKE_FIXTURE.hashes.bextPayload,
	};
}

function expectedChna() {
	return {
		numTracks: 6,
		numUids: 6,
		entries: Array.from({ length: 6 }, (_, index) => ({
			trackIndex: index + 1,
			uid: `ATU_${String(index + 1).padStart(8, '0')}`,
			trackRef: `AC_0001000${String(index + 1)}_00`,
			packRef: 'AP_00010003',
		})),
		payloadSha256: DESKTOP_DIRECT_BW64_SMOKE_FIXTURE.hashes.chnaPayload,
	};
}

function expectedAxml() {
	return {
		version: 'ITU-R_BS.2076-3',
		...DESKTOP_DIRECT_BW64_SMOKE_FIXTURE.adm,
		payloadSha256: DESKTOP_DIRECT_BW64_SMOKE_FIXTURE.hashes.axmlPayload,
	};
}

function productionFileEvidence() {
	const fixture = DESKTOP_DIRECT_BW64_SMOKE_FIXTURE;
	return {
		byteLength: fixture.output.byteLength,
		sha256: 'a'.repeat(64),
		maximumReadChunkBytes: 1024 * 1024,
		riff: expectedRiff({ ...fixture.output, axmlOffset: fixture.offsets.axml }),
		bext: expectedBext(),
		chna: expectedChna(),
		axml: expectedAxml(),
		signal: {
			frameCount: fixture.output.frameCount,
			channelComparisons: fixture.output.frameCount * 5,
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
			rmsSample: Math.sqrt(816_000_000_000_000 / fixture.output.frameCount),
		},
	};
}

function omitCarry(value) {
	const { maximumCarryBytes: _maximumCarryBytes, ...stable } = value;
	return stable;
}

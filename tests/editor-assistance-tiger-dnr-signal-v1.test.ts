/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_TIGER_DNR_CHUNK_FRAMES,
	ASSISTANCE_TIGER_DNR_CHUNK_HOP_FRAMES,
	ASSISTANCE_TIGER_DNR_SAMPLE_RATE,
	createTigerDnrChunkPlanV1,
	extractTigerDnrChunkV1,
	mergeTigerDnrStemV1,
	tigerDnrIstftV1,
	tigerDnrStftV1,
} from '../src/common/editor/assistance/tiger-dnr-signal-v1.ts';

test('TIGER-DnR chunk planning reproduces the pinned 12s/4s reference geometry', () => {
	assert.equal(ASSISTANCE_TIGER_DNR_SAMPLE_RATE, 44_100);
	assert.equal(ASSISTANCE_TIGER_DNR_CHUNK_FRAMES, 529_200);
	assert.equal(ASSISTANCE_TIGER_DNR_CHUNK_HOP_FRAMES, 176_400);
	assert.deepEqual(createTigerDnrChunkPlanV1({ schemaVersion: 1, sourceFrameCount: 1_000 }), {
		schemaVersion: 1,
		sourceFrameCount: 1_000,
		paddedFrameCount: 706_600,
		cropStartFrame: 352_800,
		overlapDivisor: 3,
		chunks: [
			{ chunkIndex: 0, paddedStartFrame: 0, availableFrameCount: 529_200 },
			{ chunkIndex: 1, paddedStartFrame: 176_400, availableFrameCount: 529_200 },
			{ chunkIndex: 2, paddedStartFrame: 352_800, availableFrameCount: 353_800 },
		],
	});
});

test('TIGER-DnR extraction and overlap-add preserve multichannel identity geometry', () => {
	const channels = [
		Float32Array.from({ length: 1_000 }, (_, index) => Math.sin(index / 31) * 0.5),
		Float32Array.from({ length: 1_000 }, (_, index) => Math.cos(index / 17) * 0.25),
	];
	const plan = createTigerDnrChunkPlanV1({ schemaVersion: 1, sourceFrameCount: 1_000 });
	const chunks = plan.chunks.map((chunk) => ({
		chunkIndex: chunk.chunkIndex,
		channels: extractTigerDnrChunkV1({
			schemaVersion: 1, plan, chunkIndex: chunk.chunkIndex, channels,
		}),
	}));
	const merged = mergeTigerDnrStemV1({ schemaVersion: 1, plan, channelCount: 2, chunks });
	assert.equal(merged.length, 2);
	for (let channel = 0; channel < channels.length; channel += 1) {
		assert.equal(merged[channel]!.length, channels[channel]!.length);
		for (let frame = 0; frame < channels[channel]!.length; frame += 1) {
			assert.ok(Math.abs(merged[channel]![frame]! - channels[channel]![frame]!) < 1e-6);
		}
	}
});

test('owned TIGER-DnR STFT/ISTFT round-trips the pinned centered Hann geometry', () => {
	const channels = [
		Float32Array.from({ length: 4_096 }, (_, index) =>
			0.4 * Math.sin(2 * Math.PI * 440 * index / ASSISTANCE_TIGER_DNR_SAMPLE_RATE)),
		Float32Array.from({ length: 4_096 }, (_, index) => index % 257 === 0 ? 0.25 : 0),
	];
	const spectrum = tigerDnrStftV1({ schemaVersion: 1,
		sampleRate: ASSISTANCE_TIGER_DNR_SAMPLE_RATE, channels });
	assert.equal(spectrum.fftSize, 2_048);
	assert.equal(spectrum.hopFrames, 512);
	assert.equal(spectrum.frequencyBinCount, 1_025);
	assert.equal(spectrum.timeFrameCount, 9);
	const restored = tigerDnrIstftV1({ schemaVersion: 1, spectrum, sourceFrameCount: 4_096 });
	for (let channel = 0; channel < channels.length; channel += 1) {
		for (let frame = 0; frame < channels[channel]!.length; frame += 1) {
			assert.ok(Math.abs(restored[channel]![frame]! - channels[channel]![frame]!) < 2e-4,
				`channel ${String(channel)} frame ${String(frame)}`);
		}
	}
});

test('TIGER-DnR custody rejects malformed, incomplete, and non-finite tensors', () => {
	assert.throws(() => createTigerDnrChunkPlanV1({ schemaVersion: 1, sourceFrameCount: 0 }),
		/frame count|positive/iu);
	assert.throws(() => createTigerDnrChunkPlanV1({ schemaVersion: 1,
		sourceFrameCount: 1, invented: true }), /fields/iu);
	const plan = createTigerDnrChunkPlanV1({ schemaVersion: 1, sourceFrameCount: 4 });
	const channels = [Float32Array.of(0, 1, 0, -1)];
	assert.throws(() => mergeTigerDnrStemV1({ schemaVersion: 1, plan, channelCount: 1,
		chunks: plan.chunks.slice(1).map((chunk) => ({ chunkIndex: chunk.chunkIndex,
			channels: extractTigerDnrChunkV1({ schemaVersion: 1, plan,
				chunkIndex: chunk.chunkIndex, channels }) })) }), /chunk|inventory/iu);
	const invalid = extractTigerDnrChunkV1({ schemaVersion: 1, plan, chunkIndex: 0, channels });
	invalid[0]![0] = Number.NaN;
	assert.throws(() => mergeTigerDnrStemV1({ schemaVersion: 1, plan, channelCount: 1,
		chunks: plan.chunks.map((chunk) => ({ chunkIndex: chunk.chunkIndex,
			channels: chunk.chunkIndex === 0 ? invalid : extractTigerDnrChunkV1({
				schemaVersion: 1, plan, chunkIndex: chunk.chunkIndex, channels,
			}) })) }), /finite/iu);
});

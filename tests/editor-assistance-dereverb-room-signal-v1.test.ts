/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_DEREVERB_ROOM_BORDER_FRAMES,
	ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES,
	ASSISTANCE_DEREVERB_ROOM_CHUNK_STEP_FRAMES,
	ASSISTANCE_DEREVERB_ROOM_FADE_FRAMES,
	ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE,
	createDereverbRoomChunkPlanV1,
	dereverbRoomFadeWeightV1,
	dereverbRoomIstftV1,
	dereverbRoomStftV1,
	extractDereverbRoomChunkV1,
	mergeDereverbRoomChunksV1,
} from '../src/common/editor/assistance/dereverb-room-signal-v1.ts';
import {
	createDereverbRoomStreamingOverlapV1,
} from '../src/common/editor/assistance/dereverb-room-streaming-overlap-v1.ts';

function sourceSignal(frameCount: number): Float32Array {
	return Float32Array.from({ length: frameCount }, (_, index) =>
		0.4 * Math.sin(index / 29) + 0.15 * Math.cos(index / 7) + (index % 997 === 0 ? 0.2 : 0));
}

test('dereverb-room chunk planning reproduces the pinned MSST demix geometry', () => {
	assert.equal(ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE, 44_100);
	assert.equal(ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES, 384_000);
	assert.equal(ASSISTANCE_DEREVERB_ROOM_CHUNK_STEP_FRAMES, 192_000);
	assert.equal(ASSISTANCE_DEREVERB_ROOM_FADE_FRAMES, 38_400);

	const short = createDereverbRoomChunkPlanV1({ schemaVersion: 1, sourceFrameCount: 1_000 });
	assert.deepEqual(short, {
		schemaVersion: 1,
		sourceFrameCount: 1_000,
		borderFrames: 0,
		paddedFrameCount: 1_000,
		chunks: [{
			chunkIndex: 0, paddedStartFrame: 0, availableFrameCount: 1_000,
			tailPadMode: 'zero', fadeIn: false, fadeOut: false,
		}],
	});

	const long = createDereverbRoomChunkPlanV1({
		schemaVersion: 1, sourceFrameCount: 500_000,
	});
	assert.equal(long.borderFrames, ASSISTANCE_DEREVERB_ROOM_BORDER_FRAMES);
	assert.equal(long.paddedFrameCount, 884_000);
	assert.equal(long.chunks.length, 5);
	assert.deepEqual(long.chunks.map(({ paddedStartFrame }) => paddedStartFrame),
		[0, 192_000, 384_000, 576_000, 768_000]);
	assert.deepEqual(long.chunks.map(({ availableFrameCount }) => availableFrameCount),
		[384_000, 384_000, 384_000, 308_000, 116_000]);
	assert.deepEqual(long.chunks.map(({ tailPadMode }) => tailPadMode),
		['none', 'none', 'none', 'reflect', 'zero']);
	assert.deepEqual(long.chunks.map(({ fadeIn }) => fadeIn),
		[false, true, true, true, true]);
	assert.deepEqual(long.chunks.map(({ fadeOut }) => fadeOut),
		[true, true, true, true, false]);
});

test('dereverb-room extraction reflects the border and the reflect-padded tail', () => {
	const frameCount = 500_000;
	const channel = sourceSignal(frameCount);
	const plan = createDereverbRoomChunkPlanV1({ schemaVersion: 1, sourceFrameCount: frameCount });
	const first = extractDereverbRoomChunkV1({ schemaVersion: 1, plan, chunkIndex: 0, channel });
	// Padded frame 0 reflects source frame borderFrames (no edge repeat).
	assert.equal(first[0], channel[plan.borderFrames]);
	assert.equal(first[plan.borderFrames - 1], channel[1]);
	assert.equal(first[plan.borderFrames], channel[0]);
	const reflectTail = extractDereverbRoomChunkV1({ schemaVersion: 1, plan, chunkIndex: 3, channel });
	const available = plan.chunks[3]!.availableFrameCount;
	assert.equal(reflectTail[available], reflectTail[available - 2]);
	assert.equal(reflectTail[available + 5], reflectTail[available - 7]);
	const zeroTail = extractDereverbRoomChunkV1({ schemaVersion: 1, plan, chunkIndex: 4, channel });
	assert.equal(zeroTail[plan.chunks[4]!.availableFrameCount], 0);
	assert.equal(zeroTail[ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES - 1], 0);
});

test('dereverb-room fade merge is an exact identity over pass-through chunks', () => {
	for (const frameCount of [1_000, 384_000, 500_000]) {
		const channel = sourceSignal(frameCount);
		const plan = createDereverbRoomChunkPlanV1({ schemaVersion: 1, sourceFrameCount: frameCount });
		const chunks = plan.chunks.map((chunk) => ({
			chunkIndex: chunk.chunkIndex,
			channel: extractDereverbRoomChunkV1({
				schemaVersion: 1, plan, chunkIndex: chunk.chunkIndex, channel,
			}),
		}));
		const merged = mergeDereverbRoomChunksV1({ schemaVersion: 1, plan, chunks });
		assert.equal(merged.length, frameCount);
		for (let frame = 0; frame < frameCount; frame += 1) {
			assert.ok(Math.abs(merged[frame]! - channel[frame]!) < 1e-6,
				`frame ${String(frame)} of ${String(frameCount)}`);
		}
	}
});

test('dereverb-room streaming overlap equals the batch merge exactly', () => {
	const frameCount = 500_000;
	const channel = sourceSignal(frameCount);
	const plan = createDereverbRoomChunkPlanV1({ schemaVersion: 1, sourceFrameCount: frameCount });
	const chunks = plan.chunks.map((chunk) => extractDereverbRoomChunkV1({
		schemaVersion: 1, plan, chunkIndex: chunk.chunkIndex, channel,
	}));
	const batch = mergeDereverbRoomChunksV1({
		schemaVersion: 1, plan,
		chunks: chunks.map((chunkChannel, chunkIndex) => ({ chunkIndex, channel: chunkChannel })),
	});
	const streaming = createDereverbRoomStreamingOverlapV1(plan);
	const drained: number[] = [];
	for (const [chunkIndex, chunkChannel] of chunks.entries()) {
		const safeEnd = streaming.addChunk(chunkIndex, chunkChannel);
		const pending = safeEnd - streaming.paddedPosition;
		if (pending > 0) {
			const emitted = streaming.drain(pending, true);
			for (const sample of emitted!) drained.push(sample);
		}
	}
	streaming.finish();
	assert.equal(drained.length, plan.paddedFrameCount);
	for (let frame = 0; frame < frameCount; frame += 1) {
		const padded = plan.borderFrames + frame;
		assert.ok(Math.abs(drained[padded]! - batch[frame]!) < 1e-7,
			`streaming frame ${String(frame)}`);
	}
});

test('dereverb-room fade weights reproduce the reference linear ramps', () => {
	const fade = ASSISTANCE_DEREVERB_ROOM_FADE_FRAMES;
	assert.equal(dereverbRoomFadeWeightV1(0, true, true), 0);
	assert.equal(dereverbRoomFadeWeightV1(fade - 1, true, true), 1);
	assert.equal(dereverbRoomFadeWeightV1(1, true, false), 1 / (fade - 1));
	assert.equal(dereverbRoomFadeWeightV1(0, false, true), 1);
	assert.equal(dereverbRoomFadeWeightV1(ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES - 1, false, true), 0);
	assert.equal(dereverbRoomFadeWeightV1(ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES - 1, true, false), 1);
	assert.equal(dereverbRoomFadeWeightV1(200_000, true, true), 1);
});

test('owned dereverb-room STFT/ISTFT round-trips the pinned centered Hann geometry', () => {
	const channel = Float32Array.from({ length: 4_096 }, (_, index) =>
		0.4 * Math.sin(2 * Math.PI * 440 * index / ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE)
		+ (index % 257 === 0 ? 0.2 : 0));
	const spectrum = dereverbRoomStftV1({
		schemaVersion: 1, sampleRate: ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE, channel,
	});
	assert.equal(spectrum.fftSize, 2_048);
	assert.equal(spectrum.hopFrames, 512);
	assert.equal(spectrum.frequencyBinCount, 1_025);
	assert.equal(spectrum.timeFrameCount, 9);
	const restored = dereverbRoomIstftV1({ schemaVersion: 1, spectrum, sourceFrameCount: 4_096 });
	for (let frame = 0; frame < channel.length; frame += 1) {
		assert.ok(Math.abs(restored[frame]! - channel[frame]!) < 2e-4, `frame ${String(frame)}`);
	}
});

test('dereverb-room custody rejects malformed, incomplete, and non-finite tensors', () => {
	assert.throws(() => createDereverbRoomChunkPlanV1({ schemaVersion: 1, sourceFrameCount: 0 }),
		/frame count|invalid/iu);
	assert.throws(() => createDereverbRoomChunkPlanV1({
		schemaVersion: 1, sourceFrameCount: 1, invented: true,
	}), /fields/iu);
	const plan = createDereverbRoomChunkPlanV1({ schemaVersion: 1, sourceFrameCount: 4 });
	const channel = Float32Array.of(0, 1, 0, -1);
	assert.throws(() => mergeDereverbRoomChunksV1({ schemaVersion: 1, plan, chunks: [] }),
		/bound/iu);
	const chunk = extractDereverbRoomChunkV1({ schemaVersion: 1, plan, chunkIndex: 0, channel });
	chunk[0] = Number.NaN;
	assert.throws(() => mergeDereverbRoomChunksV1({
		schemaVersion: 1, plan, chunks: [{ chunkIndex: 0, channel: chunk }],
	}), /finite/iu);
	assert.throws(() => dereverbRoomStftV1({
		schemaVersion: 1, sampleRate: 48_000, channel,
	}), /44100/u);
	const streaming = createDereverbRoomStreamingOverlapV1(plan);
	assert.throws(() => streaming.drain(1, true), /authority/iu);
	assert.throws(() => streaming.addChunk(1, new Float32Array(384_000)), /ordered/iu);
	assert.throws(() => streaming.finish(), /exact plan/iu);
});

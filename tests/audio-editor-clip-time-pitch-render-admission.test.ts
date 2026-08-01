import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	MAXIMUM_CLIP_TIME_PITCH_RENDER_USEFUL_BINARY_BYTES,
	STAFFPAD_CLIP_TIME_PITCH_MAXIMUM_BLOCK_FRAMES,
	STAFFPAD_CLIP_TIME_PITCH_WASM_BYTES,
	estimateClipTimePitchRenderAdmission,
	normalizeClipTimePitchRenderMaximumBytes,
} from '../src/common/editor/clip-time-pitch-render-admission.ts';

const MIB = 1024 * 1024;

test('StaffPad render admission pins the audited WASM maximum', () => {
	const manifest = JSON.parse(readFileSync(
		new URL('../src/common/editor/staffpad/source-manifest.json', import.meta.url),
		'utf8',
	)) as { wasm?: { maximumMemoryBytes?: unknown } };
	assert.equal(STAFFPAD_CLIP_TIME_PITCH_WASM_BYTES, manifest.wasm?.maximumMemoryBytes);
	assert.equal(STAFFPAD_CLIP_TIME_PITCH_MAXIMUM_BLOCK_FRAMES, 65_536);
});

test('StaffPad render admission reports the exact scoped useful-binary phase formula', () => {
	const estimate = estimateClipTimePitchRenderAdmission({
		sourceFrameCount: 10,
		channelCount: 2,
		direction: 'forward',
		stages: [{ inputFrames: 6, outputFrames: 8 }],
	}, {
		chunkFrames: 1_024,
		transferLoadedSourceChannels: true,
	});

	assert.deepEqual(estimate, {
		phases: [{
			stageIndex: 0,
			stageInputFrames: 6,
			outputFrames: 8,
			accountedInputFrames: 10,
			inputCopies: 1,
			sourceInputBytes: 80,
			clientOutputBytes: 64,
			cumulativeTransferredOutputBytes: 64,
			chunkScratchBytes: 8_192,
			wasmBlockScratchBytes: 524_288,
			staffPadWasmBytes: 64 * MIB,
			usefulBinaryWorkingSet: {
				bytes: 64 * MIB + 532_688,
				certainty: 'upper-bound',
				scope: 'staffpad-clip-cache-stage-useful-binary-working-set',
			},
		}],
		peakPhaseIndex: 0,
		usefulBinaryWorkingSet: {
			bytes: 64 * MIB + 532_688,
			certainty: 'upper-bound',
			scope: 'staffpad-clip-cache-render-useful-binary-working-set',
		},
		browserHeapBytes: null,
		processResidentSetBytes: null,
		garbageCollectionHeadroomBytes: null,
	});
	assert.equal(Object.isFrozen(estimate), true);
	assert.equal(Object.isFrozen(estimate.phases), true);
	assert.equal(Object.isFrozen(estimate.phases[0]), true);
	assert.equal(Object.isFrozen(estimate.phases[0]?.usefulBinaryWorkingSet), true);
	assert.equal(Object.isFrozen(estimate.usefulBinaryWorkingSet), true);
});

test('StaffPad render admission selects the largest sequential stage phase', () => {
	const estimate = estimateClipTimePitchRenderAdmission({
		sourceFrameCount: 100,
		channelCount: 1,
		direction: 'forward',
		stages: [
			{ inputFrames: 100, outputFrames: 200 },
			{ inputFrames: 200, outputFrames: 500 },
		],
	}, {
		chunkFrames: 1_024,
		transferLoadedSourceChannels: true,
	});

	assert.deepEqual(estimate.phases.map((phase) => ({
		stageIndex: phase.stageIndex,
		accountedInputFrames: phase.accountedInputFrames,
		bytes: phase.usefulBinaryWorkingSet.bytes,
	})), [
		{ stageIndex: 0, accountedInputFrames: 100, bytes: 64 * MIB + 268_240 },
		{ stageIndex: 1, accountedInputFrames: 200, bytes: 64 * MIB + 271_040 },
	]);
	assert.equal(estimate.peakPhaseIndex, 1);
	assert.equal(estimate.usefulBinaryWorkingSet.bytes, 64 * MIB + 271_040);
});

test('StaffPad render admission distinguishes the exact production boundary from one extra frame', () => {
	const estimate = (sourceFrameCount: number) => estimateClipTimePitchRenderAdmission({
		sourceFrameCount,
		channelCount: 1,
		direction: 'forward',
		stages: [{ inputFrames: 1, outputFrames: 1 }],
	}, {
		chunkFrames: 1_024,
		transferLoadedSourceChannels: true,
	}).usefulBinaryWorkingSet.bytes;

	assert.equal(estimate(50_265_086), MAXIMUM_CLIP_TIME_PITCH_RENDER_USEFUL_BINARY_BYTES);
	assert.equal(estimate(50_265_087), MAXIMUM_CLIP_TIME_PITCH_RENDER_USEFUL_BINARY_BYTES + 4);
});

test('borrowed and reverse first-stage sources retain two full input payloads', () => {
	const plan = {
		sourceFrameCount: 10,
		channelCount: 1,
		direction: 'forward' as const,
		stages: [{ inputFrames: 6, outputFrames: 8 }],
	};
	const ownedForward = estimateClipTimePitchRenderAdmission(plan, {
		chunkFrames: 1_024,
		transferLoadedSourceChannels: true,
	});
	const borrowedForward = estimateClipTimePitchRenderAdmission(plan, {
		chunkFrames: 1_024,
		transferLoadedSourceChannels: false,
	});
	const ownedReverse = estimateClipTimePitchRenderAdmission({
		...plan,
		direction: 'reverse',
	}, {
		chunkFrames: 1_024,
		transferLoadedSourceChannels: true,
	});
	const borrowedReverse = estimateClipTimePitchRenderAdmission({
		...plan,
		direction: 'reverse',
	}, {
		chunkFrames: 1_024,
		transferLoadedSourceChannels: false,
	});

	assert.deepEqual([
		ownedForward.phases[0]?.inputCopies,
		borrowedForward.phases[0]?.inputCopies,
		ownedReverse.phases[0]?.inputCopies,
		borrowedReverse.phases[0]?.inputCopies,
	], [1, 2, 2, 2]);
	assert.deepEqual([
		ownedForward.phases[0]?.sourceInputBytes,
		borrowedForward.phases[0]?.sourceInputBytes,
		ownedReverse.phases[0]?.sourceInputBytes,
		borrowedReverse.phases[0]?.sourceInputBytes,
	], [40, 80, 80, 80]);
});

test('StaffPad render admission rejects invalid geometry and unsafe byte arithmetic', () => {
	const validPlan = {
		sourceFrameCount: 100,
		channelCount: 1,
		direction: 'forward' as const,
		stages: [{ inputFrames: 100, outputFrames: 100 }],
	};
	for (const plan of [
		{ ...validPlan, sourceFrameCount: 0 },
		{ ...validPlan, channelCount: 3 },
		{ ...validPlan, direction: 'sideways' },
		{ ...validPlan, stages: [] },
		{ ...validPlan, stages: [{ inputFrames: 101, outputFrames: 100 }] },
		{
			...validPlan,
			stages: [
				{ inputFrames: 100, outputFrames: 50 },
				{ inputFrames: 49, outputFrames: 25 },
			],
		},
	]) {
		assert.throws(
			() => estimateClipTimePitchRenderAdmission(plan as never, {
				chunkFrames: 1_024,
				transferLoadedSourceChannels: true,
			}),
			/StaffPad clip-cache render/iu,
		);
	}
	for (const options of [
		{ chunkFrames: 1_023, transferLoadedSourceChannels: true },
		{ chunkFrames: 65_537, transferLoadedSourceChannels: true },
		{ chunkFrames: 1_024.5, transferLoadedSourceChannels: true },
		{ chunkFrames: 1_024, transferLoadedSourceChannels: 1 },
	]) {
		assert.throws(
			() => estimateClipTimePitchRenderAdmission(validPlan, options as never),
			/StaffPad clip-cache render/iu,
		);
	}
	assert.throws(
		() => estimateClipTimePitchRenderAdmission({
			...validPlan,
			sourceFrameCount: Number.MAX_SAFE_INTEGER,
		}, {
			chunkFrames: 65_536,
			transferLoadedSourceChannels: true,
		}),
		/safe integer range/iu,
	);
});

test('StaffPad render admission limit is non-raiseable with a zero-capable lower-only seam', () => {
	assert.equal(MAXIMUM_CLIP_TIME_PITCH_RENDER_USEFUL_BINARY_BYTES, 256 * MIB);
	assert.equal(STAFFPAD_CLIP_TIME_PITCH_WASM_BYTES, 64 * MIB);
	assert.equal(normalizeClipTimePitchRenderMaximumBytes(), 256 * MIB);
	assert.equal(normalizeClipTimePitchRenderMaximumBytes(0), 0);
	assert.equal(normalizeClipTimePitchRenderMaximumBytes(123), 123);
	assert.equal(normalizeClipTimePitchRenderMaximumBytes(256 * MIB), 256 * MIB);

	for (const value of [
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.MAX_SAFE_INTEGER + 1,
		256 * MIB + 1,
		'123',
	]) {
		assert.throws(
			() => normalizeClipTimePitchRenderMaximumBytes(value),
			/StaffPad clip-cache render maximum/iu,
		);
	}
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAXIMUM_SPECTRAL_EDIT_USEFUL_BINARY_BYTES,
	SpectralEditMemoryLimitError,
	inspectSpectralEditChannels,
	normalizeSpectralEditMaximumUsefulBinaryBytes,
	planSpectralEditJobAdmission,
	planSpectralEditWorkflowAdmission,
} from '../src/common/editor/spectral-edit-admission.ts';

const MIB = 1024 * 1024;

test('spectral edit admission accounts the exact sequential target ownership phases', () => {
	const plan = planSpectralEditWorkflowAdmission({
		targets: [
			{ channelCount: 2, frameCount: 10, selectionFrameCount: 6, windowSize: 32 },
			{ channelCount: 1, frameCount: 20, selectionFrameCount: 8, windowSize: 64 },
		],
		initialRetainedCompletedOutputBytes: 12,
	});

	assert.deepEqual(plan, {
		phases: [
			{
				targetIndex: 0,
				channelCount: 2,
				frameCount: 10,
				selectionFrameCount: 6,
				windowSize: 32,
				retainedCompletedOutputBytes: 12,
				dryRenderInputBytes: 80,
				workerTransferCopyBytes: 80,
				equalShapeOutputBytes: 80,
				spectralSelectionScratchBytes: 96,
				windowAndFftScratchBytes: 1_536,
				usefulBinaryWorkingSet: {
					bytes: 1_884,
					certainty: 'upper-bound',
					scope: 'spectral-edit-target-useful-binary-working-set',
				},
			},
			{
				targetIndex: 1,
				channelCount: 1,
				frameCount: 20,
				selectionFrameCount: 8,
				windowSize: 64,
				retainedCompletedOutputBytes: 92,
				dryRenderInputBytes: 80,
				workerTransferCopyBytes: 80,
				equalShapeOutputBytes: 80,
				spectralSelectionScratchBytes: 128,
				windowAndFftScratchBytes: 3_072,
				usefulBinaryWorkingSet: {
					bytes: 3_532,
					certainty: 'upper-bound',
					scope: 'spectral-edit-target-useful-binary-working-set',
				},
			},
		],
		peakTargetIndex: 1,
		initialRetainedCompletedOutputBytes: 12,
		finalRetainedCompletedOutputBytes: 172,
		maximumUsefulBinaryBytes: 256 * MIB,
		usefulBinaryWorkingSet: {
			bytes: 3_532,
			certainty: 'upper-bound',
			scope: 'spectral-edit-workflow-useful-binary-working-set',
		},
		browserHeapBytes: null,
		processResidentSetBytes: null,
		garbageCollectionHeadroomBytes: null,
	});
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.phases), true);
	assert.equal(Object.isFrozen(plan.phases[0]), true);
	assert.equal(Object.isFrozen(plan.phases[0]?.usefulBinaryWorkingSet), true);
	assert.equal(Object.isFrozen(plan.usefulBinaryWorkingSet), true);
});

test('spectral edit admission retains all earlier outputs while selecting the peak phase', () => {
	const plan = planSpectralEditWorkflowAdmission({ targets: [
		{ channelCount: 2, frameCount: 1_000, selectionFrameCount: 1_000, windowSize: 2_048 },
		{ channelCount: 1, frameCount: 1, selectionFrameCount: 1, windowSize: 32 },
	] });

	assert.equal(plan.phases[0]?.retainedCompletedOutputBytes, 0);
	assert.equal(plan.phases[1]?.retainedCompletedOutputBytes, 8_000);
	assert.equal(plan.finalRetainedCompletedOutputBytes, 8_004);
	assert.equal(plan.peakTargetIndex, 0);
	assert.equal(plan.usefulBinaryWorkingSet.bytes, plan.phases[0]?.usefulBinaryWorkingSet.bytes);
});

test('single-target spectral admission shares the workflow plan and retained-byte contract', () => {
	const target = { channelCount: 2, frameCount: 10, selectionFrameCount: 4, windowSize: 32 };
	assert.deepEqual(
		planSpectralEditJobAdmission({
			...target,
			retainedCompletedOutputBytes: 100,
			maximumUsefulBinaryBytes: 2_000,
		}),
		planSpectralEditWorkflowAdmission({
			targets: [target],
			initialRetainedCompletedOutputBytes: 100,
			maximumUsefulBinaryBytes: 2_000,
		}),
	);
});

test('spectral edit admission accepts the exact production ceiling and rejects one byte more', () => {
	const target = {
		channelCount: 1,
		frameCount: 9_586_925,
		selectionFrameCount: 9_586_925,
		windowSize: 32,
	};
	const exact = planSpectralEditJobAdmission({
		...target,
		retainedCompletedOutputBytes: 20,
	});
	assert.equal(
		exact.usefulBinaryWorkingSet.bytes,
		MAXIMUM_SPECTRAL_EDIT_USEFUL_BINARY_BYTES,
	);

	assert.throws(
		() => planSpectralEditJobAdmission({
			...target,
			retainedCompletedOutputBytes: 21,
		}),
		(error: unknown) => error instanceof SpectralEditMemoryLimitError
			&& error.code === 'SPECTRAL_EDIT_MEMORY_LIMIT'
			&& error.targetIndex === 0
			&& error.peakUsefulBinaryBytes === MAXIMUM_SPECTRAL_EDIT_USEFUL_BINARY_BYTES + 1
			&& error.maximumUsefulBinaryBytes === MAXIMUM_SPECTRAL_EDIT_USEFUL_BINARY_BYTES,
	);
});

test('a lower-only spectral edit seam rejects one-past without allocating target PCM', () => {
	const target = { channelCount: 1, frameCount: 1, selectionFrameCount: 1, windowSize: 32 };
	assert.equal(planSpectralEditJobAdmission({
		...target,
		retainedCompletedOutputBytes: 436,
		maximumUsefulBinaryBytes: 2_000,
	}).usefulBinaryWorkingSet.bytes, 2_000);
	assert.throws(
		() => planSpectralEditJobAdmission({
			...target,
			retainedCompletedOutputBytes: 437,
			maximumUsefulBinaryBytes: 2_000,
		}),
		/Spectral edit.*2,?001.*2,?000/iu,
	);
});

test('spectral edit admission rejects malformed geometry and retained-byte accounting', () => {
	const valid = { channelCount: 2, frameCount: 100, selectionFrameCount: 50, windowSize: 2_048 };
	for (const target of [
		{ ...valid, channelCount: 0 },
		{ ...valid, channelCount: 33 },
		{ ...valid, channelCount: 1.5 },
		{ ...valid, frameCount: 0 },
		{ ...valid, frameCount: Number.POSITIVE_INFINITY },
		{ ...valid, selectionFrameCount: 0 },
		{ ...valid, selectionFrameCount: 101 },
		{ ...valid, windowSize: 31 },
		{ ...valid, windowSize: 33 },
		{ ...valid, windowSize: 32_768 },
	]) {
		assert.throws(
			() => planSpectralEditJobAdmission(target),
			/Spectral edit/iu,
		);
	}
	assert.throws(
		() => planSpectralEditWorkflowAdmission({ targets: [] }),
		/Spectral edit workflow.*target/iu,
	);
	for (const retained of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '12']) {
		assert.throws(
			() => planSpectralEditJobAdmission({
				...valid,
				retainedCompletedOutputBytes: retained as never,
			}),
			/retained completed output bytes/iu,
		);
	}
});

test('spectral edit admission rejects unsafe byte arithmetic', () => {
	assert.throws(
		() => planSpectralEditJobAdmission({
			channelCount: 32,
			frameCount: Number.MAX_SAFE_INTEGER,
			selectionFrameCount: Number.MAX_SAFE_INTEGER,
			windowSize: 16_384,
		}),
		/supported safe integer range/iu,
	);
	assert.throws(
		() => planSpectralEditJobAdmission({
			channelCount: 1,
			frameCount: 1,
			selectionFrameCount: 1,
			windowSize: 32,
			retainedCompletedOutputBytes: Number.MAX_SAFE_INTEGER,
		}),
		/supported safe integer range/iu,
	);
});

test('spectral channel inspection requires exact tight planar Float32 geometry', () => {
	const channels = [new Float32Array(4), new Float32Array(4)];
	const inspection = inspectSpectralEditChannels(channels, {
		label: 'Spectral edit result',
		expectedChannelCount: 2,
		expectedFrameCount: 4,
	});
	assert.deepEqual(inspection, {
		channels,
		channelCount: 2,
		frameCount: 4,
		byteLength: 32,
	});
	assert.equal(Object.isFrozen(inspection), true);
	assert.equal(Object.isFrozen(inspection.channels), true);

	for (const [input, options, pattern] of [
		[[], {}, /1 to 32 channels/iu],
		[[new Float32Array(0)], {}, /non-empty.*equally sized/iu],
		[[new Float32Array(2), new Float32Array(3)], {}, /non-empty.*equally sized/iu],
		[[new Float32Array(2), new Float32Array(2)], { expectedChannelCount: 1 }, /channel count/iu],
		[[new Float32Array(2)], { expectedFrameCount: 3 }, /frame count/iu],
		[[new Float32Array(new ArrayBuffer(16), 4, 2)], {}, /tight ArrayBuffer/iu],
	] as const) {
		assert.throws(
			() => inspectSpectralEditChannels(input, options),
			pattern,
		);
	}
	const repeated = new Float32Array(2);
	assert.throws(
		() => inspectSpectralEditChannels([repeated, repeated]),
		/distinct ArrayBuffer/iu,
	);
	if (typeof SharedArrayBuffer === 'function') {
		assert.throws(
			() => inspectSpectralEditChannels([
				new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT)),
			]),
			/tight ArrayBuffer/iu,
		);
	}
	const ResizableArrayBuffer = ArrayBuffer as unknown as new(
		byteLength: number,
		options: Readonly<{ maxByteLength: number }>,
	) => ArrayBuffer;
	const resizable = new ResizableArrayBuffer(8, { maxByteLength: 16 });
	if ((resizable as ArrayBuffer & { readonly resizable?: boolean }).resizable === true) {
		assert.throws(
			() => inspectSpectralEditChannels([new Float32Array(resizable)]),
			/tight ArrayBuffer/iu,
		);
	}
});

test('spectral channel inspection cannot be desynchronized by overridden accessors or iteration', () => {
	class LyingFloat32Array extends Float32Array {
		readonly fakeBuffer = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT);
		override get length(): number { return 1; }
		override get byteLength(): number { return Float32Array.BYTES_PER_ELEMENT; }
		override get byteOffset(): number { return 0; }
		override get buffer(): ArrayBuffer { return this.fakeBuffer; }
	}
	assert.throws(
		() => inspectSpectralEditChannels([new LyingFloat32Array(1_000)], {
			expectedChannelCount: 1,
			expectedFrameCount: 1,
		}),
		/frame count|Float32Array|tight ArrayBuffer/iu,
	);
	class LyingArrayBuffer extends ArrayBuffer {
		override get byteLength(): number { return Float32Array.BYTES_PER_ELEMENT; }
	}
	const hiddenBacking = new LyingArrayBuffer(4_000);
	assert.throws(
		() => inspectSpectralEditChannels([new Float32Array(hiddenBacking, 0, 1)], {
			expectedChannelCount: 1,
			expectedFrameCount: 1,
		}),
		/tight ArrayBuffer/iu,
	);

	let iteratorCalls = 0;
	class HostileChannelArray extends Array<Float32Array> {
		override [Symbol.iterator](): ArrayIterator<Float32Array> {
			iteratorCalls += 1;
			return [new Float32Array(1_000)][Symbol.iterator]();
		}
	}
	const numericChannel = new Float32Array(1);
	const hostileChannels = new HostileChannelArray();
	hostileChannels.push(numericChannel);
	const inspection = inspectSpectralEditChannels(hostileChannels, {
		expectedChannelCount: 1,
		expectedFrameCount: 1,
	});
	assert.equal(iteratorCalls, 0);
	assert.deepEqual(inspection.channels, [numericChannel]);
});

test('spectral edit maximum is nonraiseable with a zero-capable lower-only seam', () => {
	assert.equal(MAXIMUM_SPECTRAL_EDIT_USEFUL_BINARY_BYTES, 256 * MIB);
	assert.equal(normalizeSpectralEditMaximumUsefulBinaryBytes(), 256 * MIB);
	assert.equal(normalizeSpectralEditMaximumUsefulBinaryBytes(0), 0);
	assert.equal(normalizeSpectralEditMaximumUsefulBinaryBytes(1_000), 1_000);
	assert.equal(normalizeSpectralEditMaximumUsefulBinaryBytes(256 * MIB), 256 * MIB);
	for (const value of [
		-1,
		0.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.MAX_SAFE_INTEGER + 1,
		256 * MIB + 1,
		'1000',
	]) {
		assert.throws(
			() => normalizeSpectralEditMaximumUsefulBinaryBytes(value),
			/Spectral edit maximum/iu,
		);
	}
});

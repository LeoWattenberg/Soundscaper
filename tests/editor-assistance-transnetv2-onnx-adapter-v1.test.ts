/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_TRANSNET_V2_CPU_INPUT_SHAPE,
	ASSISTANCE_TRANSNET_V2_FRAME_BYTES,
	ASSISTANCE_TRANSNET_V2_SOURCE,
	createAssistanceTransNetV2CpuInputBatchV1,
	runAssistanceTransNetV2OnnxAdapterV1,
} from '../src/common/editor/assistance/transnetv2-onnx-adapter-v1.ts';

const SOURCE_REVISION = '85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed';

function frames(count: number, overrides: Readonly<Record<string, unknown>> = {}) {
	const data = new Uint8Array(count * ASSISTANCE_TRANSNET_V2_FRAME_BYTES);
	for (let frame = 0; frame < count; frame += 1) {
		data.fill(frame % 256,
			frame * ASSISTANCE_TRANSNET_V2_FRAME_BYTES,
			(frame + 1) * ASSISTANCE_TRANSNET_V2_FRAME_BYTES);
	}
	let tick = 0;
	const presentationTicks = Array.from({ length: count }, (_, index) => {
		if (index > 0) tick += index % 2 === 0 ? 41 : 33;
		return String(tick);
	});
	return {
		schemaVersion: 1,
		pixelFormat: 'rgb24', width: 48, height: 27, rowStrideBytes: 144,
		timescale: 1_000, presentationTicks, data,
		...overrides,
	};
}

function request(count: number, overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		schemaVersion: 1,
		frames: frames(count),
		inputElementType: 'uint8',
		outputValueKind: 'logits',
		threshold: 0.5,
		minimumBoundaryDistanceFrames: 1,
		...overrides,
	};
}

function output(
	valueKind: 'logits' | 'probabilities',
	values: Readonly<Record<number, number>> = {},
) {
	const fill = valueKind === 'logits' ? -20 : 0;
	const single = new Float32Array(100).fill(fill);
	const all = new Float32Array(100).fill(fill);
	for (const [index, value] of Object.entries(values)) single[Number(index)] = value;
	return {
		singleFrame: { type: 'float32', dims: [1, 100, 1], data: single },
		allFrame: { type: 'float32', dims: [1, 100, 1], data: all },
	};
}

function firstByte(batch: { data: Uint8Array | Float32Array }, slot: number): number {
	return batch.data[slot * ASSISTANCE_TRANSNET_V2_FRAME_BYTES]!;
}

test('the adapter pins upstream RGB geometry, CPU tensor shape, and reviewed source revision', () => {
	assert.deepEqual(ASSISTANCE_TRANSNET_V2_SOURCE, {
		url: `https://github.com/soCzech/TransNetV2/blob/${SOURCE_REVISION}/inference/transnetv2.py`,
		revision: SOURCE_REVISION,
	});
	assert.deepEqual(ASSISTANCE_TRANSNET_V2_CPU_INPUT_SHAPE, [1, 100, 27, 48, 3]);
});

test('100-frame windows replicate edges and expose only each central 50-frame authority once', () => {
	const decoded = frames(51);
	const first = createAssistanceTransNetV2CpuInputBatchV1(decoded, 0, 'uint8');
	assert.equal(first.batchIndex, 0);
	assert.equal(first.sourceFrameStart, 0);
	assert.equal(first.authoritativeFrameCount, 50);
	assert.equal(first.elementType, 'uint8');
	assert.deepEqual(first.dims, [1, 100, 27, 48, 3]);
	assert.ok(first.data instanceof Uint8Array);
	assert.equal(first.data.length, 100 * ASSISTANCE_TRANSNET_V2_FRAME_BYTES);
	assert.equal(firstByte(first, 0), 0);
	assert.equal(firstByte(first, 24), 0);
	assert.equal(firstByte(first, 25), 0);
	assert.equal(firstByte(first, 26), 1);
	assert.equal(firstByte(first, 75), 50);
	assert.equal(firstByte(first, 99), 50);

	const second = createAssistanceTransNetV2CpuInputBatchV1(decoded, 1, 'float32');
	assert.equal(second.sourceFrameStart, 50);
	assert.equal(second.authoritativeFrameCount, 1);
	assert.equal(second.elementType, 'float32');
	assert.ok(second.data instanceof Float32Array);
	assert.equal(firstByte(second, 0), 25);
	assert.equal(firstByte(second, 24), 49);
	assert.equal(firstByte(second, 25), 50);
	assert.equal(firstByte(second, 99), 50);
	assert.throws(() => createAssistanceTransNetV2CpuInputBatchV1(decoded, 2, 'uint8'),
		/batch.*range|index/iu);
});

test('the ONNX adapter sigmoids finite logits, ignores overlap context, and preserves exact VFR ticks', async () => {
	const decoded = frames(73);
	const calls: Array<Readonly<{ sourceFrameStart: number; authoritativeFrameCount: number }>> = [];
	const result = await runAssistanceTransNetV2OnnxAdapterV1(request(73, {
		frames: decoded,
	}), {
		runBatch: async (batch) => {
			calls.push({
				sourceFrameStart: batch.sourceFrameStart,
				authoritativeFrameCount: batch.authoritativeFrameCount,
			});
			if (batch.batchIndex === 0) {
				// Slots 75+ are right context. A huge value there cannot claim frame 50.
				return output('logits', { 35: 4, 75: 20 });
			}
			// Slots 0-24 are left context. Only central slot 35 claims source frame 60.
			return output('logits', { 0: 20, 35: 3 });
		},
	});
	assert.deepEqual(calls, [
		{ sourceFrameStart: 0, authoritativeFrameCount: 50 },
		{ sourceFrameStart: 50, authoritativeFrameCount: 23 },
	]);
	assert.deepEqual(result.boundaries.map(({ sourceFrame, presentationTick }) => ({
		sourceFrame, presentationTick,
	})), [
		{ sourceFrame: 10, presentationTick: decoded.presentationTicks[10] },
		{ sourceFrame: 60, presentationTick: decoded.presentationTicks[60] },
	]);
	assert.equal(result.boundaries[0]!.score, Math.fround(1 / (1 + Math.exp(-4))));
	assert.equal(result.sourceFrameCount, 73);
});

test('probability outputs are admitted without a second sigmoid and both heads retain authority', async () => {
	const result = await runAssistanceTransNetV2OnnxAdapterV1(request(4, {
		outputValueKind: 'probabilities',
	}), {
		runBatch: async () => {
			const candidate = output('probabilities', { 26: 0.75 });
			candidate.allFrame.data[28] = 0.8;
			return candidate;
		},
	});
	assert.deepEqual(result.boundaries, [
		{ sourceFrame: 1, presentationTick: '33', score: Math.fround(0.75) },
		{ sourceFrame: 3, presentationTick: '107', score: Math.fround(0.8) },
	]);
});

test('decoded frames and ONNX outputs must match the exact bounded tensor contracts', async () => {
	for (const malformed of [
		frames(1, { width: 47 }),
		frames(1, { rowStrideBytes: 145 }),
		frames(1, { data: new Uint8Array(10) }),
		frames(1, { data: new Uint8Array(new SharedArrayBuffer(
			ASSISTANCE_TRANSNET_V2_FRAME_BYTES,
		)) }),
		frames(2, { presentationTicks: ['0', '0'] }),
		{ ...frames(1), invented: true },
	]) {
		assert.throws(() => createAssistanceTransNetV2CpuInputBatchV1(malformed, 0, 'uint8'),
			/geometry|stride|length|tick|field|RGB/iu);
	}
	for (const malformedOutput of [
		{ ...output('logits'), singleFrame: {
			...output('logits').singleFrame, dims: [1, 99, 1],
		} },
		{ ...output('logits'), allFrame: {
			...output('logits').allFrame, type: 'float64',
		} },
		{ ...output('logits'), allFrame: {
			...output('logits').allFrame, data: new Float32Array(99),
		} },
		{ ...output('logits'), allFrame: {
			...output('logits').allFrame, data: new Float32Array(new SharedArrayBuffer(400)),
		} },
	]) {
		await assert.rejects(runAssistanceTransNetV2OnnxAdapterV1(request(1), {
			runBatch: async () => malformedOutput,
		}), /output|tensor|shape|geometry|type|length/iu);
	}
	await assert.rejects(runAssistanceTransNetV2OnnxAdapterV1(request(1, {
		outputValueKind: 'probabilities',
	}), {
		runBatch: async () => output('probabilities', { 25: 1.1 }),
	}), /probability|finite|\[0, 1\]/iu);
	await assert.rejects(runAssistanceTransNetV2OnnxAdapterV1(request(1), {
		runBatch: async () => output('logits', { 25: Number.NaN }),
	}), /logit|finite/iu);
});

test('cancellation is checked after every bounded batch before another batch receives authority', async () => {
	const controller = new AbortController();
	let calls = 0;
	await assert.rejects(runAssistanceTransNetV2OnnxAdapterV1(request(101), {
		signal: controller.signal,
		runBatch: async () => {
			calls += 1;
			controller.abort(new DOMException('cancelled', 'AbortError'));
			return output('logits');
		},
	}), (error: Error) => error.name === 'AbortError');
	assert.equal(calls, 1);
});

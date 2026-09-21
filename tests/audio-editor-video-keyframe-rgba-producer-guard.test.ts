/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createExactVideoKeyframeRgbaProducer,
	produceIntoExactVideoKeyframeRgbaAllocation,
} from '../src/common/editor/video-keyframe-rgba-producer-guard.ts';

const MESSAGES = Object.freeze({
	returnValue: 'custom return-value failure',
	allocation: 'custom allocation failure',
});

test('one RGBA guard rejects replacement results and detached reusable allocations', async () => {
	const replacement = producer(() => new Uint8Array(4) as never);
	await assert.rejects(
		produceIntoExactVideoKeyframeRgbaAllocation(replacement, {}, new Uint8Array(4), {}, 4, MESSAGES),
		(error: unknown) => error instanceof TypeError && error.message === MESSAGES.returnValue,
	);

	const detached = producer((_frame, target) => {
		structuredClone(target.buffer, { transfer: [target.buffer] });
	});
	await assert.rejects(
		produceIntoExactVideoKeyframeRgbaAllocation(detached, {}, new Uint8Array(4), {}, 4, MESSAGES),
		(error: unknown) => error instanceof Error && error.message === MESSAGES.allocation,
	);
});

test('the WebCodecs adapter delegates exact-allocation enforcement without changing its shape', async () => {
	let observedTarget: Uint8Array | null = null;
	const guarded = createExactVideoKeyframeRgbaProducer(producer((_frame, target) => {
		observedTarget = target;
		target.fill(7);
	}), 4, MESSAGES);
	const target = new Uint8Array(4);
	await guarded.produce({}, target, {});
	assert.equal(guarded.byteLength, 4);
	assert.equal(observedTarget, target);
	assert.deepEqual([...target], [7, 7, 7, 7]);
});

function producer(
	produce: (frame: unknown, target: Uint8Array<ArrayBuffer>) => unknown,
) {
	return {
		width: 1,
		height: 1,
		byteLength: 4,
		produce,
		dispose() {},
	};
}

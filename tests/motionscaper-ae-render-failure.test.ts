/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMotionscaperAeRenderFailure } from '../src/motionscaper/editor-ae-render-failure.ts';
import { MotionDeliveryCleanupFailure } from '../src/common/editor/motion-delivery-cleanup.ts';
test('Motion AE rendered cancellation preserves real cleanup errors and retry capabilities, collapsing only the identical memory stream abort reason', () => {
	const abort = new AbortController(); abort.abort(); const reason: unknown = abort.signal.reason;
	assert.equal(normalizeMotionscaperAeRenderFailure(new AggregateError([reason, new AggregateError([reason])]), abort.signal), reason);
	for (const failure of [new AggregateError([reason, new Error('cleanup failed')]), new AggregateError([reason, new DOMException('Other abort', 'AbortError')]), new AggregateError([]), new MotionDeliveryCleanupFailure([reason], 'Retry still required', async () => {})]) assert.equal(normalizeMotionscaperAeRenderFailure(failure, abort.signal), failure);
	const failure = new AggregateError([reason]); assert.equal(normalizeMotionscaperAeRenderFailure(failure, new AbortController().signal), failure);
	const cyclic = new AggregateError([]); cyclic.errors.push(cyclic); assert.equal(normalizeMotionscaperAeRenderFailure(cyclic, abort.signal), cyclic);
});

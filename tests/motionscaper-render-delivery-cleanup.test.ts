/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMotionscaperDelivery } from '../src/motionscaper/editor-render-delivery.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';

test('motion delivery retains the primary admission error when destination cleanup also fails', async () => {
	const project = createMotionscaperProject({ id: 'project', title: 'Cleanup', compositionId: 'main' });
	const cleanup = new Error('Destination cleanup failed'); let aborted = 0;
	const writable = new WritableStream<Uint8Array>({ abort() { aborted++; throw cleanup; } });
	await assert.rejects(renderMotionscaperDelivery({ project, compositionId: 'main', store: { readAsset: () => Promise.resolve(null) }, firstFrame: 0, endFrame: 0,
		format: 'png', writable, signal: new AbortController().signal, onProgress: () => undefined }), (failure: unknown) => {
		assert.ok(failure instanceof AggregateError); assert.equal(failure.errors.length, 2);
		assert.ok(failure.errors[0] instanceof RangeError); assert.equal(failure.errors[1], cleanup); return true;
	});
	assert.equal(aborted, 1);
});

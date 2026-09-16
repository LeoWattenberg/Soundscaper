/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportTaskCancellation } from '../src/common/editor/controller/import/internal/import-task-cancellation.ts';
import { normalizeProjectImportOptions } from '../src/common/editor/controller/import/internal/project-import-options.ts';

test('import cancellation preserves placement and shares task cancellation with the decoder', () => {
	const request = normalizeProjectImportOptions({ destination: 'timeline', timelineStartFrame: 44 }, 'invalid');
	const task = createImportTaskCancellation(request);
	assert.equal(task.options.timelineStartFrame, 44);
	assert.equal(task.options.timelineStartExplicit, true);
	assert.strictEqual(task.options.signal, task.signal);
	task.abort();
	assert.throws(() => task.options.signal?.throwIfAborted(), { name: 'AbortError' });
});

test('an externally cancelled import keeps its cancellation authority after option normalization', () => {
	const controller = new AbortController();
	const request = normalizeProjectImportOptions({ signal: controller.signal }, 'invalid');
	const task = createImportTaskCancellation(request);
	const failure = new DOMException('caller cancelled', 'AbortError');
	controller.abort(failure);
	assert.throws(() => task.signal.throwIfAborted(), (error: unknown) => error === failure);
});

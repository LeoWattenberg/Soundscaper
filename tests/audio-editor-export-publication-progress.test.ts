/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { audioExportPublicationProgress } from '../src/common/editor/controller/export/internal/audio/audio-export-progress.ts';
import { createEditorTaskProgressCoordinator } from '../src/common/editor/controller/shared/task-progress.ts';

test('final export writes retain cancellation and map acknowledgements onto the remaining progress', () => {
	const progress = createEditorTaskProgressCoordinator();
	const task = progress.begin('export', 'Encoding', 0.95);
	const abort = new AbortController();
	const request = audioExportPublicationProgress(task, 'Save', abort.signal);
	assert.equal(request.signal, abort.signal);
	request.onProgress(0.5);
	assert.equal(progress.getSnapshot()?.value, 0.975);
	assert.equal(progress.getSnapshot()?.label, 'Save');
	abort.abort();
	assert.equal(request.signal.aborted, true);
	request.onProgress(1);
	assert.equal(progress.getSnapshot()?.value, 1);
	task.finish();
	assert.equal(progress.getSnapshot(), null);
});

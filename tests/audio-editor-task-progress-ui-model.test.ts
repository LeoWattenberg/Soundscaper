/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { selectFallbackTaskProgress } from '../src/common/editor/ui/task-progress-ui-model.ts';

test('busy task fallback covers bounded work and excludes continuous recording', () => {
	assert.deepEqual(selectFallbackTaskProgress({ importing: true }, 'Importing'), {
		id: 'busy-import', kind: 'import', label: 'Importing', value: null,
	});
	assert.equal(selectFallbackTaskProgress({ recording: true } as never, 'Recording'), null);
	assert.equal(selectFallbackTaskProgress({}, 'Ready'), null);
});

test('busy task fallback uses deterministic foreground priority', () => {
	assert.equal(selectFallbackTaskProgress({
		exporting: true,
		processingEffect: true,
		analysisProcessing: true,
	}, 'Working')?.kind, 'export');
	assert.equal(selectFallbackTaskProgress({
		playbackOptions: { preparing: true },
		sampleEdit: { processing: true },
	}, 'Working')?.kind, 'sample-edit');
});

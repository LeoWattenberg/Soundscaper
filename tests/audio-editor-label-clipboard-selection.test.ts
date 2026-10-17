/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedLabelsForProject } from '../src/common/editor/label-clipboard-selection.ts';
import { createSelectedLabelClipboardService } from '../src/common/editor/controller/edit/internal/selected-label-clipboard.ts';

test('empty label selection never scans a large cue sheet during snapshots or ordinary media edits', () => {
	let labelReads = 0, projectReads = 0;
	const labels = Array.from({ length: 100_000 }, (_, index) => ({ id: `cue-${String(index)}` }));
	const project = { id: 'large-cues', sampleRate: 48_000, tracks: [{ id: 'cues', type: 'label',
		get labels() { labelReads++; return labels; } }] };
	const state = { selectedLabels: [], selectedLabelsProjectId: project.id,
		selectedTrackId: null, selectedClipId: null, clipboard: {
			schemaVersion: 1 as const, sampleRate: 48_000, durationFrames: 1, tracks: [],
		} };
	assert.deepEqual(selectedLabelsForProject(project, state), []);
	assert.equal(labelReads, 0, 'empty published selection must not index 100,000 cue IDs');
	const service = createSelectedLabelClipboardService({ state,
		getProject() { projectReads++; return project; }, getPositionFrames: () => 0,
		createId: () => 'unused', updateSelection() {}, commit() {}, prepareClipboard: () => () => undefined,
		publish() {}, copy: { labelTrackMissing: 'Missing labels' }, setStatus() {},
	});
	for (const action of ['delete', 'duplicate', 'copy', 'cut', 'cut-per-track-ripple', 'paste']) {
		assert.equal(service.handle(action), false, 'the native media dispatcher retains ownership');
	}
	assert.equal(projectReads, 0, 'unrelated edits bypass label project resolution entirely');
	assert.equal(labelReads, 0);
});

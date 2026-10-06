/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportPlan } from '../src/common/editor/export.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createExportChapterPlan } from '../src/common/editor/export-chapters.ts';

test('CART selected-range delivery rebases contained cues and drops cues outside the delivered audio', () => {
	const project = createCurrentAudioEditorProject({ sampleRate: 48_000, metadata: { cart: {
		title: 'Radio continuity take', postTimers: [
			{ usage: 'INT ', value: 4_800 }, { usage: 'SEC1', value: 24_000 },
			{ usage: 'SEC2', value: 36_000 }, { usage: 'EOD ', value: 48_000 },
		],
	} } });
	const plan = createExportPlan(project, { format: 'bwf', sampleRate: 96_000, range: { startFrame: 12_000, endFrame: 36_000 } });
	assert.deepEqual(plan.cart?.postTimers, [{ usage: 'SEC1', value: 24_000 }, { usage: 'SEC2', value: 48_000 }]);
	assert.equal(plan.cart?.title, 'Radio continuity take');
	assert.deepEqual(project.metadata.cart?.postTimers.map(timer => timer.value), [4_800, 24_000, 36_000, 48_000]);
});

test('each broadcast chapter carries only its own rebased CART cues into the writer plan', () => {
	const project = createCurrentAudioEditorProject({
		sampleRate: 48_000,
		metadata: { cart: { title: 'Radio continuity take', postTimers: [
			{ usage: 'SEC1', value: 24_000 }, { usage: 'EOD ', value: 48_000 },
		] } },
		tracks: [{ id: 'labels', type: 'label', name: 'Delivery', labels: [
			{ id: 'first', title: 'First', startFrame: 0, endFrame: 12_000 },
			{ id: 'second', title: 'Second', startFrame: 12_000, endFrame: 48_000 },
		] }],
	});
	const plan = createExportPlan(project, { format: 'bwf', sampleRate: 96_000, mode: 'chapters', range: { startFrame: 0, endFrame: 48_000 } });
	assert.equal(plan.outputs.length, 2);
	const first = plan.outputs[0];
	const second = plan.outputs[1];
	assert.ok(first && second);
	assert.deepEqual(createExportChapterPlan(plan, first).cart?.postTimers, []);
	assert.deepEqual(createExportChapterPlan(plan, second).cart?.postTimers, [
		{ usage: 'SEC1', value: 24_000 }, { usage: 'EOD ', value: 72_000 },
	]);
});

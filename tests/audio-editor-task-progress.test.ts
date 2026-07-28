/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorTaskProgressCoordinator } from '../src/common/editor/controller/task-progress.ts';

test('task progress clamps values and stays monotonic within a phase', () => {
	const coordinator = createEditorTaskProgressCoordinator();
	const task = coordinator.begin('export', 'Rendering', 0);
	task.update(0.6);
	task.update(0.2);
	assert.deepEqual(coordinator.getSnapshot(), {
		id: task.id,
		kind: 'export',
		label: 'Rendering',
		value: 0.6,
	});
	task.update(4);
	assert.equal(coordinator.getSnapshot()?.value, 1);
});

test('task progress maps ordered phases onto an overall ratio', () => {
	const coordinator = createEditorTaskProgressCoordinator();
	const task = coordinator.begin('export', 'Rendering', 0);
	task.setPhase('Rendering', { start: 0, end: 0.75, value: 0.5 });
	assert.equal(coordinator.getSnapshot()?.value, 0.375);
	task.setPhase('Encoding', { start: 0.75, end: 1, value: 0 });
	task.update(0.4);
	assert.deepEqual(coordinator.getSnapshot(), {
		id: task.id,
		kind: 'export',
		label: 'Encoding',
		value: 0.85,
	});
});

test('task progress supports indeterminate work and publishes immutable snapshots', () => {
	const published = [];
	const coordinator = createEditorTaskProgressCoordinator({ onChange: (progress) => published.push(progress) });
	const task = coordinator.begin('effect', 'Processing');
	assert.equal(coordinator.getSnapshot()?.value, null);
	assert.equal(Object.isFrozen(coordinator.getSnapshot()), true);
	task.update(0.25);
	assert.equal(coordinator.getSnapshot()?.value, 0.25);
	task.setIndeterminate('Saving');
	assert.equal(coordinator.getSnapshot()?.label, 'Saving');
	assert.equal(coordinator.getSnapshot()?.value, null);
	assert.equal(published.length, 3);
});

test('replacement invalidates stale task handles and cleanup is owner-safe', () => {
	const coordinator = createEditorTaskProgressCoordinator();
	const first = coordinator.begin('import', 'Importing');
	const second = coordinator.begin('analysis', 'Analyzing');
	assert.equal(first.update(0.5), false);
	assert.equal(first.finish(), false);
	assert.equal(coordinator.getSnapshot()?.id, second.id);
	assert.equal(second.finish(), true);
	assert.equal(coordinator.getSnapshot(), null);
	assert.equal(coordinator.clear(), false);
});

test('coordinator forwards progress from shared runtime producers to the active task', () => {
	const coordinator = createEditorTaskProgressCoordinator();
	const task = coordinator.begin('export', 'Rendering', 0);
	assert.equal(coordinator.setActivePhase('Encoding', { start: 0.75, end: 1, value: 0 }), true);
	assert.equal(coordinator.updateActive(0.5), true);
	assert.equal(coordinator.getSnapshot()?.value, 0.875);
	task.finish();
	assert.equal(coordinator.updateActive(1), false);
});

test('run clears owned progress after success and failure', async () => {
	const coordinator = createEditorTaskProgressCoordinator();
	assert.equal(await coordinator.run('render', 'Rendering', async (task) => {
		task.update(0.5);
		return coordinator.getSnapshot()?.value;
	}, 0), 0.5);
	assert.equal(coordinator.getSnapshot(), null);
	await assert.rejects(coordinator.run('analysis', 'Analyzing', () => Promise.reject(new Error('failed'))));
	assert.equal(coordinator.getSnapshot(), null);
});

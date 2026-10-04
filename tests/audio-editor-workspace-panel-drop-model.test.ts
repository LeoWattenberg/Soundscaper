import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveWorkspacePanelDropIntent,
	resolveWorkspacePanelDropPreview,
	type WorkspacePanelDropIntent,
} from '../src/common/editor/ui/workspace/workspace-panel-drop-model.ts';

const bounds = Object.freeze({
	left: 40,
	top: 90,
	width: 300,
	height: 300,
});

test('side dock targets split vertically into before, tab, and after thirds', () => {
	for (const dock of ['left', 'right'] as const) {
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 100, y: 90 }, bounds), 'before');
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 100, y: 190 }, bounds), 'before');
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 100, y: 190.01 }, bounds), 'tab');
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 100, y: 290 }, bounds), 'tab');
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 100, y: 290.01 }, bounds), 'after');
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 100, y: 390 }, bounds), 'after');
	}
});

test('top and bottom dock targets split horizontally into before, tab, and after thirds', () => {
	for (const dock of ['top', 'bottom']) {
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 40, y: 120 }, bounds), 'before');
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 140, y: 120 }, bounds), 'before');
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 140.01, y: 120 }, bounds), 'tab');
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 240, y: 120 }, bounds), 'tab');
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 240.01, y: 120 }, bounds), 'after');
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 340, y: 120 }, bounds), 'after');
	}
});

test('drop intent rejects unsupported docks, invalid geometry, and points outside the target', () => {
	assert.equal(resolveWorkspacePanelDropIntent('floating', { x: 100, y: 100 }, bounds), null);
	assert.equal(resolveWorkspacePanelDropIntent('missing', { x: 100, y: 100 }, bounds), null);
	assert.equal(resolveWorkspacePanelDropIntent('left', { x: 39.99, y: 100 }, bounds), null);
	assert.equal(resolveWorkspacePanelDropIntent('left', { x: 100, y: 390.01 }, bounds), null);
	assert.equal(resolveWorkspacePanelDropIntent('left', { x: Number.NaN, y: 100 }, bounds), null);
	assert.equal(resolveWorkspacePanelDropIntent('left', { x: 100, y: 100 }, {
		...bounds,
		height: 0,
	}), null);
	assert.equal(resolveWorkspacePanelDropIntent('bottom', { x: 100, y: 100 }, {
		...bounds,
		width: Number.POSITIVE_INFINITY,
	}), null);
});

test('side previews use the corresponding half or the complete target', () => {
	assert.deepEqual(resolveWorkspacePanelDropPreview('left', 'before', bounds), {
		left: 40,
		top: 90,
		width: 300,
		height: 150,
	});
	assert.deepEqual(resolveWorkspacePanelDropPreview('right', 'tab', bounds), bounds);
	assert.deepEqual(resolveWorkspacePanelDropPreview('right', 'after', bounds), {
		left: 40,
		top: 240,
		width: 300,
		height: 150,
	});
});

test('top and bottom previews use the corresponding half or the complete target', () => {
	for (const dock of ['top', 'bottom']) {
		assert.deepEqual(resolveWorkspacePanelDropPreview(dock, 'before', bounds), {
			left: 40,
			top: 90,
			width: 150,
			height: 300,
		});
		assert.deepEqual(resolveWorkspacePanelDropPreview(dock, 'tab', bounds), bounds);
		assert.deepEqual(resolveWorkspacePanelDropPreview(dock, 'after', bounds), {
			left: 190,
			top: 90,
			width: 150,
			height: 300,
		});
	}
});

test('preview geometry rejects unsupported docks, intents, and unusable bounds', () => {
	assert.equal(resolveWorkspacePanelDropPreview('floating', 'tab', bounds), null);
	assert.equal(resolveWorkspacePanelDropPreview(
		'left',
		'missing' as WorkspacePanelDropIntent,
		bounds,
	), null);
	assert.equal(resolveWorkspacePanelDropPreview('left', 'before', {
		...bounds,
		width: -1,
	}), null);
});

test('side dock edges place panels in adjacent columns while the center keeps vertical splitting', () => {
	for (const dock of ['left', 'right']) {
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 44, y: 240 }, bounds), 'left');
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 336, y: 240 }, bounds), 'right');
		assert.equal(resolveWorkspacePanelDropIntent(dock, { x: 190, y: 240 }, bounds), 'tab');
		assert.deepEqual(resolveWorkspacePanelDropPreview(dock, 'left', bounds), { ...bounds, width: 150 });
		assert.deepEqual(resolveWorkspacePanelDropPreview(dock, 'right', bounds), { ...bounds, left: 190, width: 150 });
	}
});

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { sourceLineCount } from '../scripts/lib/source-line-count.mjs';

const UI_ROOT = new URL('../src/common/editor/ui/', import.meta.url);
const TIMELINE_ROOT = new URL('timeline/', UI_ROOT);

test('the legacy Timeline path is only a bounded compatibility facade', async () => {
	const facade = await readFile(new URL('AudioEditorTimeline.jsx', UI_ROOT), 'utf8');
	assert.ok(sourceLineCount(facade) <= 30);
	assert.match(facade, /timeline\/AudioEditorTimeline\.tsx/);
});

test('Timeline production modules stay within the local maintenance budget', async () => {
	const moduleNames = (await readdir(TIMELINE_ROOT))
		.filter((name) => /\.(?:js|jsx|ts|tsx)$/.test(name));
	assert.ok(moduleNames.length >= 8, 'Timeline must be decomposed into focused production modules');
	for (const moduleName of moduleNames) {
		const source = await readFile(new URL(moduleName, TIMELINE_ROOT), 'utf8');
		assert.ok(
			sourceLineCount(source) <= 600,
			`${moduleName} must stay at or below 600 lines`,
		);
	}
});

test('the typed Timeline orchestrator passes cohesive prop groups to the view', async () => {
	const orchestrator = await readFile(new URL('AudioEditorTimeline.tsx', TIMELINE_ROOT), 'utf8');
	const controller = await readFile(new URL('TimelineController.jsx', TIMELINE_ROOT), 'utf8');
	for (const group of ['geometry', 'selection', 'preview', 'navigation', 'actions']) {
		assert.match(orchestrator, new RegExp(`\\b${group}\\b`), `${group} prop group`);
	}
	assert.match(controller, /useTimelineInteractionState/);
});

test('track variants and canvas rendering have focused module owners', async () => {
	const requiredModules = [
		'AudioTrackRow.jsx',
		'LabelTrackRow.jsx',
		'OutputTrackRows.jsx',
		'TimelineCanvasRenderer.jsx',
		'VideoTrackRow.jsx',
	];
	for (const moduleName of requiredModules) {
		const source = await readFile(new URL(moduleName, TIMELINE_ROOT), 'utf8');
		assert.ok(source.length > 0, moduleName);
	}
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('global vertical navigation skips tracks beneath an ordinarily collapsed folder', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const ids = ['First', 'Middle', 'Last'].map(name => controller.actions.track.add({ name }));
	const [first, middle, last] = ids;
	assert.ok(first && middle && last);
	const runtime = createAudacityActionRuntime(controller);
	context.after(() => runtime.dispose());
	controller.actions.timeline.selectTrack(first);
	assert.equal(runtime.actions.navigation.itemBelow(), middle);
	assert.equal(runtime.actions.navigation.itemAbove(), first);
	const folder = controller.actions.trackFolders.wrapSelection([middle]);
	assert.ok(folder);
	controller.actions.trackFolders.toggleCollapsed(folder);
	controller.actions.timeline.selectTrack(first);
	assert.equal(runtime.actions.navigation.itemBelow(), last);
	assert.equal(controller.getSnapshot().selectedTrackId, last);
	assert.equal(runtime.actions.navigation.itemAbove(), first);
	controller.actions.trackFolders.toggleCollapsed(folder);
	assert.equal(runtime.actions.navigation.itemBelow(), middle);
});

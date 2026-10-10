/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('global clip movement skips a normally collapsed destination track', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'round7-visible-clip-move' }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const clipId = await controller.actions.generators.generate('tone', {
		amplitude: .4, channelCount: 1, durationSeconds: 2, frequency: 440,
	});
	const first = controller.getSnapshot().selectedTrackId;
	const middle = controller.actions.track.add({ name: 'Middle' });
	const last = controller.actions.track.add({ name: 'Last' });
	assert.ok(first && middle && last);
	const runtime = createAudacityActionRuntime(controller);
	context.after(() => runtime.dispose());
	const owner = () => controller.getSnapshot().project?.tracks?.find(track =>
		'clipIds' in track && Array.isArray(track.clipIds) && track.clipIds.includes(clipId))?.id;
	controller.actions.timeline.selectClip(clipId);
	await runtime.actions.navigation.moveItemDown();
	assert.equal(owner(), middle, 'expanded destination remains the healthy control');
	controller.actions.edit.undo(); assert.equal(owner(), first);
	const folder = controller.actions.trackFolders.wrapSelection([middle]); assert.ok(folder);
	controller.actions.trackFolders.toggleCollapsed(folder);
	controller.actions.timeline.selectClip(clipId);
	await runtime.actions.navigation.moveItemDown();
	assert.equal(owner(), last, 'movement reaches the next displayed compatible track');
	controller.actions.edit.undo(); assert.equal(owner(), first);
	controller.actions.edit.redo(); assert.equal(owner(), last);
	await runtime.actions.navigation.moveItemUp(); assert.equal(owner(), first);
	controller.actions.trackFolders.toggleCollapsed(folder);
	await runtime.actions.navigation.moveItemDown(); assert.equal(owner(), middle);
});

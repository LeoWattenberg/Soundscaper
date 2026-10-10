/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('published chronological item navigation skips only collapsed ordinary tracks', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'round7-relative-folder' }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const clipIds: string[] = [], trackIds: string[] = [];
	for (let index = 0; index < 3; index += 1) {
		const trackId = controller.actions.track.add({ name: `Recording ${index}` });
		assert.ok(trackId);
		controller.actions.timeline.selectTrack(trackId);
		await controller.actions.generators.generate('tone', { durationSeconds: .2, channelCount: 1,
			amplitude: .25, frequency: 440 });
		const clipId = controller.getSnapshot().selectedClipId;
		assert.ok(clipId);
		clipIds.push(clipId); trackIds.push(trackId);
		controller.actions.clip.move(clipId, trackId, index * 4800);
	}
	const runtime = createAudacityActionRuntime(controller, { productId: 'soundscaper' });
	context.after(() => runtime.dispose());
	controller.actions.timeline.selectClip(clipIds[0]);
	assert.equal(await runtime.actions.navigation.nextItem(), clipIds[1]);
	assert.equal(await runtime.actions.navigation.previousItem(), clipIds[0]);
	const folder = controller.actions.trackFolders.wrapSelection([trackIds[1]!]);
	assert.ok(folder);
	controller.actions.trackFolders.toggleCollapsed(folder);
	controller.actions.timeline.selectClip(clipIds[0]);
	assert.equal(await runtime.actions.navigation.nextItem(), clipIds[2]);
	assert.equal(controller.getSnapshot().selectedClipId, clipIds[2]);
	assert.equal(await runtime.actions.navigation.previousItem(), clipIds[0]);
	controller.actions.trackFolders.toggleCollapsed(folder);
	assert.equal(await runtime.actions.navigation.nextItem(), clipIds[1]);
});

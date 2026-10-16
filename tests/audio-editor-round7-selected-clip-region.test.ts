/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const startFrame of [0, 4_800]) test(`named region uses the selected recording at ${startFrame} without a drawn range`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round7-clip-region-${startFrame}` }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const clipId = await controller.actions.generators.generate('tone', {
		amplitude: .4, channelCount: 1, durationSeconds: .8, frequency: 440,
	});
	controller.actions.clip.move(clipId, null, startFrame);
	controller.actions.timeline.selectClip(clipId);
	controller.actions.timeline.selectTrackStartToEnd();
	controller.actions.timelineAnnotations.createRegionFromSelection();
	const healthy = controller.getSnapshot().timelineAnnotations[0];
	assert.ok(healthy);
	assert.equal(healthy.kind, 'region');
	assert.equal(healthy.timelineStartFrame, startFrame);
	assert.equal(healthy.timelineEndFrame, startFrame + 38_400);
	await controller.actions.edit.undo();
	controller.actions.timeline.clearSelection();
	controller.actions.timeline.selectClip(clipId);
	assert.equal(controller.project!.selection.startFrame, controller.project!.selection.endFrame);
	const media = structuredClone(controller.project!.clips);
	controller.actions.timelineAnnotations.createRegionFromSelection();
	const region = controller.getSnapshot().timelineAnnotations[0];
	assert.ok(region);
	assert.equal(region.kind, 'region');
	assert.equal(region.timelineStartFrame, healthy.timelineStartFrame);
	assert.equal(region.timelineEndFrame, healthy.timelineEndFrame);
	assert.deepEqual(controller.project!.clips, media);
	await controller.actions.edit.undo();
	assert.equal(controller.getSnapshot().timelineAnnotations.length, 0);
	await controller.actions.edit.redo();
	assert.equal(controller.getSnapshot().timelineAnnotations[0]?.timelineEndFrame, healthy.timelineEndFrame);
});

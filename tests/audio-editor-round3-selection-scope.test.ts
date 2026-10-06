/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('Select all tracks widens a selected clip into its exact effective time span without seeking or adding history', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const engine = createMemoryEngine();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'round3-selection-scope' }),
		engine: engine as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 1,
		durationSeconds: 0.8, frequency: 440 });
	const clipId = controller.getSnapshot().selectedClipId!;
	controller.actions.track.add({ name: 'Other track' });
	controller.actions.timeline.selectClip(clipId);
	controller.actions.transport.seek(20_000);
	controller.actions.timeline.selectAllTracks();
	const project = controller.getSnapshot().project!;
	assert.ok(project.selection);
	assert.ok(project.tracks);
	assert.deepEqual({ start: project.selection.startFrame, end: project.selection.endFrame,
		tracks: project.selection.trackIds, clips: project.selection.clipIds },
	{ start: 0, end: 38_400, tracks: project.tracks.map(track => track.id), clips: [] });
	assert.equal(engine.getPositionFrames(), 20_000);
	controller.actions.edit.undo();
	assert.equal(controller.getSnapshot().project!.tracks?.length, 1, 'Undo still removes the preceding added track.');
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Selection = Readonly<{ startFrame: number; endFrame: number; trackIds: readonly string[] }>;

async function fixture() {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 1,
		durationSeconds: 0.8, frequency: 440 });
	return controller;
}

test('Select all tracks does not quantize the existing exact time selection', async (context) => {
	const controller = await fixture();
	context.after(async () => { await controller.dispose(); });
	controller.actions.timeline.selectAll();
	const before = controller.getSnapshot().project!.selection as unknown as Selection;
	controller.actions.timeline.setSnap({ enabled: true, unit: 'seconds', mode: 'nearest' });
	controller.actions.timeline.selectAllTracks();
	const after = controller.getSnapshot().project!.selection as unknown as Selection;
	assert.equal(after.startFrame, before.startFrame);
	assert.equal(after.endFrame, before.endFrame);
});

test('Track start to end selects real clip endpoints instead of the nearest time-grid points', async (context) => {
	const controller = await fixture();
	context.after(async () => { await controller.dispose(); });
	controller.actions.timeline.selectAll();
	controller.actions.timeline.setSnap({ enabled: true, unit: 'seconds', mode: 'nearest' });
	controller.actions.timeline.selectTrackStartToEnd();
	const selection = controller.getSnapshot().project!.selection as unknown as Selection;
	assert.equal(selection.startFrame, 0);
	assert.equal(selection.endFrame, 38_400);
});

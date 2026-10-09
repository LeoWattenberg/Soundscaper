/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('controller boundary edits retain the playhead and extend a collapsed pointer selection from its edge', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const engine = createMemoryEngine();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: engine as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', {
		amplitude: 0.4, channelCount: 1, durationSeconds: 0.8, frequency: 440,
	});
	const timeline = controller.actions.timeline;
	timeline.setZoom(120);
	timeline.setExactSelection(1_000, 2_000);
	controller.actions.transport.seek(5_000);
	timeline.adjustSelection(2_000, 2_000, {}, { snap: false });
	timeline.extendSelectionRight();
	assert.equal(controller.getSnapshot().project?.selection?.startFrame, 2_000);
	assert.equal(controller.getSnapshot().project?.selection?.endFrame, 2_400);
	assert.equal(engine.getPositionFrames(), 5_000);
	engine.state = 'playing';
	timeline.extendSelectionLeft();
	assert.equal(controller.getSnapshot().project?.selection?.startFrame, 1_600);
	assert.equal(engine.getPositionFrames(), 5_000);
	assert.equal(engine.state, 'playing');
});

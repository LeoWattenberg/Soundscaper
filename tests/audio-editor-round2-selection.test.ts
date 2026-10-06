/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('Cursor to track end uses the selected track end on either side of the cursor', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 1,
		durationSeconds: 0.8, frequency: 440 });
	const project = controller.getSnapshot().project!;
	const clip = project.clips[0]!;
	controller.actions.track.add({ name: 'Long recording' });
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 1,
		durationSeconds: 2, frequency: 220 });
	controller.actions.timeline.selectClip(clip.id);
	for (const cursor of [60_000, 10_000, 38_400]) {
		controller.actions.transport.seek(cursor);
		controller.actions.timeline.selectCursorToTrackEnd();
		const selection = controller.getSnapshot().project!.selection;
		assert.ok(selection);
		assert.equal(selection.startFrame, Math.min(cursor, 38_400));
		assert.equal(selection.endFrame, Math.max(cursor, 38_400));
	}
});

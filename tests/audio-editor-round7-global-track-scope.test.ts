/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const selectedClip of [false, true]) test(`global track scope preserves ${selectedClip ? 'clip bounds' : 'off-grid time bounds'}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const engine = createMemoryEngine();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false,
			databaseName: `round7-global-track-scope-${String(selectedClip)}` }),
		engine: engine as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const clipId = await controller.actions.generators.generate('tone', {
		amplitude: .4, channelCount: 1, durationSeconds: .8, frequency: 440,
	});
	const first = controller.getSnapshot().selectedTrackId;
	assert.ok(first);
	const second = controller.actions.track.add({ name: 'Second' });
	assert.ok(second);
	controller.actions.timeline.setSnap({ enabled: true, unit: 'seconds', mode: 'nearest' });
	if (selectedClip) controller.actions.timeline.selectClip(clipId);
	else {
		controller.actions.timeline.setExactSelection(9_600, 19_200, { trackIds: [first] });
		controller.actions.timeline.selectTrack(first);
	}
	controller.actions.transport.seek(30_000);
	const runtime = createAudacityActionRuntime(controller);
	context.after(() => runtime.dispose());
	runtime.actions.navigation.replaceSelection();
	const expectRange = () => {
		const selection = controller.getSnapshot().project?.selection;
		assert.equal(selection?.startFrame, selectedClip ? 0 : 9_600);
		assert.equal(selection?.endFrame, selectedClip ? 38_400 : 19_200);
		assert.equal(engine.getPositionFrames(), 30_000);
	};
	expectRange();
	runtime.actions.navigation.extendTrackSelectionDown();
	expectRange();
	assert.deepEqual(controller.getSnapshot().project?.selection?.trackIds, [first, second]);
	runtime.actions.navigation.toggleSelection();
	expectRange();
	assert.deepEqual(controller.getSnapshot().project?.selection?.trackIds, [first]);
	runtime.actions.navigation.rangeSelection();
	expectRange();
	assert.deepEqual(controller.getSnapshot().project?.selection?.trackIds, [first, second]);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extendTrackRowSelection } from '../src/common/editor/ui/timeline/track-row-selection-extension.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const selectedClip of [false, true]) {
	test(`extending track scope preserves ${selectedClip ? 'selected clip bounds' : 'off-grid time bounds and the playhead'}`, async (context) => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const engine = createMemoryEngine();
		const controller = createAudioEditorController(null, {
			headless: true, locale: 'en', copy: COPY,
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round7-track-range-${String(selectedClip)}` }),
			engine: engine as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		const clipId = await controller.actions.generators.generate('tone', {
			amplitude: 0.4, channelCount: 1, durationSeconds: 0.8, frequency: 440,
		});
		const firstTrackId = controller.getSnapshot().selectedTrackId;
		assert.ok(firstTrackId);
		const secondTrackId = controller.actions.track.add({ name: 'Second track' });
		assert.ok(secondTrackId);
		const timeline = controller.actions.timeline;
		if (selectedClip) timeline.selectClip(clipId);
		else timeline.setExactSelection(9_600, 19_200, { trackIds: [firstTrackId] });
		timeline.setSnap({ enabled: true, unit: 'seconds', mode: 'nearest' });
		controller.actions.transport.seek(30_000);
		const project = controller.getSnapshot().project;
		assert.ok(project);
		assert.ok(project.tracks);
		const secondIndex = project.tracks.findIndex(track => track.id === secondTrackId);
		extendTrackRowSelection({
			getSnapshot: () => {
				const current = controller.getSnapshot().project;
				assert.ok(current?.tracks);
				assert.ok(current.clips);
				return { project: { tracks: current.tracks, clips: current.clips, selection: current.selection } };
			},
			actions: { timeline: { adjustSelection: controller.actions.timeline.adjustSelection } },
		}, firstTrackId, secondIndex);
		const selection = controller.getSnapshot().project?.selection;
		assert.equal(selection?.startFrame, selectedClip ? 0 : 9_600);
		assert.equal(selection?.endFrame, selectedClip ? 38_400 : 19_200);
		assert.deepEqual(selection?.trackIds, [firstTrackId, secondTrackId]);
		assert.equal(engine.getPositionFrames(), 30_000);
	});
}

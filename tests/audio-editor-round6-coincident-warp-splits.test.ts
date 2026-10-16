/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const warped of [false, true]) test(`Labeled Split resolves ${warped ? 'warped' : 'plain'} source cuts before deduplication`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round6-coincident-split-${String(warped)}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: 1, durationSeconds: 1, frequency: 440 });
	const clipId = controller.getSnapshot().selectedClipId;
	assert.ok(clipId);
	controller.actions.timeline.selectClip(clipId);
	if (warped) {
		controller.actions.audioWarp.createIdentityMap();
		controller.actions.audioWarp.addMarker({ outer: 24_000, source: 12_000 });
	}
	controller.actions.labels.add(null, { startFrame: 23_998, endFrame: 23_998, title: 'First cut' });
	controller.actions.labels.add(null, { startFrame: 23_999, endFrame: 23_999, title: 'Second cut' });
	controller.actions.timeline.selectAll();
	const before = controller.getSnapshot();
	controller.actions.edit.labeledSplit();
	const after = controller.getSnapshot();
	const splitProject = after.project as unknown as SoundscaperProject;
	assert.equal(after.project!.clips.length, warped ? 2 : 3);
	assert.deepEqual(splitProject.clips.map(clip => [clip.timelineStartFrame, clip.durationFrames])
		.sort((left, right) => Number(left[0]) - Number(right[0])),
		warped ? [[0, 23_998], [23_998, 24_002]] : [[0, 23_998], [23_998, 1], [23_999, 24_001]]);
	assert.equal(splitProject.clips.reduce((total, clip) => total + Number(clip.sourceDurationFrames), 0), 48_000);
	assert.equal(after.history.undoEntries.length, before.history.undoEntries.length + 1);
	assert.deepEqual(after.project!.sources, before.project!.sources);
	controller.actions.edit.undo();
	assert.deepEqual(controller.getSnapshot().project!.clips, before.project!.clips);
	controller.actions.edit.redo();
	assert.deepEqual(controller.getSnapshot().project!.clips, after.project!.clips);
});

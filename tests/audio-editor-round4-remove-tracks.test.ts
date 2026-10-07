/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { prepareSelectedTrackRemoval } from '../src/common/editor/selected-track-removal.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('the public plural command removes selected audio and label tracks atomically', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'round4-remove-tracks' }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: 1, durationSeconds: 0.1, frequency: 440 });
	const audioId = controller.getSnapshot().selectedTrackId;
	assert.ok(audioId);
	controller.actions.track.add();
	const retainedId = controller.getSnapshot().selectedTrackId;
	assert.ok(retainedId);
	controller.actions.track.addLabel();
	const labelId = controller.getSnapshot().selectedTrackId;
	assert.ok(labelId);
	controller.actions.timeline.setSelection(0, 0, { trackIds: [audioId, labelId] });
	const before = structuredClone(projectRuntime.projectForCommandConsumers(controller.project));
	const undoCount = controller.getSnapshot().history.undoEntries.length;
	const runtime = createAudacityActionRuntime(controller);
	runtime.actions.track.removeSelected();
	assert.equal(projectRuntime.projectForCommandConsumers(controller.project).tracks.some(track => track.id === audioId), false);
	assert.equal(projectRuntime.projectForCommandConsumers(controller.project).tracks.some(track => track.id === labelId), false);
	assert.deepEqual(projectRuntime.projectForCommandConsumers(controller.project).tracks.map(track => track.id), [retainedId]);
	assert.equal(controller.getSnapshot().selectedTrackId, retainedId);
	assert.equal(controller.getSnapshot().history.undoEntries.length, undoCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(projectRuntime.projectForCommandConsumers(controller.project).tracks, before.tracks);
	assert.deepEqual(projectRuntime.projectForCommandConsumers(controller.project).clips, before.clips);
	controller.actions.edit.redo();
	assert.equal(projectRuntime.projectForCommandConsumers(controller.project).tracks.some(track => track.id === audioId || track.id === labelId), false);
	runtime.actions.track.removeSelected();
	assert.equal(projectRuntime.projectForCommandConsumers(controller.project).tracks.length, 0);
});

test('track removal groups linked lanes once and preserves focus fallback and explicit stale scope', () => {
	const tracks = [{ id: 'camera', laneGroupId: 'camera-lanes' }, { id: 'microphone', laneGroupId: 'camera-lanes' },
		{ id: 'narration' }, { id: 'labels' }];
	assert.deepEqual(prepareSelectedTrackRemoval({ tracks, selection: { trackIds: ['camera', 'microphone', 'labels'] } }, 'labels'),
		{ type: 'batch', commands: [{ type: 'track/remove', trackId: 'camera' }, { type: 'track/remove', trackId: 'labels' }] });
	assert.deepEqual(prepareSelectedTrackRemoval({ tracks, selection: { trackIds: [] } }, 'narration'),
		{ type: 'track/remove', trackId: 'narration' });
	assert.equal(prepareSelectedTrackRemoval({ tracks, selection: { trackIds: ['removed'] } }, 'narration'), null);
	assert.equal(prepareSelectedTrackRemoval({ tracks, selection: { trackIds: [] } }, null), null);
});

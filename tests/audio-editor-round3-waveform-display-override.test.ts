/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { findControllerTrack, type ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { resolveTrackWaveformOptions } from '../src/common/editor/track-display-mode.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('Waveform overrides the shared Spectrogram view while preserving other tracks and preferences', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'round3-waveform-override' }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const firstId = controller.actions.track.add({ name: 'First' });
	const secondId = controller.actions.track.add({ name: 'Second' });
	assert.ok(firstId); assert.ok(secondId);
	controller.actions.timeline.setAllTracksView('spectrogram');
	const before = controller.getSnapshot();
	const preferences = structuredClone(before.preferences);
	const effectiveMode = (trackId: string) => {
		const snapshot = controller.getSnapshot();
		const track = findControllerTrack(projectRuntime.projectForCommandConsumers(snapshot.project!) as ControllerProject, trackId);
		assert.ok(track); assert.equal(typeof track.displayMode, 'string');
		return resolveTrackWaveformOptions({ displayMode: String(track.displayMode) }, snapshot.timeline.view).displayMode;
	};
	assert.equal(effectiveMode(firstId), 'spectrogram');
	assert.equal(effectiveMode(secondId), 'spectrogram');
	controller.actions.track.setWaveformView(firstId);
	assert.equal(effectiveMode(firstId), 'waveform');
	assert.equal(effectiveMode(secondId), 'spectrogram');
	assert.equal(controller.getSnapshot().selectedTrackId, firstId);
	assert.deepEqual(controller.getSnapshot().preferences, preferences);
	assert.equal(controller.getSnapshot().history.undoEntries.length, before.history.undoEntries.length + 1);
	controller.actions.edit.undo();
	assert.equal(effectiveMode(firstId), 'spectrogram');
	assert.equal(effectiveMode(secondId), 'spectrogram');
	controller.actions.edit.redo();
	assert.equal(effectiveMode(firstId), 'waveform');
	assert.equal(effectiveMode(secondId), 'spectrogram');
	assert.deepEqual(controller.getSnapshot().preferences, preferences);
});

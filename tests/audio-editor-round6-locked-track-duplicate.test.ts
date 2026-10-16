/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const entry of ['track', 'selection'] as const) for (const locked of [false, true]) test(`${entry} duplicate assembles a ${locked ? 'locked' : 'writable'} recording in one history step`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round6-locked-duplicate-${entry}-${String(locked)}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: 2, durationSeconds: 0.1, frequency: 440 });
	const selected = controller.getSnapshot();
	assert.ok(selected.selectedTrackId);
	assert.ok(selected.selectedClipId);
	const trackId = selected.selectedTrackId;
	const groupId = controller.actions.mixer.addBus('group');
	const sendId = controller.actions.mixer.addBus('send');
	controller.actions.mixer.setRoute(trackId, { groupId, sends: { [String(sendId)]: 0.5 } });
	controller.actions.timeline.selectClip(selected.selectedClipId);
	if (locked) controller.actions.edit.commit({ type: 'track/update', trackId, changes: { locked: true } });
	const before = controller.getSnapshot();
	const project = before.project as unknown as SoundscaperProject;
	assert.doesNotThrow(() => {
		if (entry === 'track') controller.actions.track.duplicate(trackId);
		else controller.actions.edit.duplicate();
	});
	const after = controller.getSnapshot();
	const copiedProject = after.project as unknown as SoundscaperProject;
	assert.equal(copiedProject.clips.length, project.clips.length * 2);
	assert.equal(copiedProject.tracks.length, project.tracks.length + 1);
	assert.notEqual(after.selectedTrackId, trackId);
	const copy = copiedProject.tracks.find(track => track.id === after.selectedTrackId);
	assert.ok(copy);
	assert.equal(copy.locked, locked);
	const routes = (graph: unknown, id: string) => (graph as MixerGraphV21).edges
		.filter(edge => edge.source.kind === 'track' && edge.source.id === id)
		.map(({ kind, destination, position, level, enabled, channelMap }) => ({ kind, destination, position, level, enabled, channelMap }));
	assert.deepEqual(routes(copiedProject.mixer, copy.id), routes(project.mixer, trackId));
	assert.deepEqual(routes(copiedProject.mixer, trackId), routes(project.mixer, trackId));
	assert.deepEqual(copiedProject.tracks.find(track => track.id === trackId), project.tracks.find(track => track.id === trackId));
	assert.equal(after.history.undoEntries.length, before.history.undoEntries.length + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.getSnapshot().project!.tracks, project.tracks);
	assert.deepEqual(controller.getSnapshot().project!.clips, project.clips);
	assert.deepEqual(controller.getSnapshot().project!.mixer, project.mixer);
	controller.actions.edit.redo();
	assert.deepEqual(controller.getSnapshot().project!.tracks, after.project!.tracks);
	assert.deepEqual(controller.getSnapshot().project!.clips, after.project!.clips);
	assert.deepEqual(controller.getSnapshot().project!.mixer, after.project!.mixer);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { findControllerClip, type ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore }
	from './helpers/audio-editor-controller-harness.js';

async function setup(context: TestContext) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const fixture = createPersistedVideoProject({ timeline: true });
	const project = createSoundscaperProject({ id: fixture.project.id, title: fixture.project.title,
		sampleRate: fixture.project.sampleRate, sources: fixture.project.sources, clips: fixture.project.clips,
		tracks: fixture.project.tracks.map(track => (track.type === 'audio' ? createAudioTrack : createVideoTrack)({
			id: track.id, name: track.name, clipIds: track.clipIds, laneGroupId: track.laneGroupId })) });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `r5-camera-speed-${context.name}` });
	await store.ready(); await store.saveProject(project);
	const controller = createAudioEditorController(null, { headless: true, copy: COPY, locale: 'en',
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	controller.actions.timeline.selectClip('persisted-timeline-audio');
	return { controller, runtime, project };
}

for (const change of ['speed', 'linked pitch', 'duration'] as const) test(`linked camera ${change} refuses before any history or clip mutation`, async context => {
	const { controller } = await setup(context);
	const before = controller.getSnapshot();
	assert.throws(() => {
		if (change === 'duration') controller.actions.clip.stretch('persisted-timeline-audio', { durationFrames: 24_000 });
		else controller.actions.clip.setTimePitch('persisted-timeline-audio', change === 'speed'
			? { speedRatio: 2 } : { linkPitchAndTempo: true, pitchCents: 600 });
	}, /Unlink audio/u);
	assert.deepEqual(controller.getSnapshot().project, before.project);
	assert.deepEqual(controller.getSnapshot().history, before.history);
});

test('linked camera independent pitch and unchanged speed retain their authored presentation', async context => {
	const { controller, runtime } = await setup(context);
	const before = controller.getSnapshot();
	controller.actions.clip.setTimePitch('persisted-timeline-audio', { pitchCents: 600, speedRatio: 1 });
	const after = controller.getSnapshot();
	const projected = runtime.projectForCommandConsumers(after.project!) as ControllerProject;
	const audio = findControllerClip(projected, 'persisted-timeline-audio');
	assert.ok(audio); assert.equal(audio.pitchCents, 600); assert.equal(audio.durationFrames, 48_000);
	assert.equal(audio.avLinkId, 'persisted-av-link');
	assert.deepEqual(after.project!.clips.find(clip => clip.kind === 'video'), before.project!.clips.find(clip => clip.kind === 'video'));
	assert.equal(after.history.undoEntries.length, before.history.undoEntries.length + 1);
});

test('ordinary Unlink then Speed 2 halves audio only and one Undo restores its speed', async context => {
	const { controller, runtime } = await setup(context);
	controller.actions.video.unlink('persisted-timeline-audio');
	const before = controller.getSnapshot();
	controller.actions.clip.setTimePitch('persisted-timeline-audio', { speedRatio: 2 });
	const after = controller.getSnapshot();
	const projected = runtime.projectForCommandConsumers(after.project!) as ControllerProject;
	const audio = findControllerClip(projected, 'persisted-timeline-audio');
	assert.ok(audio); assert.equal(audio.speedRatio, 2); assert.equal(audio.durationFrames, 24_000);
	assert.equal(audio.avLinkId, null);
	assert.deepEqual(after.project!.clips.find(clip => clip.kind === 'video'), before.project!.clips.find(clip => clip.kind === 'video'));
	assert.equal(after.history.undoEntries.length, before.history.undoEntries.length + 1);
	controller.actions.edit.undo(); assert.deepEqual(controller.getSnapshot().project!.clips, before.project!.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.getSnapshot().project!.clips, after.project!.clips);
});

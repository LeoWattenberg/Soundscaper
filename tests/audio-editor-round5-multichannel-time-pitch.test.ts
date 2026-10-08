/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { CLIP_PROPERTIES_COPY_BY_LOCALE } from '../src/common/i18n/clip-properties-copy.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { findControllerClip, type ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore }
	from './helpers/audio-editor-controller-harness.js';

for (const [channels, action] of [[6, 'speed'], [32, 'speed'], [6, 'pitch'], [6, 'stretch'], [6, 'unlink']] as const) {
	test(`independent ${action} on ${String(channels)}-channel audio refuses before project/history mutation`, async context => {
		const { controller } = await fixture(context, channels, action === 'unlink');
		const before = controller.getSnapshot();
		assert.throws(() => {
			if (action === 'stretch') controller.actions.clip.stretch('clip', { durationFrames: 2400 });
			else controller.actions.clip.setTimePitch('clip', action === 'pitch' ? { pitchCents: 300 }
				: action === 'unlink' ? { linkPitchAndTempo: false } : { speedRatio: 2 });
		}, /mono or stereo.*Link pitch and tempo/u);
		assert.deepEqual(controller.getSnapshot().project, before.project);
		assert.deepEqual(controller.getSnapshot().history, before.history);
	});
}

test('a grouped stereo stretch refuses atomically when its companion needs unsupported independent processing', async context => {
	const { controller } = await fixture(context, 6, false, true);
	const before = controller.getSnapshot();
	assert.throws(() => controller.actions.clip.stretch('stereo-clip', { durationFrames: 2400 }), /mono or stereo/u);
	assert.deepEqual(controller.getSnapshot().project, before.project);
	assert.deepEqual(controller.getSnapshot().history, before.history);
});

for (const channels of [1, 2]) test(`independent speed and pitch remain available on ${String(channels)} channels`, async context => {
	const { controller, runtime } = await fixture(context, channels);
	controller.actions.clip.setTimePitch('clip', { speedRatio: 2, pitchCents: 300 });
	const clip = findControllerClip(runtime.projectForCommandConsumers(controller.getSnapshot().project!) as ControllerProject, 'clip');
	assert.ok(clip); assert.equal(clip.durationFrames, 2400);
	assert.equal(clip.pitchCents, 300); assert.equal(clip.speedRatio, 2);
});

test('linked multichannel speed uses the existing native renderer and retains atomic Undo/Redo', async context => {
	const { controller, runtime } = await fixture(context, 6);
	const before = controller.getSnapshot();
	controller.actions.clip.setTimePitch('clip', { linkPitchAndTempo: true, speedRatio: 2 });
	const completed = controller.getSnapshot();
	const clip = findControllerClip(runtime.projectForCommandConsumers(completed.project!) as ControllerProject, 'clip');
	assert.ok(clip); assert.equal(clip.durationFrames, 2400); assert.equal(clip.linkPitchAndTempo, true);
	assert.equal(completed.history.undoEntries.length, before.history.undoEntries.length + 1);
	controller.actions.edit.undo(); assert.deepEqual(controller.getSnapshot().project!.clips, before.project!.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.getSnapshot().project!.clips, completed.project!.clips);
});

test('neutral multichannel edits and Reset do not require the independent renderer', async context => {
	const { controller, runtime } = await fixture(context, 6);
	controller.actions.clip.setTimePitch('clip', { speedRatio: 1, pitchCents: 0, preserveFormants: true });
	controller.actions.clip.setTimePitch('clip', { linkPitchAndTempo: true, speedRatio: 2 });
	controller.actions.clip.resetPitchSpeed('clip');
	const clip = findControllerClip(runtime.projectForCommandConsumers(controller.getSnapshot().project!) as ControllerProject, 'clip');
	assert.ok(clip); assert.equal(clip.speedRatio, 1); assert.equal(clip.durationFrames, 4800);
});

async function fixture(context: TestContext, channels: number, linked = false, grouped = false) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording',
		frameCount: 4800, channelCount: channels, sampleRate: 48000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Recording',
		durationFrames: linked ? 2400 : 4800, sourceDurationFrames: 4800,
		speedRatio: linked ? 2 : 1, linkPitchAndTempo: linked, groupId: grouped ? 'group' : null });
	const tracks = [createAudioTrack({ id: 'track', name: 'Recording', clipIds: [clip.id] }),
		...(grouped ? [createAudioTrack({ id: 'stereo-track', name: 'Stereo', clipIds: ['stereo-clip'] })] : [])];
	const sources = [source, ...(grouped ? [createAudioSource({ id: 'stereo', storageKey: 'stereo', name: 'Stereo',
		frameCount: 4800, channelCount: 2, sampleRate: 48000 })] : [])];
	const clips = [clip, ...(grouped ? [createAudioClip({ id: 'stereo-clip', sourceId: 'stereo', title: 'Stereo',
		durationFrames: 4800, sourceDurationFrames: 4800, groupId: 'group' })] : [])];
	const project = createSoundscaperProject({ id: `r5-multichannel-${context.name}`, sources, clips, tracks });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: project.id });
	await store.ready(); await store.saveProject(project);
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: { ...COPY, ...CLIP_PROPERTIES_COPY_BY_LOCALE.en },
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	controller.actions.timeline.selectClip('clip');
	return { controller, runtime };
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { findControllerClip, findControllerSource, type ControllerProject }
	from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore }
	from './helpers/audio-editor-controller-harness.js';

for (const mode of ['whole camera', 'split camera'] as const) {
	test(`whole-track Resample preserves every ${mode} link, selected audio and one Undo`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const fixture = createPersistedVideoProject({ timeline: true });
		const project = createSoundscaperProject({ id: fixture.project.id, title: fixture.project.title,
			sampleRate: fixture.project.sampleRate, sources: fixture.project.sources, clips: fixture.project.clips,
			tracks: fixture.project.tracks.map(track => (track.type === 'audio' ? createAudioTrack : createVideoTrack)({
				id: track.id, name: track.name, clipIds: track.clipIds, laneGroupId: track.laneGroupId })) });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `r5-track-resample-${mode}` });
		await store.ready();
		const source = findControllerSource(runtime.projectForCommandConsumers(project) as ControllerProject, 'persisted-audio-source');
		assert.ok(source);
		const writer = await store.beginSourceWrite(source.storageKey, {
			name: source.name, mimeType: source.mimeType, sampleRate: source.sampleRate, channelCount: source.channelCount });
		await writer.write(Array.from({ length: source.channelCount }, () => new Float32Array(source.frameCount).fill(0.25)));
		await writer.commit();
		await store.saveProject(project);
		const controller = createAudioEditorController(null, { headless: true, copy: COPY, locale: 'en',
			projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.project.open(project);
		const audioId = 'persisted-timeline-audio';
		controller.actions.timeline.selectClip(audioId);
		if (mode === 'split camera') controller.actions.edit.splitAt(24_000);
		controller.actions.timeline.selectClip(audioId);
		const before = controller.getSnapshot();
		const original = runtime.projectForCommandConsumers(before.project!) as ControllerProject;
		await controller.actions.track.resample('persisted-audio-track', 24_000);
		const after = controller.getSnapshot();
		const changed = runtime.projectForCommandConsumers(after.project!) as ControllerProject;
		assert.equal(after.selectedClipId, audioId);
		assert.deepEqual(changed.selection, original.selection);
		assert.equal(changed.clips.length, mode === 'whole camera' ? 2 : 4);
		for (const audio of changed.clips.filter(clip => clip.kind === 'audio')) {
			assert.ok(audio.avLinkId);
			assert.equal(findControllerSource(changed, audio.sourceId)?.sampleRate, 24_000);
			const video = changed.clips.find(clip => clip.kind === 'video' && clip.avLinkId === audio.avLinkId);
			assert.ok(video);
			assert.deepEqual(video, findControllerClip(original, video.id));
			assert.equal(audio.timelineStartFrame, video.timelineStartFrame);
			assert.equal(audio.durationFrames, video.durationFrames);
		}
		assert.equal(after.history.undoEntries.length, before.history.undoEntries.length + 1);
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.clips, before.project!.clips);
		assert.deepEqual(controller.getSnapshot().project!.selection, before.project!.selection);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.clips, after.project!.clips);
		assert.deepEqual(controller.getSnapshot().project!.selection, after.project!.selection);
	});
}

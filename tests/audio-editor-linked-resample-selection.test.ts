/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { clipPropertiesSelection } from '../src/common/editor/ui/inspector/clip-properties-selection.ts';
import { findControllerClip, findControllerSource, type ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const selectionMode of ['headers', 'range', 'range-updated-during-resample'] as const) test(`resampling camera audio retains its ${selectionMode} selection and inspector target in one history entry`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const fixture = createPersistedVideoProject({ timeline: true });
	const project = createSoundscaperProject({ id: fixture.project.id, title: fixture.project.title,
		sampleRate: fixture.project.sampleRate, tracks: fixture.project.tracks.map(track => {
			const create = track.type === 'audio' ? createAudioTrack : createVideoTrack;
			return create({ id: track.id, name: track.name, clipIds: track.clipIds, laneGroupId: track.laneGroupId });
		}),
		sources: fixture.project.sources, clips: fixture.project.clips });
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `resample-selection-${selectionMode}` });
	await store.ready();
	const audioSource = findControllerSource(projectRuntime.projectForCommandConsumers(project) as ControllerProject, 'persisted-audio-source');
	assert.ok(audioSource);
	const writer = await store.beginSourceWrite(audioSource.storageKey, {
		name: audioSource.name, mimeType: audioSource.mimeType, sampleRate: audioSource.sampleRate,
		channelCount: audioSource.channelCount, chunkFrames: audioSource.chunkFrames,
	});
	await writer.write(Array.from({ length: audioSource.channelCount }, () => new Float32Array(audioSource.frameCount).fill(0.25)));
	await writer.commit();
	await store.saveProject(project);
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.open(project);
	const audioId = 'persisted-timeline-audio', videoId = 'persisted-timeline-video';
	controller.actions.timeline.selectClip(audioId);
	if (selectionMode !== 'headers') controller.actions.timeline.setSelection(100, 1000, {
		trackIds: ['persisted-audio-track', 'persisted-video-track'], clipIds: [videoId, audioId],
		frequencyRange: { minimumFrequency: 100, maximumFrequency: 1000 },
	});
	const before = controller.getSnapshot();
	const beforeProject = projectRuntime.projectForCommandConsumers(before.project!) as ControllerProject;
	const beforeAudio = findControllerClip(beforeProject, audioId)!;
	const resampling = controller.actions.clip.resample(audioId, { sampleRate: 24_000 });
	if (selectionMode === 'range-updated-during-resample') controller.actions.timeline.setSelection(300, 900, {
		trackIds: ['persisted-video-track', 'persisted-audio-track'], clipIds: [audioId, videoId],
		frequencyRange: { minimumFrequency: 300, maximumFrequency: 900 },
	});
	const liveProject = projectRuntime.projectForCommandConsumers(controller.getSnapshot().project!) as ControllerProject;
	const originalSelection = structuredClone(liveProject.selection);
	const result = await resampling;
	assert.equal(result, audioId);
	const after = controller.getSnapshot();
	const afterProject = projectRuntime.projectForCommandConsumers(after.project!) as ControllerProject;
	const audio = findControllerClip(afterProject, audioId)!;
	assert.deepEqual(afterProject.selection, originalSelection, 'replacement must retain durable clip identities and exact selection metadata');
	assert.equal(after.selectedClipId, audioId);
	assert.equal(findControllerSource(afterProject, audio.sourceId)?.sampleRate, 24_000);
	assert.notEqual(audio.sourceId, beforeAudio.sourceId);
	assert.deepEqual(findControllerClip(afterProject, videoId), findControllerClip(beforeProject, videoId));
	assert.equal(after.history.undoEntries.length, before.history.undoEntries.length + 1);
	if (selectionMode === 'headers') {
		const inspector = clipPropertiesSelection({ project: afterProject, selectedClipId: after.selectedClipId }, 'Clip');
		assert.equal(inspector.preferredClipId, audioId);
		assert.deepEqual(inspector.clips.map(({ id }) => id), [videoId, audioId]);
	}
	controller.actions.edit.undo();
	const restored = projectRuntime.projectForCommandConsumers(controller.getSnapshot().project!) as ControllerProject;
	assert.deepEqual(restored.selection, originalSelection);
	assert.equal(findControllerClip(restored, audioId)?.sourceId, beforeAudio.sourceId);
	controller.actions.edit.redo();
	const repeated = projectRuntime.projectForCommandConsumers(controller.getSnapshot().project!) as ControllerProject;
	assert.deepEqual(repeated.selection, originalSelection);
	assert.equal(findControllerClip(repeated, audioId)?.sourceId, audio.sourceId);
});

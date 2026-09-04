import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createMemoryFfmpeg,
} from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import {
	COPY,
	createAudioClip,
	createAudioEditorController,
	createCurrentAudioEditorProject,
	createMemoryEngine,
	createPersistedVideoProject,
	createVideoClip,
	resolveRuntimeProjectProjection,
	runtimeClip,
	validateCurrentAudioEditorProject,
} from './helpers/audio-editor-controller-harness.js';


test('moving a linked video clip below the timeline creates a fresh paired lane group', async () => {
	const store = createMemoryStore();
	const fixture = createPersistedVideoProject({ timeline: true });
	store.projects.set(fixture.project.id, structuredClone(fixture.project));
	store.settings.set('last-project-id', fixture.project.id);
	store.mediaAssets.set(fixture.videoSource.id, new Blob(['persisted-video'], { type: 'video/mp4' }));
	store.audioSources.set(fixture.audioSource.id, [
		new Float32Array(fixture.audioSource.frameCount),
		new Float32Array(fixture.audioSource.frameCount),
	]);
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;

	const targetTrackId = controller.actions.clip.moveToNewTrack('persisted-timeline-video', 12_000);
	const snapshot = controller.getSnapshot();
	const runtimeSnapshot = resolveRuntimeProjectProjection(snapshot.project);
	assert.deepEqual(snapshot.project.tracks.map((track) => track.type), [
		'video',
		'audio',
		'video',
		'audio',
	]);
	assert.deepEqual(snapshot.project.tracks.slice(0, 2).map((track) => track.clipIds), [[], []]);
	assert.deepEqual(snapshot.project.tracks.slice(2).map((track) => track.clipIds), [
		['persisted-timeline-video'],
		['persisted-timeline-audio'],
	]);
	assert.equal(targetTrackId, snapshot.project.tracks[2].id);
	assert.equal(snapshot.selectedTrackId, targetTrackId);
	assert.notEqual(snapshot.project.tracks[2].laneGroupId, 'persisted-lane-group');
	assert.equal(snapshot.project.tracks[2].laneGroupId, snapshot.project.tracks[3].laneGroupId);
	assert.deepEqual(
		runtimeSnapshot.clips.map((clip) => [clip.kind, clip.timelineStartFrame, clip.avLinkId]),
		[
			['video', 12_800, 'persisted-av-link'],
			['audio', 12_800, 'persisted-av-link'],
		],
	);
	await controller.dispose();
});

test('linked video moves create crossfades with aligned audio and reject a third overlap atomically', async () => {
	const store = createMemoryStore();
	const fixture = createPersistedVideoProject({ timeline: true });
	const projectInput = structuredClone(fixture.project);
	for (const [suffix, timelineStartFrame] of [['second', 48_000], ['third', 96_000]]) {
		const avLinkId = `${suffix}-av-link`;
		const videoClip = createVideoClip({
			id: `${suffix}-timeline-video`,
			sourceId: fixture.videoSource.id,
			title: `${suffix} video`,
			timelineStartFrame,
			sourceStartFrame: 0,
			sourceDurationFrames: 48_000,
			durationFrames: 48_000,
			avLinkId,
		}, { projectSampleRate: projectInput.sampleRate, sequence: projectInput.sequences[0], source: fixture.videoSource });
		const audioClip = createAudioClip({
			id: `${suffix}-timeline-audio`,
			sourceId: fixture.audioSource.id,
			title: `${suffix} audio`,
			timelineStartFrame,
			sourceStartFrame: 0,
			sourceDurationFrames: 48_000,
			durationFrames: 48_000,
			avLinkId,
		});
		projectInput.clips.push(videoClip, audioClip);
		projectInput.tracks[0].clipIds.push(videoClip.id);
		projectInput.tracks[1].clipIds.push(audioClip.id);
	}
	const project = createCurrentAudioEditorProject(projectInput);
	store.projects.set(project.id, project);
	store.settings.set('last-project-id', project.id);
	store.mediaAssets.set(fixture.videoSource.id, new Blob(['persisted-video'], { type: 'video/mp4' }));
	store.audioSources.set(fixture.audioSource.id, [
		new Float32Array(fixture.audioSource.frameCount),
		new Float32Array(fixture.audioSource.frameCount),
	]);
	let controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;

	controller.actions.clip.move('persisted-timeline-video', 'persisted-video-track', 24_000);
	let snapshot = controller.getSnapshot();
	assert.equal(runtimeClip(snapshot.project, 'persisted-timeline-video').timelineStartFrame, 24_000);
	assert.equal(runtimeClip(snapshot.project, 'persisted-timeline-audio').timelineStartFrame, 24_000);

	controller.actions.edit.undo();
	snapshot = controller.getSnapshot();
	assert.equal(runtimeClip(snapshot.project, 'persisted-timeline-video').timelineStartFrame, 0);
	assert.equal(runtimeClip(snapshot.project, 'persisted-timeline-audio').timelineStartFrame, 0);
	controller.actions.edit.redo();
	assert.equal(
		runtimeClip(controller.getSnapshot().project, 'persisted-timeline-video').timelineStartFrame,
		24_000,
	);

	await controller.actions.project.flush();
	await controller.dispose();
	controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	assert.equal(
		runtimeClip(controller.getSnapshot().project, 'persisted-timeline-video').timelineStartFrame,
		24_000,
	);

	const beforeInvalidMove = controller.getSnapshot().project;
	assert.throws(() => (
		controller.actions.clip.move('third-timeline-video', 'persisted-video-track', 60_000)
	));
	assert.strictEqual(controller.getSnapshot().project, beforeInvalidMove);
	assert.equal(
		runtimeClip(controller.getSnapshot().project, 'third-timeline-audio').timelineStartFrame,
		96_000,
	);
	await controller.dispose();
});

test('track move actions reorder paired video and audio lanes as one layer block', async () => {
	const store = createMemoryStore();
	const fixture = createPersistedVideoProject({ timeline: true });
	const projectInput = structuredClone(fixture.project);
	projectInput.tracks.push({
		type: 'video',
		id: 'background-video-track',
		name: 'Background video',
		clipIds: [],
		mute: false,
		hidden: false,
		collapsed: false,
		height: 96,
		laneGroupId: 'background-lane-group',
		opaqueExtensions: {},
	}, {
		type: 'audio',
		id: 'background-audio-track',
		name: 'Background audio',
		clipIds: [],
		mute: false,
		solo: false,
		armed: false,
		gain: 1,
		pan: 0,
		channelCount: 2,
		color: 'auto',
		effects: [],
		laneGroupId: 'background-lane-group',
		opaqueExtensions: {},
	});
	projectInput.sequences[0].trackIds.push('background-video-track', 'background-audio-track'); projectInput.sequences[0].trackNodes.push({ kind: 'track', id: 'background-video-track', parentFolderId: null }, { kind: 'track', id: 'background-audio-track', parentFolderId: null });
	const project = createCurrentAudioEditorProject(projectInput);
	validateCurrentAudioEditorProject(project);
	store.projects.set(project.id, project);
	store.settings.set('last-project-id', project.id);
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;

	controller.actions.track.moveDown('persisted-video-track');
	assert.deepEqual(controller.getSnapshot().project.tracks.map((track) => track.id), [
		'background-video-track',
		'background-audio-track',
		'persisted-video-track',
		'persisted-audio-track',
	]);

	controller.actions.track.moveUp('persisted-audio-track');
	assert.deepEqual(controller.getSnapshot().project.tracks.map((track) => track.id), [
		'persisted-video-track',
		'persisted-audio-track',
		'background-video-track',
		'background-audio-track',
	]);
	await controller.dispose();
});

test('cross-project video paste creates one adjacent paired lane group with fresh relationships', async () => {
	const store = createMemoryStore();
	const fixture = createPersistedVideoProject({ timeline: true });
	store.projects.set(fixture.project.id, structuredClone(fixture.project));
	store.settings.set('last-project-id', fixture.project.id);
	store.mediaAssets.set(fixture.videoSource.id, new Blob(['persisted-video'], { type: 'video/mp4' }));
	store.audioSources.set(fixture.audioSource.id, [
		new Float32Array(fixture.audioSource.frameCount),
		new Float32Array(fixture.audioSource.frameCount),
	]);
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	try {
		await controller.ready;
		controller.actions.timeline.selectClip('persisted-timeline-video');
		controller.actions.edit.copy();
		assert.equal(controller.getSnapshot().history.hasClipboard, true);

		await controller.actions.project.create({ title: 'Video paste target' });
		controller.actions.edit.paste();
		const snapshot = controller.getSnapshot();
		const mediaTracks = snapshot.project.tracks.filter((track) => track.laneGroupId);
		assert.deepEqual(mediaTracks.map((track) => track.type), ['video', 'audio']);
		assert.equal(mediaTracks[0].laneGroupId, mediaTracks[1].laneGroupId);
		assert.notEqual(mediaTracks[0].laneGroupId, 'persisted-lane-group');
		assert.equal(snapshot.project.tracks.indexOf(mediaTracks[1]), snapshot.project.tracks.indexOf(mediaTracks[0]) + 1);

		const runtimeProject = resolveRuntimeProjectProjection(snapshot.project);
		const videoClip = runtimeProject.clips.find((clip) => clip.kind === 'video');
		const audioClip = runtimeProject.clips.find((clip) => clip.avLinkId === videoClip?.avLinkId && clip.kind === 'audio');
		assert.ok(videoClip);
		assert.ok(audioClip);
		assert.notEqual(videoClip.avLinkId, 'persisted-av-link');
		assert.equal(videoClip.timelineStartFrame, audioClip.timelineStartFrame);
		assert.equal(videoClip.durationFrames, audioClip.durationFrames);
		assert.ok(snapshot.project.sources.some((source) => source.id === fixture.videoSource.id && source.kind === 'video'));
		assert.ok(snapshot.project.sources.some((source) => source.id === fixture.audioSource.id && source.kind === 'audio'));
	} finally {
		await controller.dispose();
	}
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createMemoryFfmpeg,
	storedSample,
} from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import {
	COPY,
	createAudioEditorController,
	createMemoryEngine,
	createProjectStore,
} from './helpers/audio-editor-controller-harness.js';


test('controller commits built-in generated audio as one selected undoable clip', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `controller-generator-${Date.now()}-${Math.random()}`,
	});
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
		const clipId = await controller.actions.generators.generate('tone', {
			amplitude: 0.4,
			channelCount: 1,
			durationSeconds: 0.25,
			frequency: 880,
		});
		let snapshot = controller.getSnapshot();
		const clip = snapshot.project.clips.find((candidate) => candidate.id === clipId);
		const source = snapshot.project.sources.find((candidate) => candidate.id === clip?.sourceId);
		assert.equal(snapshot.selectedClipId, clipId);
		assert.equal(clip.durationFrames, 12_000);
		assert.equal(source.name, 'Tone');
		assert.equal(source.channelCount, 1);
		assert.ok(Math.abs(await storedSample(store, source.id, 100)) > 0.01);

		controller.actions.edit.undo();
		snapshot = controller.getSnapshot();
		assert.equal(snapshot.project.clips.some((candidate) => candidate.id === clipId), false);
		controller.actions.edit.redo();
		assert.equal(controller.getSnapshot().project.clips.some((candidate) => candidate.id === clipId), true);
	} finally {
		await controller.dispose();
	}
});

test('controller splits selected and grouped clips at both selection boundaries in one undo step', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	const firstTrackId = controller.getSnapshot().project.tracks[0].id;
	const secondTrackId = controller.actions.track.add({ name: 'Split companions' });
	controller.actions.edit.commit({
		type: 'batch',
		commands: [
			{ type: 'source/add', source: {
				id: 'split-source', storageKey: 'split-source', name: 'split.wav', mimeType: 'audio/wav',
				frameCount: 4_000, channelCount: 1,
			} },
			{ type: 'clip/add', trackId: firstTrackId, clip: {
				id: 'split-selected', sourceId: 'split-source', timelineStartFrame: 0,
				sourceStartFrame: 0, durationFrames: 1_000,
			} },
			{ type: 'clip/add', trackId: secondTrackId, clip: {
				id: 'split-grouped', sourceId: 'split-source', timelineStartFrame: 0,
				sourceStartFrame: 1_000, durationFrames: 1_000,
			} },
			{ type: 'clip/add', trackId: secondTrackId, clip: {
				id: 'split-also-selected', sourceId: 'split-source', timelineStartFrame: 0,
				sourceStartFrame: 2_000, durationFrames: 1_000,
			} },
			{ type: 'clip/group', clipIds: ['split-selected', 'split-grouped'], groupId: 'split-group' },
		],
	});
	controller.actions.timeline.setSelection(200, 800, {
		trackIds: [firstTrackId, secondTrackId],
	});

	controller.actions.edit.split();
	let project = controller.getSnapshot().project;
	assert.equal(project.clips.length, 9);
	assert.deepEqual(
		project.tracks.find((track) => track.id === firstTrackId).clipIds
			.map((clipId) => project.clips.find((clip) => clip.id === clipId).durationFrames),
		[200, 600, 200],
	);
	assert.deepEqual(
		project.tracks.find((track) => track.id === secondTrackId).clipIds
			.map((clipId) => project.clips.find((clip) => clip.id === clipId).durationFrames),
		[200, 200, 600, 600, 200, 200],
	);
	assert.equal(project.clips.filter((clip) => clip.groupId === 'split-group').length, 6);

	controller.actions.edit.undo();
	project = controller.getSnapshot().project;
	assert.equal(project.clips.length, 3);
	assert.ok(project.clips.some((clip) => clip.id === 'split-selected' && clip.durationFrames === 1_000));

	controller.actions.timeline.setSelection(233, 777, {
		trackIds: [firstTrackId, secondTrackId],
	});
	controller.actions.timeline.setSnap({ enabled: true, unit: 'seconds', mode: 'nearest' });
	controller.actions.edit.split();
	project = controller.getSnapshot().project;
	assert.deepEqual(
		project.tracks.find((track) => track.id === firstTrackId).clipIds
			.map((clipId) => project.clips.find((clip) => clip.id === clipId).durationFrames),
		[233, 544, 223],
	);
	controller.actions.edit.undo();
	controller.actions.timeline.setSnap({ enabled: false, unit: 'seconds', mode: 'nearest' });

	controller.actions.timeline.selectClip('split-selected');
	controller.engine.positionFrame = 500;
	controller.actions.edit.split();
	project = controller.getSnapshot().project;
	assert.equal(project.tracks.find((track) => track.id === firstTrackId).clipIds.length, 2);
	assert.equal(project.tracks.find((track) => track.id === secondTrackId).clipIds.length, 3);
	controller.actions.edit.undo();

	controller.actions.edit.splitAt(500, [firstTrackId]);
	project = controller.getSnapshot().project;
	assert.equal(project.tracks.find((track) => track.id === firstTrackId).clipIds.length, 2);
	assert.equal(project.tracks.find((track) => track.id === secondTrackId).clipIds.length, 2);
	await controller.dispose();
});

test('controller moves a selected clip set into newly created tracks in one undo step', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	const firstTrackId = controller.getSnapshot().project.tracks[0].id;
	const secondTrackId = controller.actions.track.add({ name: 'Second' });
	controller.actions.edit.commit({
		type: 'batch',
		commands: [{
			type: 'source/add',
			source: {
				id: 'new-track-source', storageKey: 'new-track-source', name: 'move.wav', mimeType: 'audio/wav',
				frameCount: 4_000, channelCount: 1,
			},
		}, {
			type: 'clip/add',
			trackId: firstTrackId,
			clip: {
				id: 'new-track-active', sourceId: 'new-track-source', timelineStartFrame: 100,
				sourceStartFrame: 0, durationFrames: 1_000,
			},
		}, {
			type: 'clip/add',
			trackId: secondTrackId,
			clip: {
				id: 'new-track-companion', sourceId: 'new-track-source', timelineStartFrame: 200,
				sourceStartFrame: 1_000, durationFrames: 1_000,
			},
		}],
	});
	controller.actions.timeline.setSelection(100, 500);
	controller.actions.timeline.selectClip('new-track-active');
	controller.actions.timeline.selectClip('new-track-companion', { additive: true });
	const historyBefore = controller.getSnapshot().history.undoEntries.length;
	const activeDestinationId = controller.actions.clip.moveToNewTrack('new-track-active', 250);

	let snapshot = controller.getSnapshot();
	const audioTracks = snapshot.project.tracks.filter((track) => track.type === 'audio');
	assert.equal(audioTracks.length, 4);
	assert.equal(audioTracks[2].id, activeDestinationId);
	assert.deepEqual(audioTracks.map((track) => track.clipIds), [
		[],
		[],
		['new-track-active'],
		['new-track-companion'],
	]);
	assert.deepEqual(snapshot.project.clips.map(({ id, timelineStartFrame }) => ({ id, timelineStartFrame })), [
		{ id: 'new-track-active', timelineStartFrame: 250 },
		{ id: 'new-track-companion', timelineStartFrame: 350 },
	]);
	assert.equal(snapshot.project.tracks.find((track) => track.id === activeDestinationId)?.clipIds.at(0), 'new-track-active');
	const expectedTrackIds = audioTracks
		.filter((track) => track.clipIds.includes('new-track-active') || track.clipIds.includes('new-track-companion'))
		.map((track) => track.id)
		.sort();
	assert.deepEqual([...new Set(snapshot.project.selection.trackIds)].sort(), expectedTrackIds);
	assert.equal(snapshot.history.undoEntries.length, historyBefore + 1);

	controller.actions.edit.undo();
	snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.tracks.filter((track) => track.type === 'audio').length, 2);
	assert.deepEqual(snapshot.project.clips.map(({ id, timelineStartFrame }) => ({ id, timelineStartFrame })), [
		{ id: 'new-track-active', timelineStartFrame: 100 },
		{ id: 'new-track-companion', timelineStartFrame: 200 },
	]);
	await controller.dispose();
});

test('controller trims forward, reversed, and stretched clips without changing playback rate', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project.tracks[0].id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [{
			type: 'source/add',
			source: {
				id: 'trim-source', name: 'trim.wav', storageKey: 'trim-source', mimeType: 'audio/wav',
				frameCount: 1_000, channelCount: 1,
			},
		}, {
			type: 'clip/add',
			trackId,
			clip: {
				id: 'trim-forward', sourceId: 'trim-source', timelineStartFrame: 0,
				sourceStartFrame: 100, sourceDurationFrames: 400, durationFrames: 200, speedRatio: 2,
			},
		}, {
			type: 'clip/add',
			trackId,
			clip: {
				id: 'trim-reversed', sourceId: 'trim-source', timelineStartFrame: 300,
				sourceStartFrame: 200, sourceDurationFrames: 400, durationFrames: 200, speedRatio: 2, reversed: true,
			},
		}],
	});

	controller.actions.timeline.selectClip('trim-forward');
	controller.actions.clip.trim('trim-forward', { sourceStartFrame: 120 });
	let clip = controller.getSnapshot().project.clips.find((candidate) => candidate.id === 'trim-forward');
	assert.deepEqual({
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
		durationFrames: clip.durationFrames,
		speedRatio: clip.speedRatio,
	}, { sourceStartFrame: 120, sourceDurationFrames: 400, durationFrames: 200, speedRatio: 2 });
	controller.actions.edit.undo();
	controller.actions.clip.trim('trim-forward', { durationFrames: 150 });
	clip = controller.getSnapshot().project.clips.find((candidate) => candidate.id === 'trim-forward');
	assert.deepEqual({
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
		durationFrames: clip.durationFrames,
		trimEndFrames: clip.trimEndFrames,
	}, { sourceStartFrame: 100, sourceDurationFrames: 300, durationFrames: 150, trimEndFrames: 100 });
	assert.equal(clip.sourceDurationFrames / clip.durationFrames, 2);
	controller.actions.edit.undo();
	controller.actions.clip.trim('trim-forward', { timelineStartFrame: 50, durationFrames: 150 });
	clip = controller.getSnapshot().project.clips.find((candidate) => candidate.id === 'trim-forward');
	assert.deepEqual({
		timelineStartFrame: clip.timelineStartFrame,
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
		trimStartFrames: clip.trimStartFrames,
	}, { timelineStartFrame: 50, sourceStartFrame: 200, sourceDurationFrames: 300, trimStartFrames: 100 });

	controller.actions.timeline.selectClip('trim-reversed');
	controller.actions.clip.trim('trim-reversed', { durationFrames: 150 });
	clip = controller.getSnapshot().project.clips.find((candidate) => candidate.id === 'trim-reversed');
	assert.deepEqual({
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
		trimStartFrames: clip.trimStartFrames,
	}, { sourceStartFrame: 300, sourceDurationFrames: 300, trimStartFrames: 100 });
	controller.actions.edit.undo();
	controller.actions.clip.trim('trim-reversed', { timelineStartFrame: 350, durationFrames: 150 });
	clip = controller.getSnapshot().project.clips.find((candidate) => candidate.id === 'trim-reversed');
	assert.deepEqual({
		timelineStartFrame: clip.timelineStartFrame,
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
		trimEndFrames: clip.trimEndFrames,
	}, { timelineStartFrame: 350, sourceStartFrame: 200, sourceDurationFrames: 300, trimEndFrames: 100 });
	await controller.dispose();
});

test('cut and delete accept clip selections without a time range', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `controller-clip-selection-${Date.now()}-${Math.random()}`,
	});
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project.tracks[0].id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [
			{ type: 'source/add', source: {
				id: 'clip-edit-source', storageKey: 'clip-edit-source', name: 'edit.wav',
				mimeType: 'audio/wav', frameCount: 4_000, channelCount: 1,
			} },
			{ type: 'clip/add', trackId, clip: {
				id: 'clip-edit-target', sourceId: 'clip-edit-source', timelineStartFrame: 500,
				sourceStartFrame: 500, durationFrames: 500,
			} },
			{ type: 'clip/add', trackId, clip: {
				id: 'clip-edit-gap', sourceId: 'clip-edit-source', timelineStartFrame: 1_500,
				sourceStartFrame: 1_500, durationFrames: 500,
			} },
			{ type: 'clip/add', trackId, clip: {
				id: 'clip-edit-companion', sourceId: 'clip-edit-source', timelineStartFrame: 2_500,
				sourceStartFrame: 2_500, durationFrames: 500,
			} },
			{ type: 'clip/group', clipIds: ['clip-edit-target', 'clip-edit-companion'], groupId: 'clip-edit-group' },
		],
	});

	controller.actions.timeline.selectClip('clip-edit-target');
	controller.actions.edit.cutLeaveGap();
	assert.equal(controller.getSnapshot().project.clips.some((clip) => clip.id === 'clip-edit-target'), false);
	assert.deepEqual(controller.getSnapshot().project.clips.map((clip) => clip.id), ['clip-edit-gap']);
	assert.equal(controller.getSnapshot().history.hasClipboard, true);
	controller.actions.edit.undo();
	controller.actions.timeline.selectClip('clip-edit-target');
	controller.actions.edit.deleteLeaveGap();
	assert.equal(controller.getSnapshot().project.clips.some((clip) => clip.id === 'clip-edit-target'), false);
	assert.deepEqual(controller.getSnapshot().project.clips.map((clip) => clip.id), ['clip-edit-gap']);
	controller.actions.edit.undo();
	controller.actions.timeline.selectClip('clip-edit-target');
	controller.actions.edit.deleteAllTracksRipple();
	let remaining = controller.getSnapshot().project.clips;
	assert.deepEqual(remaining.map((clip) => clip.id), ['clip-edit-gap']);
	assert.equal(remaining[0].timelineStartFrame, 1_000);
	controller.actions.edit.undo();
	controller.actions.timeline.selectClip('clip-edit-target');
	controller.actions.edit.cutAllTracksRipple();
	remaining = controller.getSnapshot().project.clips;
	assert.deepEqual(remaining.map((clip) => clip.id), ['clip-edit-gap']);
	assert.equal(remaining[0].timelineStartFrame, 1_000);
	assert.equal(controller.getSnapshot().history.hasClipboard, true);
	controller.actions.edit.undo();
	controller.actions.timeline.selectClip('clip-edit-target');
	const originalSources = new Map(controller.getSnapshot().project.clips.map((clip) => [clip.id, clip.sourceId]));
	await controller.actions.edit.silenceSelection();
	const silenced = new Map(controller.getSnapshot().project.clips.map((clip) => [clip.id, clip]));
	assert.notEqual(silenced.get('clip-edit-target').sourceId, originalSources.get('clip-edit-target'));
	assert.notEqual(silenced.get('clip-edit-companion').sourceId, originalSources.get('clip-edit-companion'));
	assert.equal(silenced.get('clip-edit-gap').sourceId, originalSources.get('clip-edit-gap'));
	assert.deepEqual(
		new Set(controller.getSnapshot().project.selection.clipIds),
		new Set(['clip-edit-target', 'clip-edit-companion']),
	);
	controller.actions.edit.undo();
	controller.actions.timeline.selectClip('clip-edit-target');
	controller.actions.edit.duplicate();
	const duplicateSelection = controller.getSnapshot().project.selection.clipIds;
	assert.equal(duplicateSelection.length, 2);
	assert.equal(duplicateSelection.includes('clip-edit-target'), false);
	assert.equal(duplicateSelection.includes('clip-edit-companion'), false);
	assert.equal(controller.getSnapshot().project.clips.length, 5);
	await controller.dispose();
});

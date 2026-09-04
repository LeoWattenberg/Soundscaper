import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createMemoryFfmpeg,
	storedChannelSample,
	storedSample,
} from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import {
	COPY,
	audioBuffer,
	createAudioEditorController,
	createCurrentAudioEditorProject,
	createMemoryEngine,
	createProjectStore,
} from './helpers/audio-editor-controller-harness.js';


test('controller gates sample tools by zoom and commits pencil and smoothing as undoable immutable sources', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `controller-sample-edit-${Date.now()}-${Math.random()}`,
	});
	const sourceId = 'controller-sample-source';
	const input = new Float32Array(65_540);
	input[100] = 1;
	const writer = await store.beginSourceWrite(sourceId, {
		name: 'samples.wav',
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 65_536,
	});
	await writer.write([input.subarray(0, 65_536)]);
	await writer.write([input.subarray(65_536)]);
	await writer.commit({ chunkFrames: 65_536 });
	const project = createCurrentAudioEditorProject({
		id: 'controller-sample-project',
		title: 'Sample project',
		now: '2026-07-13T00:00:00.000Z',
		sources: [{
			id: sourceId,
			name: 'samples.wav',
			mimeType: 'audio/wav',
			storageKey: sourceId,
			frameCount: input.length,
			channelCount: 1,
			sampleRate: 48_000,
			originalSampleRate: 48_000,
			sampleFormat: 'float32',
			chunkFrames: 65_536,
		}],
		tracks: [{ type: 'audio', id: 'controller-sample-track', name: 'Samples', clipIds: ['controller-sample-clip'] }],
		clips: [{
			id: 'controller-sample-clip',
			sourceId,
			title: 'Samples',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: input.length,
			durationFrames: input.length,
		}],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	controller.actions.timeline.selectClip('controller-sample-clip');
	assert.equal(controller.getSnapshot().sampleEdit.available, false);
	assert.throws(() => controller.actions.sampleEdit.setMode('pencil'), /individual samples/);
	// One pixel per sample only joins samples with a line; the pencil waits for
	// the zoom where the renderer draws each sample as its own stem.
	controller.actions.timeline.setZoom(48_000);
	assert.equal(controller.getSnapshot().sampleEdit.available, false);
	controller.actions.timeline.setZoom(192_000);
	assert.equal(controller.getSnapshot().sampleEdit.available, true);
	assert.equal(controller.getSnapshot().sampleEdit.mode, 'pencil');
	controller.actions.sampleEdit.setMode(null);
	assert.equal(controller.getSnapshot().sampleEdit.mode, null);
	controller.actions.timeline.setZoom(100);
	assert.equal(controller.getSnapshot().sampleEdit.available, false);
	controller.actions.timeline.setZoom(192_000);
	assert.equal(controller.getSnapshot().sampleEdit.mode, 'pencil');
	controller.actions.track.setSpectrogramView('controller-sample-track');
	assert.equal(controller.getSnapshot().sampleEdit.available, false);
	assert.equal(controller.getSnapshot().sampleEdit.mode, null);
	controller.actions.track.setWaveformView('controller-sample-track');
	assert.equal(controller.getSnapshot().sampleEdit.available, true);
	assert.equal(controller.getSnapshot().sampleEdit.mode, 'pencil');

	const pencil = await controller.actions.sampleEdit.pencil({
		clipId: 'controller-sample-clip',
		channel: 0,
		points: [{ timelineFrame: 100, value: 0.75 }],
	});
	let snapshot = controller.getSnapshot();
	let editedSourceId = snapshot.project.clips.find((clip) => clip.id === 'controller-sample-clip').sourceId;
	assert.notEqual(editedSourceId, sourceId);
	assert.equal(pencil.metadata.storage, 'copy-on-write');
	assert.equal((await store.getSourceMetadata(editedSourceId)).baseSourceId, sourceId);
	assert.equal(await storedSample(store, editedSourceId, 100), 0.75);
	assert.equal(await storedSample(store, sourceId, 100), 1);
	assert.equal(snapshot.status.message, 'Edited samples.');

	controller.actions.edit.undo();
	snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.clips.find((clip) => clip.id === 'controller-sample-clip').sourceId, sourceId);
	controller.actions.timeline.setSelection(99, 102);
	const smoothed = await controller.actions.sampleEdit.smooth({ clipId: 'controller-sample-clip', radius: 2 });
	snapshot = controller.getSnapshot();
	editedSourceId = snapshot.project.clips.find((clip) => clip.id === 'controller-sample-clip').sourceId;
	assert.equal(smoothed.metadata.storage, 'copy-on-write');
	assert.ok(await storedSample(store, editedSourceId, 100) > 0);
	assert.ok(await storedSample(store, editedSourceId, 100) < 1);
	assert.equal(await storedSample(store, sourceId, 100), 1);
	await controller.dispose();
});

test('controller imports and exports label formats and applies the project snap grid', async () => {
	let savedLabelFile = null;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		saveLabelFile: async (result) => { savedLabelFile = result; },
	});
	await controller.ready;

	const labelText = [
		'WEBVTT',
		'',
		'intro',
		'00:00.250 --> 00:00.500',
		'Äöü',
		'',
		'00:01.000 --> 00:02.000',
		'Range',
		'',
	].join('\n');
	const bytes = new TextEncoder().encode(labelText);
	const imported = await controller.actions.labels.importFile({
		name: 'Kapitel.vtt',
		async arrayBuffer() { return bytes.buffer; },
	});
	assert.equal(imported.format, 'vtt');
	assert.equal(imported.labels.length, 2);
	const labelTrack = controller.getSnapshot().project.tracks.find((track) => track.type === 'label');
	assert.equal(labelTrack.id, imported.trackId);
	assert.equal(labelTrack.name, 'Kapitel');
	assert.deepEqual(labelTrack.labels.map(({ title, startFrame, endFrame }) => ({ title, startFrame, endFrame })), [
		{ title: 'Äöü', startFrame: 12_000, endFrame: 24_000 },
		{ title: 'Range', startFrame: 48_000, endFrame: 96_000 },
	]);

	controller.actions.timeline.setSnap({ enabled: true, unit: '1/4', mode: 'nearest' });
	assert.deepEqual(controller.getSnapshot().project.snap, {
		enabled: true,
		unit: '1/4',
		division: '1/4',
		mode: 'nearest',
		triplets: false,
		opaqueType: 2,
	});
	assert.equal(controller.actions.timeline.snapFrame(13_000), 24_000);
	controller.actions.timeline.setSelection(10_000, 40_000);
	assert.deepEqual(controller.getSnapshot().selection, { startFrame: 0, endFrame: 48_000, annotationIds: [] });
	const snappedLabelId = controller.actions.labels.add(labelTrack.id, { title: 'Snapped', startFrame: 25_000 });
	assert.equal(controller.getSnapshot().project.tracks.find((track) => track.id === labelTrack.id)
		.labels.find((label) => label.id === snappedLabelId).startFrame, 24_000);

	const exported = await controller.actions.labels.export({ format: 'srt' });
	assert.equal(exported.fileName, 'Untitled project.srt');
	assert.equal(exported.labelCount, 3);
	assert.match(exported.text, /00:00:00,250 --> 00:00:00,500/);
	assert.equal(savedLabelFile.fileName, exported.fileName);
	assert.equal(savedLabelFile.blob.type, 'application/x-subrip;charset=utf-8');
	assert.equal(await savedLabelFile.blob.text(), exported.text);

	await controller.dispose();
});

test('V2 controller exposes model-backed track creation, ordering, display, and collapse actions', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	const initialTrackId = controller.getSnapshot().project.tracks[0].id;
	const monoId = controller.actions.track.addMono({ name: 'Mono' });
	const stereoId = controller.actions.track.addStereo({ name: 'Stereo' });
	let snapshot = controller.getSnapshot();
	assert.equal(Object.hasOwn(snapshot.project.tracks.find((track) => track.id === monoId), 'channelCount'), false);
	assert.equal(Object.hasOwn(snapshot.project.tracks.find((track) => track.id === monoId), 'channelLayout'), false);
	assert.equal(Object.hasOwn(snapshot.project.tracks.find((track) => track.id === stereoId), 'channelCount'), false);
	assert.equal(Object.hasOwn(snapshot.project.tracks.find((track) => track.id === stereoId), 'channelLayout'), false);

	controller.actions.track.moveTop(stereoId);
	controller.actions.track.moveDown(stereoId);
	controller.actions.track.moveBottom(initialTrackId);
	assert.deepEqual(controller.getSnapshot().project.tracks.map((track) => track.id), [stereoId, monoId, initialTrackId]);
	controller.actions.track.setSpectrogramView(stereoId);
	snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.tracks.find((track) => track.id === stereoId).displayMode, 'spectrogram');
	assert.equal(snapshot.timeline.view, 'spectrogram');
	controller.actions.track.setMultiView(stereoId);
	assert.equal(controller.getSnapshot().project.tracks.find((track) => track.id === stereoId).displayMode, 'multiview');
	const initialHeights = controller.getSnapshot().project.tracks.map((track) => track.height);
	controller.actions.track.decreaseAllHeights();
	assert.deepEqual(controller.getSnapshot().project.tracks.map((track) => track.height), initialHeights.map((height) => height - 16));
	controller.actions.track.increaseAllHeights();
	assert.deepEqual(controller.getSnapshot().project.tracks.map((track) => track.height), initialHeights);
	controller.actions.track.decreaseHeight(stereoId);
	assert.equal(controller.getSnapshot().project.tracks.find((track) => track.id === stereoId).height, initialHeights[0] - 16);
	await controller.dispose();
});

test('controller rewrites stereo channels with immutable sources and round-trips split/make stereo', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `controller-channel-ops-${Date.now()}-${Math.random()}`,
	});
	const sourceId = 'controller-stereo-source';
	const left = new Float32Array(64).fill(0.25);
	const right = new Float32Array(64).fill(-0.75);
	const writer = await store.beginSourceWrite(sourceId, {
		name: 'stereo.wav', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 2,
	});
	await writer.write([left, right]);
	await writer.commit({ sampleRate: 48_000, channelCount: 2 });
	const project = createCurrentAudioEditorProject({
		id: 'controller-channel-project',
		title: 'Channel project',
		now: '2026-07-13T00:00:00.000Z',
		sources: [{
			id: sourceId,
			name: 'stereo.wav',
			mimeType: 'audio/wav',
			storageKey: sourceId,
			frameCount: 64,
			channelCount: 2,
			sampleRate: 48_000,
			originalSampleRate: 48_000,
			sampleFormat: 'float32',
			chunkFrames: 65_536,
		}],
		tracks: [{ type: 'audio', id: 'controller-stereo-track', name: 'Stereo', clipIds: ['controller-stereo-clip'] }],
		clips: [{
			id: 'controller-stereo-clip',
			sourceId,
			title: 'Stereo',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: 64,
			durationFrames: 64,
		}],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const renderSnapshot = async (snapshot, range, sourceMap) => {
		const track = snapshot.tracks.find((candidate) => candidate.type !== 'label');
		const clip = snapshot.clips.find((candidate) => track?.clipIds.includes(candidate.id));
		const buffer = sourceMap.get(clip?.sourceId);
		if (!track || !clip || !buffer) throw new Error('Channel fixture audio is unavailable.');
		const length = Math.max(1, Number(range.outputFrames) || Number(range.endFrame) - Number(range.startFrame));
		const offset = Math.max(0, Number(range.startFrame) - clip.timelineStartFrame + clip.sourceStartFrame);
		const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => (
			buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)).slice(offset, offset + length)
		));
		return audioBuffer(channels, snapshot.sampleRate);
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		renderSnapshot,
	});
	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('controller-stereo-track');
		await controller.actions.track.swapChannels();
		let snapshot = controller.getSnapshot();
		let clip = snapshot.project.clips.find((candidate) => candidate.id === 'controller-stereo-clip');
		assert.notEqual(clip.sourceId, sourceId);
		assert.equal(await storedChannelSample(store, clip.sourceId, 0, 0), -0.75);
		assert.equal(await storedChannelSample(store, clip.sourceId, 1, 0), 0.25);

		controller.actions.edit.undo();
		const split = await controller.actions.track.splitStereoLR('controller-stereo-track');
		snapshot = controller.getSnapshot();
		const leftTrack = snapshot.project.tracks.find((candidate) => candidate.id === split.leftTrackId);
		const rightTrack = snapshot.project.tracks.find((candidate) => candidate.id === split.rightTrackId);
		assert.deepEqual([leftTrack.pan, rightTrack.pan], [-1, 1]);
		const leftClip = snapshot.project.clips.find((candidate) => leftTrack.clipIds.includes(candidate.id));
		const rightClip = snapshot.project.clips.find((candidate) => rightTrack.clipIds.includes(candidate.id));
		assert.equal(snapshot.project.sources.find((source) => source.id === leftClip.sourceId).channelCount, 1);
		assert.equal(snapshot.project.sources.find((source) => source.id === rightClip.sourceId).channelCount, 1);
		assert.equal(await storedChannelSample(store, leftClip.sourceId, 0, 0), 0.25);
		assert.equal(await storedChannelSample(store, rightClip.sourceId, 0, 0), -0.75);

		await controller.actions.track.makeStereo(split.leftTrackId, split.rightTrackId);
		snapshot = controller.getSnapshot();
		assert.equal(snapshot.project.tracks.length, 1);
		clip = snapshot.project.clips.find((candidate) => snapshot.project.tracks[0].clipIds.includes(candidate.id));
		assert.equal(snapshot.project.sources.find((source) => source.id === clip.sourceId).channelCount, 2);
		assert.equal(await storedChannelSample(store, clip.sourceId, 0, 0), 0.25);
		assert.equal(await storedChannelSample(store, clip.sourceId, 1, 0), -0.75);
	} finally {
		await controller.dispose();
	}
});

test('controller runs specialized analysis reports and snaps selections to zero crossings', async () => {
	let renderMode = 'analysis';
	const renderSnapshot = async (_project, range) => {
		const length = Math.max(1, range.outputFrames || range.endFrame - range.startFrame);
		const left = new Float32Array(length);
		const right = new Float32Array(length);
		if (renderMode === 'zero') {
			const localStart = 480;
			const localEnd = localStart + 1_000;
			left.fill(-0.5);
			right.fill(-0.4);
			left.fill(0.5, localStart + 2);
			right.fill(0.4, localStart + 2);
			left.fill(-0.5, localEnd - 2);
			right.fill(-0.4, localEnd - 2);
		} else {
			const amplitude = range.startFrame >= 2_000 ? 0.025 : 0.5;
			for (let frame = 0; frame < length; frame += 1) {
				left[frame] = Math.sin(2 * Math.PI * 1_000 * frame / 48_000) * amplitude;
				right[frame] = left[frame];
			}
			if (range.startFrame < 2_000) for (let frame = 100; frame < Math.min(105, length); frame += 1) left[frame] = right[frame] = 1.2;
		}
		return audioBuffer([left, right], 48_000);
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		renderSnapshot,
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project.tracks[0].id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [
			{ type: 'source/add', source: { id: 'analysis-source', name: 'analysis.wav', storageKey: 'analysis-source', mimeType: 'audio/wav', frameCount: 144_000, channelCount: 2 } },
			{ type: 'clip/add', trackId, clip: { id: 'analysis-clip', sourceId: 'analysis-source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 144_000 } },
		],
	});
	controller.actions.timeline.selectTrack(trackId);
	controller.actions.timeline.setSelection(0, 2_048);
	const spectrum = await controller.actions.analysis.plotSpectrum('track');
	assert.equal(spectrum.type, 'spectrum');
	assert.ok(spectrum.peak.frequency > 0);
	const clipping = await controller.actions.analysis.findClipping('track');
	assert.equal(clipping.type, 'clipping');
	assert.equal(clipping.regionCount, 1);
	assert.equal(controller.getSnapshot().analysisReport.type, 'clipping');
	const levels = await controller.actions.analysis.run('master');
	assert.ok(Number.isFinite(levels.peakDbfs));
	assert.ok(Number.isFinite(levels.truePeakDbtp));
	assert.ok(Number.isFinite(levels.rmsDbfs));

	controller.actions.timeline.setSelection(0, 1_000);
	await controller.actions.analysis.contrast('foreground', 'track');
	controller.actions.timeline.setSelection(2_000, 3_000);
	const contrast = await controller.actions.analysis.contrast('background', 'track');
	assert.equal(contrast.type, 'contrast');
	assert.ok(contrast.differenceDb > 20);
	assert.equal(contrast.passes, true);

	renderMode = 'zero';
	controller.actions.timeline.setSelection(10_000, 11_000);
	await controller.actions.timeline.zeroCross();
	assert.deepEqual(controller.getSnapshot().selection, { startFrame: 10_002, endFrame: 10_998, annotationIds: [] });
	await controller.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return {
				url: 'data:text/javascript,export default "mock-ffmpeg-asset"',
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/lib/tools/audio-editor/app.js');
const { createAudioEditorProjectV2 } = await import('../src/lib/tools/audio-editor/project-v2.js');
const { createProjectStore } = await import('../src/lib/tools/audio-editor/storage.js');

const COPY = Object.freeze({
	ready: 'Ready',
	untitledProject: 'Untitled project',
	track: 'Track',
	projectSaving: 'Saving',
	projectSaved: 'Saved',
	projectDirty: 'Unsaved',
	storage: 'Storage',
	genericError: 'Error: {message}',
	unknownError: 'Unknown error',
	timeSelectionRequired: 'Create a time selection first.',
	projectOpenOtherTab: 'This project is already open in another tab.',
	analysisRendering: 'Rendering audio for analysis',
	analysisCached: 'Loaded cached analysis.',
	contrastAnalyzing: 'Analyzing contrast range',
	contrastForegroundRole: 'foreground',
	contrastBackgroundRole: 'background',
	contrastStored: 'Stored contrast {role}.',
	zeroCrossingsAligned: 'Moved selection to zero crossings.',
	labels: 'Labels',
	labelsImporting: 'Importing labels',
	labelsImported: 'Imported {count} labels.',
	labelsExported: 'Exported {count} labels.',
	labelsImportEmpty: 'No readable labels.',
	labelTrackMissing: 'No label track.',
	labelsRequireV2: 'Labels require V2.',
	v2Required: 'This feature requires V2.',
	sampleEditSaving: 'Saving sample edit',
	sampleEditDone: 'Edited samples.',
	sampleEditCancelled: 'Sample editing cancelled.',
	sampleEditZoomRequired: 'Zoom to at least one pixel per sample.',
	audioClipNotFound: 'The selected audio clip could not be found.',
	rewritingChannels: 'Rewriting channels',
	channelsSwapped: 'channels swapped',
	leftChannel: 'Left',
	rightChannel: 'Right',
	stereoTrackRequired: 'Select a stereo track first.',
	monoTrackRequired: 'Select a mono track first.',
	compatibleMonoTrackRequired: 'Two mono tracks are required.',
	done: 'Done.',
});

test('headless audio editor exposes cached snapshots, subscriptions, and frame-accurate grouped actions', async () => {
	const store = createMemoryStore();
	const engine = createMemoryEngine();
	const ffmpeg = createMemoryFfmpeg();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine,
		ffmpeg,
	});

	const readySnapshot = await controller.ready;
	assert.equal(readySnapshot.ready, true);
	assert.equal(readySnapshot.phase, 'ready');
	assert.equal(readySnapshot.headless, true);
	assert.equal(readySnapshot.project.sampleRate, 48_000);
	assert.equal(readySnapshot.project.tracks.length, 1);
	assert.strictEqual(controller.getSnapshot(), readySnapshot);
	assert.strictEqual(controller.getSnapshot(), controller.getSnapshot());
	assert.strictEqual(controller.getTelemetrySnapshot(), controller.getTelemetrySnapshot());

	assert.deepEqual(Object.keys(controller.actions), [
		'project', 'edit', 'transport', 'recording', 'timeline', 'sampleEdit', 'spectral',
		'track', 'mixer', 'generators', 'labels', 'metadata', 'preferences', 'clip', 'effects', 'analysis', 'export',
	]);
	assert.equal(readySnapshot.preferences.workspace.activeId, 'modern');
	assert.equal(readySnapshot.preferences.appearance.theme, 'system');
	assert.equal(readySnapshot.preferences.appearance.clipStyle, 'colorful');
	assert.equal(readySnapshot.recordingOptions.inputGain, 1);
	controller.actions.recording.setLevel(1.25);
	assert.equal(controller.getSnapshot().recordingOptions.inputGain, 1.25);
	assert.equal(store.settings.get('recording-input-gain'), 1.25);
	controller.actions.metadata.update({ artist: 'Browser Artist' });
	assert.equal(controller.getSnapshot().project.metadata.artist, 'Browser Artist');
	await controller.actions.preferences.setWorkspace('music');
	assert.equal(controller.getSnapshot().preferences.workspace.panels.mixer.visible, true);
	await controller.actions.preferences.togglePanel('labels');
	assert.equal(controller.getSnapshot().preferences.workspace.panels.labels.visible, true);
	await controller.actions.preferences.setTheme('high-contrast-dark');
	assert.equal(store.settings.get('audio-editor-preferences-v1').appearance.theme, 'high-contrast-dark');
	assert.throws(
		() => controller.actions.preferences.setShortcut('split', 'Ctrl+S'),
		/Shortcut Ctrl\+S is already assigned to file-save/,
	);

	let documentNotifications = 0;
	let telemetryNotifications = 0;
	const unsubscribeDocument = controller.subscribe(() => { documentNotifications += 1; });
	const unsubscribeTelemetry = controller.subscribeTelemetry(() => { telemetryNotifications += 1; });

	controller.actions.edit.copy();
	const errorSnapshot = controller.getSnapshot();
	assert.equal(errorSnapshot.status.state, 'error');
	assert.match(errorSnapshot.status.message, /Create a time selection first/);
	assert.notStrictEqual(errorSnapshot, readySnapshot);

	const originalTrackId = errorSnapshot.project.tracks[0].id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [
			{
				type: 'source/add',
				source: {
					id: 'source-controller-test',
					name: 'fixture.wav',
					storageKey: 'source-controller-test',
					mimeType: 'audio/wav',
					frameCount: 144_000,
					channelCount: 2,
				},
			},
			{
				type: 'clip/add',
				trackId: originalTrackId,
				clip: {
					id: 'clip-controller-test',
					sourceId: 'source-controller-test',
					timelineStartFrame: 0,
					sourceStartFrame: 0,
					durationFrames: 144_000,
				},
			},
		],
	});

	controller.actions.timeline.setSelection(48_000, 96_000);
	assert.deepEqual(controller.getSnapshot().selection, { startFrame: 48_000, endFrame: 96_000 });
	assert.deepEqual(controller.getSnapshot().project.selection, { startFrame: 48_000, endFrame: 96_000 });

	const addedTrackId = controller.actions.track.add({ name: 'Dialogue', armed: false });
	controller.actions.track.update(addedTrackId, { name: 'Voice', gain: 0.5, pan: -0.25 });
	controller.actions.timeline.selectTrack(addedTrackId);
	const changedSnapshot = controller.getSnapshot();
	assert.equal(changedSnapshot.selectedTrackId, addedTrackId);
	const changedTrack = changedSnapshot.project.tracks.find((track) => track.id === addedTrackId);
	assert.equal(changedTrack.name, 'Voice');
	assert.equal(changedTrack.gain, 0.5);
	assert.equal(changedTrack.pan, -0.25);

	controller.actions.edit.commit({
		type: 'clip/add',
		trackId: addedTrackId,
		clip: {
			id: 'clip-controller-second',
			sourceId: 'source-controller-test',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: 48_000,
			durationFrames: 48_000,
		},
	});
	controller.actions.timeline.selectClip('clip-controller-test');
	controller.actions.timeline.selectClip('clip-controller-second', { additive: true });
	assert.deepEqual(controller.getSnapshot().project.selection.clipIds, [
		'clip-controller-test',
		'clip-controller-second',
	]);
	assert.deepEqual(controller.getSnapshot().project.selection.trackIds, [originalTrackId, addedTrackId]);
	controller.actions.timeline.selectClip('clip-controller-test', { toggle: true });
	assert.deepEqual(controller.getSnapshot().project.selection.clipIds, ['clip-controller-second']);
	assert.equal(controller.getSnapshot().selectedClipId, 'clip-controller-second');
	controller.actions.clip.stretch('clip-controller-second', { durationFrames: 96_000 });
	const stretchedClip = controller.getSnapshot().project.clips.find((clip) => clip.id === 'clip-controller-second');
	assert.equal(stretchedClip.durationFrames, 96_000);
	assert.equal(stretchedClip.speedRatio, 0.5);
	assert.equal(stretchedClip.renderCacheRevision, 1);
	controller.actions.timeline.clearSelection();
	assert.deepEqual(controller.getSnapshot().project.selection.clipIds, []);

	engine.positionFrame = 72_000;
	controller.actions.track.update(addedTrackId, { mute: true });
	assert.equal(controller.getTelemetrySnapshot().positionFrame, 72_000);
	assert.ok(documentNotifications > 0);
	assert.ok(telemetryNotifications > 0);

	const notificationsBeforeUnsubscribe = {
		document: documentNotifications,
		telemetry: telemetryNotifications,
	};
	unsubscribeDocument();
	unsubscribeTelemetry();
	controller.actions.track.update(addedTrackId, { mute: false });
	assert.deepEqual(
		{ document: documentNotifications, telemetry: telemetryNotifications },
		notificationsBeforeUnsubscribe,
	);

	await controller.actions.project.save();
	assert.equal(store.projects.get(changedSnapshot.project.id)?.sampleRate, 48_000);
	assert.ok(engine.appliedProjects.length >= 1);

	await controller.dispose();
});

test('live project tabs retain independent history and cross-project clipboard source roots', async () => {
	const store = createMemoryStore();
	const engine = createMemoryEngine();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine,
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;

	const firstProjectId = controller.getSnapshot().project.id;
	const firstTrack = controller.getSnapshot().project.tracks[0];
	controller.actions.edit.commit({
		type: 'batch',
		commands: [
			{
				type: 'source/add',
				source: {
					id: 'cross-project-source',
					name: 'cross-project.wav',
					storageKey: 'cross-project-source',
					mimeType: 'audio/wav',
					frameCount: 48_000,
					channelCount: 1,
				},
			},
			{
				type: 'clip/add',
				trackId: firstTrack.id,
				clip: {
					id: 'cross-project-clip',
					sourceId: 'cross-project-source',
					timelineStartFrame: 0,
					sourceStartFrame: 0,
					durationFrames: 48_000,
				},
			},
		],
	});
	controller.actions.timeline.setSelection(0, 24_000);
	controller.actions.edit.copy();
	controller.actions.track.update(firstTrack.id, { name: 'First edited' });

	await controller.actions.project.create({ title: 'Second project' });
	const secondProjectId = controller.getSnapshot().project.id;
	assert.notEqual(secondProjectId, firstProjectId);
	assert.deepEqual(controller.getSnapshot().projectTabs.map((tab) => tab.id), [firstProjectId, secondProjectId]);
	assert.equal(controller.getSnapshot().history.hasClipboard, true);

	controller.actions.edit.paste();
	let snapshot = controller.getSnapshot();
	assert.ok(snapshot.project.sources.some((source) => source.id === 'cross-project-source'));
	assert.ok(snapshot.project.clips.some((clip) => clip.sourceId === 'cross-project-source'));

	await controller.actions.project.openById(firstProjectId);
	snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.tracks.find((track) => track.id === firstTrack.id).name, 'First edited');
	controller.actions.edit.undo();
	assert.equal(controller.getSnapshot().project.tracks.find((track) => track.id === firstTrack.id).name, firstTrack.name);

	await controller.actions.project.openById(secondProjectId);
	controller.actions.edit.undo();
	snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.sources.some((source) => source.id === 'cross-project-source'), false);
	assert.equal(snapshot.project.clips.some((clip) => clip.sourceId === 'cross-project-source'), false);
	assert.equal(snapshot.history.hasClipboard, true);
	await controller.actions.project.save();
	assert.ok(store.pruneCalls.at(-1).protectedSourceIds.has('cross-project-source'));

	await controller.actions.project.openById(firstProjectId);
	controller.actions.edit.redo();
	assert.equal(controller.getSnapshot().project.tracks.find((track) => track.id === firstTrack.id).name, 'First edited');
	await controller.dispose();
});

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
	const project = createAudioEditorProjectV2({
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
		tracks: [{ type: 'audio', id: 'controller-sample-track', name: 'Samples', channelCount: 1, clipIds: ['controller-sample-clip'] }],
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
	assert.throws(() => controller.actions.sampleEdit.setMode('pencil'), /one pixel per sample/);
	controller.actions.timeline.setZoom(48_000);
	assert.equal(controller.getSnapshot().sampleEdit.available, true);
	controller.actions.sampleEdit.setMode('pencil');
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
	assert.deepEqual(controller.getSnapshot().selection, { startFrame: 0, endFrame: 48_000 });
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
	assert.equal(snapshot.project.tracks.find((track) => track.id === monoId).channelLayout, 'mono');
	assert.equal(snapshot.project.tracks.find((track) => track.id === monoId).channelCount, 1);
	assert.equal(snapshot.project.tracks.find((track) => track.id === stereoId).channelLayout, 'stereo');
	assert.equal(snapshot.project.tracks.find((track) => track.id === stereoId).channelCount, 2);

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
	controller.actions.track.collapseAll();
	assert.ok(controller.getSnapshot().project.tracks.every((track) => track.collapsed));
	controller.actions.track.expandAll();
	assert.ok(controller.getSnapshot().project.tracks.every((track) => !track.collapsed));
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
	const project = createAudioEditorProjectV2({
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
		tracks: [{ type: 'audio', id: 'controller-stereo-track', name: 'Stereo', channelCount: 2, clipIds: ['controller-stereo-clip'] }],
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
		const channels = Array.from({ length: track.channelCount }, (_, channel) => (
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
		assert.deepEqual([leftTrack.channelCount, leftTrack.pan, rightTrack.channelCount, rightTrack.pan], [1, -1, 1, 1]);
		const leftClip = snapshot.project.clips.find((candidate) => leftTrack.clipIds.includes(candidate.id));
		const rightClip = snapshot.project.clips.find((candidate) => rightTrack.clipIds.includes(candidate.id));
		assert.equal(await storedChannelSample(store, leftClip.sourceId, 0, 0), 0.25);
		assert.equal(await storedChannelSample(store, rightClip.sourceId, 0, 0), -0.75);

		await controller.actions.track.makeStereo(split.leftTrackId, split.rightTrackId);
		snapshot = controller.getSnapshot();
		assert.equal(snapshot.project.tracks.length, 1);
		assert.equal(snapshot.project.tracks[0].channelCount, 2);
		clip = snapshot.project.clips.find((candidate) => snapshot.project.tracks[0].clipIds.includes(candidate.id));
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
	assert.deepEqual(controller.getSnapshot().selection, { startFrame: 10_002, endFrame: 10_998 });
	await controller.dispose();
});

test('controller waits for first clip caches, refreshes stale playback, exports exact caches, and protects cache sources', async () => {
	const store = createMemoryStore();
	const engine = createMemoryEngine();
	const cache = createMemoryClipTimePitchCache();
	const renderEngines = [];
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine,
		ffmpeg: createMemoryFfmpeg(),
		clipTimePitchCache: cache,
		engineFactory: (options) => {
			const renderEngine = createMemoryRenderEngine(options);
			renderEngines.push(renderEngine);
			return renderEngine;
		},
	});
	await controller.ready;
	const trackId = controller.project.tracks.find((track) => track.type === 'audio').id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [
			{
				type: 'source/add',
				source: {
					id: 'time-pitch-source', storageKey: 'time-pitch-source', name: 'voice.wav', mimeType: 'audio/wav',
					frameCount: 48_000, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
				},
			},
			{
				type: 'clip/add',
				trackId,
				clip: {
					id: 'time-pitch-clip', sourceId: 'time-pitch-source', title: 'Voice',
					timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000,
					durationFrames: 48_000, pitchCents: 200, speedRatio: 1,
				},
			},
		],
	});

	assert.equal(engine.sourceResolver, cache.sourceResolver);
	const firstGate = deferred();
	cache.queuePlayback({ gate: firstGate, stale: false, revision: 'first' });
	const firstPlay = controller.actions.transport.playPause();
	await waitFor(() => cache.resolveCalls.length === 1);
	assert.equal(engine.state, 'stopped', 'first playback waits for a committed cache');
	firstGate.resolve();
	await firstPlay;
	assert.equal(engine.state, 'playing');
	controller.actions.transport.playPause();
	assert.equal(engine.state, 'paused');

	const staleGate = deferred();
	cache.queuePlayback({ gate: staleGate, stale: true, revision: 'updated' });
	const applyCount = engine.appliedProjects.length;
	await controller.actions.transport.playPause();
	assert.equal(engine.state, 'playing', 'a previous valid cache allows immediate playback');
	assert.equal(cache.resolveCalls.length, 2);
	staleGate.resolve();
	await waitFor(() => engine.appliedProjects.length > applyCount);
	assert.equal(cache.getCommitted('cache-updated')?.audioBuffer != null, true);
	controller.actions.transport.playPause();

	const output = await controller.actions.export.start({ format: 'wav', bitDepth: 16, includeTail: false });
	assert.equal(output?.mimeType, 'audio/wav');
	assert.equal(cache.prepareCalls.length > 0, true, 'offline export requests the exact committed revision');
	assert.equal(renderEngines.length > 0, true);
	assert.equal(renderEngines.every((renderEngine) => renderEngine.sourceResolver === cache.sourceResolver), true);

	await controller.actions.project.save();
	assert.equal(store.pruneCalls.some((call) => call.protectedSourceIds?.has('time-pitch-cache-protected')), true);
	await controller.dispose();
	assert.equal(cache.disposeCalls, 1);
});

test('headless controller publishes disposal once and closes injected runtimes', async () => {
	const store = createMemoryStore();
	const engine = createMemoryEngine();
	const ffmpeg = createMemoryFfmpeg();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store,
		engine,
		ffmpeg,
	});
	await controller.ready;

	let notifications = 0;
	controller.subscribe(() => { notifications += 1; });
	await controller.dispose();
	const disposed = controller.getSnapshot();
	assert.equal(disposed.phase, 'disposed');
	assert.equal(disposed.ready, false);
	assert.equal(disposed.disposed, true);
	assert.equal(notifications, 1);
	assert.equal(store.closeCalls, 1);
	assert.equal(engine.disposeCalls, 1);
	assert.equal(ffmpeg.disposeCalls, 1);

	await controller.dispose();
	assert.equal(notifications, 1);
	assert.equal(store.closeCalls, 1);
	assert.equal(engine.disposeCalls, 1);
	assert.equal(ffmpeg.disposeCalls, 1);
	assert.strictEqual(controller.getSnapshot(), disposed);
});

test('bootstrap preserves the project-lock status for a second controller', async () => {
	const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	const heldLocks = new Set();
	const locks = {
		request(name, options, callback) {
			assert.equal(options.ifAvailable, true);
			if (heldLocks.has(name)) return Promise.resolve(callback(null));
			heldLocks.add(name);
			return Promise.resolve(callback({ name })).finally(() => heldLocks.delete(name));
		},
	};
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: { locks },
	});

	const store = createMemoryStore();
	const first = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	let second;
	try {
		await first.ready;
		second = createAudioEditorController(null, {
			headless: true,
			copy: COPY,
			locale: 'en',
			store,
			engine: createMemoryEngine(),
			ffmpeg: createMemoryFfmpeg(),
		});
		const snapshot = await second.ready;
		assert.equal(snapshot.ready, true);
		assert.equal(snapshot.readOnly, true);
		assert.equal(snapshot.status.state, 'error');
		assert.equal(snapshot.status.message, 'This project is already open in another tab.');
	} finally {
		await second?.dispose();
		await first.dispose();
		if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
		else delete globalThis.navigator;
	}
});

function createMemoryStore() {
	const projects = new Map();
	const settings = new Map();
	const analysis = new Map();
	return {
		projects,
		settings,
		analysis,
		pruneCalls: [],
		closeCalls: 0,
		async ready() { return this; },
		async cleanupTemporaryAssets() {},
		async requestPersistentStorage() { return false; },
		async loadSetting(key, fallback) { return settings.has(key) ? settings.get(key) : fallback; },
		async saveSetting(key, value) { settings.set(key, structuredClone(value)); },
		async saveProject(project) {
			projects.set(project.id, structuredClone(project));
			return structuredClone(project);
		},
		async loadProject(projectId) {
			const project = projects.get(projectId);
			return project ? structuredClone(project) : null;
		},
		async listProjects() { return [...projects.values()].map((project) => structuredClone(project)); },
		async duplicateProject(projectId, options = {}) {
			const source = projects.get(projectId);
			const copy = { ...structuredClone(source), id: options.id || `${projectId}-copy`, title: options.title || `${source.title} copy` };
			projects.set(copy.id, structuredClone(copy));
			return copy;
		},
		async deleteProject(projectId) { projects.delete(projectId); },
		async clear() { projects.clear(); settings.clear(); analysis.clear(); },
		async loadAnalysis(key) { return analysis.has(key) ? structuredClone(analysis.get(key)) : null; },
		async saveAnalysis(key, value) { analysis.set(key, structuredClone(value)); },
		async beginSourceWrite() { throw new Error('The controller test store has no fixture PCM writer.'); },
		async getSourceMetadata() { return null; },
		async pruneUnreferencedSources(options = {}) { this.pruneCalls.push(options); return { deletedSourceIds: [] }; },
		async estimateStorage() { return { usage: 0, quota: 64 * 1024 * 1024 }; },
		async close() { this.closeCalls += 1; },
	};
}

function audioBuffer(channels, sampleRate) {
	return {
		numberOfChannels: channels.length,
		length: channels[0].length,
		sampleRate,
		getChannelData(channel) { return channels[channel]; },
	};
}

function createMemoryEngine() {
	return {
		positionFrame: 0,
		state: 'stopped',
		loadedProjects: [],
		appliedProjects: [],
		disposeCalls: 0,
		loadProject(project) { this.loadedProjects.push(structuredClone(project)); },
		async applyProject(project) { this.appliedProjects.push(structuredClone(project)); },
		getPositionFrames() { return this.positionFrame; },
		getState() { return { state: this.state, loop: { enabled: false } }; },
		stop() { this.state = 'stopped'; },
		play() { this.state = 'playing'; },
		pause() { this.state = 'paused'; },
		seek(frame) { this.positionFrame = Math.max(0, Math.round(frame)); return this.positionFrame; },
		setLoop() {},
		setSourceResolver(resolver) { this.sourceResolver = resolver; return this; },
		async getAudioContext() {
			return {
				createBuffer: (channelCount, frameCount, sampleRate) => new MockAudioBuffer(channelCount, frameCount, sampleRate),
			};
		},
		async dispose() { this.disposeCalls += 1; },
	};
}

function createMemoryRenderEngine(options = {}) {
	return {
		sourceResolver: options.sourceResolver || null,
		project: null,
		setSourceResolver(resolver) { this.sourceResolver = resolver; return this; },
		loadProject(project) { this.project = structuredClone(project); },
		async renderMix(range = {}) {
			const length = Math.max(1, Number(range.outputFrames) || Number(range.endFrame) - Number(range.startFrame) || 48_000);
			return new MockAudioBuffer(2, length, this.project?.sampleRate || 48_000);
		},
		async dispose() {},
	};
}

function createMemoryClipTimePitchCache() {
	const entries = new Map();
	const playback = [];
	const sourceResolver = () => null;
	const cache = {
		sourceResolver,
		resolveCalls: [],
		prepareCalls: [],
		attachedKeys: [],
		disposeCalls: 0,
		queuePlayback(value) { playback.push(value); },
		createEngineSourceResolver() { return sourceResolver; },
		retainClipIds() {},
		clear() { entries.clear(); },
		getProtectedSourceIds() { return new Set(['time-pitch-cache-protected']); },
		getCommitted(key) { return entries.get(key) || null; },
		attachAudioBuffer(key, buffer) {
			const entry = entries.get(key);
			if (entry) entry.audioBuffer = buffer;
			this.attachedKeys.push(key);
			return entry;
		},
		async loadCommittedChannels(entry) { return entry.channels; },
		async resolveForPlayback(clip, source, options = {}) {
			this.resolveCalls.push({ clip, source, signal: options.signal });
			const response = playback.shift() || { stale: false, revision: 'immediate' };
			const exact = cacheEntry(`cache-${response.revision}`, clip, source);
			entries.set(exact.cacheKey, exact);
			if (!response.stale) {
				if (response.gate) await waitWithSignal(response.gate.promise, options.signal);
				return { ...exact, stale: false, pending: Promise.resolve(exact) };
			}
			const previous = cacheEntry('cache-previous', clip, source);
			entries.set(previous.cacheKey, previous);
			const pending = waitWithSignal(response.gate.promise, options.signal).then(() => exact);
			return { ...previous, stale: true, desiredCacheKey: exact.cacheKey, pending };
		},
		async prepareCommittedOutput(clip, source, options = {}) {
			this.prepareCalls.push({ clip, source, signal: options.signal });
			if (options.signal?.aborted) throw abortError();
			const entry = cacheEntry(`cache-export-${clip.renderCacheRevision || 0}`, clip, source);
			entries.set(entry.cacheKey, entry);
			return entry;
		},
		dispose() { this.disposeCalls += 1; },
	};
	return cache;
}

function cacheEntry(cacheKey, clip, source) {
	const frameCount = Math.max(1, Math.round((clip.sourceDurationFrames || clip.durationFrames) / (clip.speedRatio || 1)));
	return {
		cacheKey,
		cacheSourceId: `${cacheKey}-source`,
		sourceId: source.id,
		sampleRate: source.sampleRate || 48_000,
		channelCount: source.channelCount || 1,
		frameCount,
		audioBuffer: new MockAudioBuffer(source.channelCount || 1, frameCount, source.sampleRate || 48_000),
		channels: null,
	};
}

class MockAudioBuffer {
	constructor(numberOfChannels, length, sampleRate) {
		this.numberOfChannels = numberOfChannels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}

	getChannelData(channel) { return this.channels[channel]; }
	copyToChannel(values, channel, offset = 0) { this.channels[channel].set(values, offset); }
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

async function waitFor(predicate, attempts = 100) {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error('Timed out waiting for the controller test condition.');
}

async function storedSample(store, sourceId, frame) {
	return storedChannelSample(store, sourceId, 0, frame);
}

async function storedChannelSample(store, sourceId, channel, frame) {
	let offset = 0;
	for await (const chunk of store.readSourceChunks(sourceId)) {
		if (frame < offset + chunk.frames) return chunk.channels[channel][frame - offset];
		offset += chunk.frames;
	}
	throw new RangeError(`Source ${sourceId} does not contain frame ${frame}.`);
}

function waitWithSignal(promise, signal) {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(abortError());
	return new Promise((resolve, reject) => {
		const abort = () => reject(abortError());
		signal.addEventListener('abort', abort, { once: true });
		promise.then(
			(value) => { signal.removeEventListener('abort', abort); resolve(value); },
			(error) => { signal.removeEventListener('abort', abort); reject(error); },
		);
	});
}

function abortError() {
	const error = new Error('cancelled');
	error.name = 'AbortError';
	return error;
}

function createMemoryFfmpeg() {
	return {
		disposeCalls: 0,
		dispose() { this.disposeCalls += 1; },
	};
}

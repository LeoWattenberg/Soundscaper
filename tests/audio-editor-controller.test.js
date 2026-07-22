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

const {
	calculateAudioEditorMetronomeSchedule,
	createAudioEditorController,
} = await import('../src/common/editor/app.js');
const { createAudioEditorProjectV2 } = await import('../src/common/editor/project-v2.js');
const {
	createAudioClipV4,
	createAudioEditorProjectV4,
	createAudioSourceV4,
	createVideoClipV4,
	createVideoSourceV4,
} = await import('../src/common/editor/project-v4.js');
const { createProjectStore } = await import('../src/common/editor/storage.js');

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
	effectMemoryTooLarge: 'This effect needs too much memory.',
	generatingAudio: 'Generating audio',
	toneGenerator: 'Tone',
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
		clipTimePitchMaximumResidentChannelBytes: 1_024,
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
	assert.equal(controller.clipTimePitchCache.transferLoadedSourceChannels, true);
	assert.equal(controller.clipTimePitchCache.maximumResidentChannelBytes, 1_024);

	assert.deepEqual(Object.keys(controller.actions), [
		'project', 'projectBin', 'video', 'edit', 'transport', 'recording', 'metering', 'audioDevices', 'timeline', 'sampleEdit', 'spectral',
		'track', 'mixer', 'generators', 'nyquist', 'labels', 'metadata', 'preferences', 'clip', 'effects', 'macros', 'analysis', 'export',
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
	await controller.actions.preferences.setWorkspace('video-editor');
	assert.equal(controller.getSnapshot().preferences.workspace.activeId, 'video-editor');
	assert.equal(controller.getSnapshot().preferences.workspace.panels['project-bin'].visible, true);
	assert.equal(controller.getSnapshot().preferences.workspace.panels['video-preview'].visible, true);
	await controller.actions.preferences.setWorkspace('classic');
	assert.equal(controller.getSnapshot().preferences.workspace.panels.history.visible, false);
	assert.equal(controller.getSnapshot().preferences.workspace.panels['project-bin'].visible, false);
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
	assert.deepEqual(controller.getSnapshot().selection, null);
	controller.actions.clip.move('clip-controller-second', addedTrackId, 4_800);
	let collectivelyEditedClips = Object.fromEntries(controller.getSnapshot().project.clips.map((clip) => [clip.id, clip]));
	assert.equal(collectivelyEditedClips['clip-controller-test'].timelineStartFrame, 4_800);
	assert.equal(collectivelyEditedClips['clip-controller-second'].timelineStartFrame, 4_800);
	assert.deepEqual(controller.getSnapshot().project.selection, {
		startFrame: 0,
		endFrame: 0,
		trackIds: [originalTrackId, addedTrackId],
		clipIds: ['clip-controller-test', 'clip-controller-second'],
		frequencyRange: null,
	});
	controller.actions.clip.trim('clip-controller-second', { durationFrames: 47_900 });
	collectivelyEditedClips = Object.fromEntries(controller.getSnapshot().project.clips.map((clip) => [clip.id, clip]));
	assert.equal(collectivelyEditedClips['clip-controller-test'].durationFrames, 143_900);
	assert.equal(collectivelyEditedClips['clip-controller-second'].durationFrames, 47_900);
	assert.equal(collectivelyEditedClips['clip-controller-test'].sourceDurationFrames, 143_900);
	assert.equal(collectivelyEditedClips['clip-controller-second'].sourceDurationFrames, 47_900);
	controller.actions.clip.stretch('clip-controller-second', { durationFrames: 95_800 });
	collectivelyEditedClips = Object.fromEntries(controller.getSnapshot().project.clips.map((clip) => [clip.id, clip]));
	assert.equal(collectivelyEditedClips['clip-controller-test'].durationFrames, 287_800);
	assert.equal(collectivelyEditedClips['clip-controller-second'].durationFrames, 95_800);
	assert.equal(collectivelyEditedClips['clip-controller-test'].speedRatio, 0.5);
	assert.equal(collectivelyEditedClips['clip-controller-second'].speedRatio, 0.5);
	controller.actions.timeline.selectClip('clip-controller-test', { toggle: true });
	assert.deepEqual(controller.getSnapshot().project.selection.clipIds, ['clip-controller-second']);
	assert.equal(controller.getSnapshot().selectedClipId, 'clip-controller-second');
	controller.actions.clip.stretch('clip-controller-second', { durationFrames: 96_000 });
	const stretchedClip = controller.getSnapshot().project.clips.find((clip) => clip.id === 'clip-controller-second');
	assert.equal(stretchedClip.durationFrames, 96_000);
	assert.equal(stretchedClip.speedRatio, 47_900 / 96_000);
	assert.equal(stretchedClip.renderCacheRevision, 2);
	controller.actions.timeline.setSelection(48_000, 96_000);
	assert.equal(controller.getSnapshot().selectedClipId, null);
	assert.deepEqual(controller.getSnapshot().project.selection, {
		startFrame: 48_000,
		endFrame: 96_000,
	});
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

test('selection-only actions preserve edit history, persistence state, and the live audio graph', async () => {
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
	const projectId = controller.getSnapshot().project.id;
	const trackId = controller.getSnapshot().project.tracks[0].id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [{
			type: 'source/add',
			source: {
				id: 'selection-state-source',
				name: 'selection.wav',
				storageKey: 'selection-state-source',
				mimeType: 'audio/wav',
				frameCount: 4_800,
				channelCount: 1,
				sampleRate: 48_000,
			},
		}, {
			type: 'clip/add',
			trackId,
			clip: {
				id: 'selection-state-clip',
				sourceId: 'selection-state-source',
				timelineStartFrame: 0,
				sourceStartFrame: 0,
				durationFrames: 4_800,
			},
		}],
	});
	await controller.actions.project.flush();
	await Promise.resolve();
	await Promise.resolve();

	const historyBefore = controller.getSnapshot().history;
	const persistedSelection = structuredClone(store.projects.get(projectId).selection);
	engine.appliedProjects.length = 0;
	engine.play();

	controller.actions.timeline.setSelection(100, 200);
	controller.actions.timeline.selectClip('selection-state-clip');
	controller.actions.timeline.clearSelection();

	const snapshot = controller.getSnapshot();
	assert.equal(engine.state, 'playing');
	assert.equal(engine.appliedProjects.length, 0);
	assert.deepEqual(snapshot.history.undoEntries, historyBefore.undoEntries);
	assert.deepEqual(snapshot.history.redoEntries, historyBefore.redoEntries);
	assert.equal(snapshot.save.state, 'saved');
	assert.deepEqual(store.projects.get(projectId).selection, persistedSelection);
	await controller.dispose();
});

test('controller moves transformed selections through the reusable project bin and places stable copies', async () => {
	const engine = createMemoryEngine();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine,
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;

	const firstTrackId = controller.project.tracks[0].id;
	const secondTrackId = controller.actions.track.add({ name: 'Project-bin companion' });
	controller.actions.edit.commit({
		type: 'batch',
		commands: [{
			type: 'source/add',
			source: {
				schemaVersion: 2,
				id: 'project-bin-source',
				storageKey: 'project-bin-source',
				name: 'project-bin.wav',
				mimeType: 'audio/wav',
				frameCount: 96_000,
				channelCount: 2,
				sampleRate: 48_000,
				originalSampleRate: 48_000,
			},
		}, {
			type: 'clip/add',
			trackId: firstTrackId,
			clip: {
				schemaVersion: 2,
				id: 'project-bin-first',
				sourceId: 'project-bin-source',
				title: 'Transformed take',
				timelineStartFrame: 2_000,
				sourceStartFrame: 1_000,
				sourceDurationFrames: 10_000,
				durationFrames: 8_000,
				trimStartFrames: 500,
				trimEndFrames: 800,
				gain: 1.5,
				fadeInFrames: 200,
				fadeOutFrames: 300,
				envelope: [{ frame: 1_000, value: 0.75 }],
				groupId: 'project-bin-group',
				color: 'magenta',
				pitchCents: 250,
				speedRatio: 1.25,
				preserveFormants: true,
				stretchToTempo: true,
				renderCacheRevision: 4,
			},
		}, {
			type: 'clip/add',
			trackId: secondTrackId,
			clip: {
				schemaVersion: 2,
				id: 'project-bin-second',
				sourceId: 'project-bin-source',
				title: 'Grouped take',
				timelineStartFrame: 12_000,
				sourceStartFrame: 20_000,
				sourceDurationFrames: 4_000,
				durationFrames: 4_000,
				groupId: 'project-bin-group',
			},
		}],
	});
	controller.actions.timeline.selectClip('project-bin-first');

	assert.deepEqual(
		controller.actions.projectBin.moveFromTimeline('project-bin-first'),
		['project-bin-first', 'project-bin-second'],
	);
	let snapshot = controller.getSnapshot();
	assert.deepEqual(snapshot.project.clips, []);
	assert.deepEqual(snapshot.project.projectBin.clips.map((clip) => clip.id), [
		'project-bin-first',
		'project-bin-second',
	]);
	const stored = snapshot.project.projectBin.clips[0];
	assert.equal(stored.groupId, null);
	assert.equal(stored.sourceStartFrame, 1_000);
	assert.equal(stored.sourceDurationFrames, 10_000);
	assert.equal(stored.durationFrames, 8_000);
	assert.equal(stored.gain, 1.5);
	assert.equal(stored.pitchCents, 250);
	assert.equal(stored.speedRatio, 1.25);
	assert.equal(stored.preserveFormants, true);
	assert.equal(stored.stretchToTempo, true);
	assert.equal(stored.renderCacheRevision, 4);
	assert.equal(snapshot.selectedClipId, null);
	assert.deepEqual(snapshot.project.selection.clipIds, []);
	assert.deepEqual(controller.actions.projectBin.getVisualData(stored.id), {
		clip: stored,
		track: null,
		source: snapshot.project.sources[0],
		buffer: null,
		peaks: null,
		available: true,
	});

	controller.actions.edit.undo();
	snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.projectBin.clips.length, 0);
	assert.deepEqual(snapshot.project.clips.map((clip) => clip.groupId), [
		'project-bin-group',
		'project-bin-group',
	]);
	assert.deepEqual(snapshot.project.selection.clipIds, ['project-bin-first', 'project-bin-second']);
	controller.actions.edit.redo();

	controller.actions.projectBin.rename('project-bin-first', 'Reusable vocal');
	assert.equal(controller.getSnapshot().project.projectBin.clips[0].title, 'Reusable vocal');
	engine.positionFrame = 33_333;
	controller.actions.timeline.selectTrack(firstTrackId);
	const placedClipId = controller.actions.projectBin.place('project-bin-first');
	snapshot = controller.getSnapshot();
	assert.notEqual(placedClipId, 'project-bin-first');
	assert.equal(snapshot.project.projectBin.clips.length, 2);
	const placed = snapshot.project.clips.find((clip) => clip.id === placedClipId);
	assert.equal(placed.timelineStartFrame, 33_333);
	assert.equal(placed.groupId, null);
	assert.equal(placed.title, 'Reusable vocal');
	assert.equal(placed.pitchCents, 250);
	assert.equal(snapshot.selectedClipId, placedClipId);
	assert.equal(snapshot.selectedTrackId, firstTrackId);

	assert.equal(controller.actions.projectBin.setColor('project-bin-first', 'green'), 'green');
	snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.projectBin.clips.find((clip) => clip.id === 'project-bin-first').color, 'green');
	assert.equal(snapshot.project.clips.find((clip) => clip.id === placedClipId).color, 'magenta');
	assert.equal(controller.actions.projectBin.instanceCount('project-bin-first'), 1);
	assert.deepEqual(controller.actions.projectBin.selectInstances('project-bin-first'), [placedClipId]);
	assert.deepEqual(controller.getSnapshot().project.selection.clipIds, [placedClipId]);
	assert.deepEqual(controller.actions.projectBin.removeFromProject('project-bin-first'), [placedClipId]);
	snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.clips.length, 0);
	assert.equal(snapshot.project.projectBin.clips.length, 0);
	assert.equal(snapshot.project.sources.some((source) => source.id === 'project-bin-source'), false);
	controller.actions.edit.undo();

	assert.equal(controller.actions.projectBin.remove('project-bin-second'), 'project-bin-second');
	assert.deepEqual(controller.getSnapshot().project.projectBin.clips.map((clip) => clip.id), ['project-bin-first']);
	controller.actions.edit.undo();
	assert.deepEqual(controller.getSnapshot().project.projectBin.clips.map((clip) => clip.id), [
		'project-bin-first',
		'project-bin-second',
	]);
	await controller.dispose();
});

test('controller opens persisted compound video bin items, restores visuals, and places paired lanes', async () => {
	const store = createMemoryStore();
	const fixture = createPersistedVideoProject({ projectBin: true });
	store.projects.set(fixture.project.id, structuredClone(fixture.project));
	store.settings.set('last-project-id', fixture.project.id);
	store.mediaAssets.set(fixture.videoSource.id, new Blob(['persisted-video'], { type: 'video/mp4' }));
	store.videoDerivatives.set(fixture.videoSource.id, [
		{
			timestamp: 0,
			type: 'poster',
			width: 320,
			height: 180,
			blob: new Blob(['poster'], { type: 'image/jpeg' }),
		},
		{
			timestamp: 5,
			type: 'thumbnail',
			width: 320,
			height: 180,
			blob: new Blob(['thumbnail-five'], { type: 'image/jpeg' }),
		},
	]);
	store.audioSources.set(fixture.audioSource.id, [
		new Float32Array(fixture.audioSource.frameCount),
		new Float32Array(fixture.audioSource.frameCount),
	]);

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

	const snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.id, fixture.project.id);
	assert.deepEqual(snapshot.project.projectBin.clips.map((clip) => [
		clip.id,
		clip.kind,
		clip.binItemId,
	]), [
		['persisted-bin-video', 'video', 'persisted-bin-item'],
		['persisted-bin-audio', 'audio', 'persisted-bin-item'],
	]);
	const visual = controller.actions.projectBin.getVisualData('persisted-bin-audio');
	assert.equal(visual.videoClip.id, 'persisted-bin-video');
	assert.deepEqual(visual.itemClips.map((clip) => clip.id), [
		'persisted-bin-video',
		'persisted-bin-audio',
	]);
	assert.equal(visual.available, true);
	assert.match(visual.mediaUrl, /^blob:/);
	assert.match(visual.posterUrl, /^blob:/);
	assert.deepEqual(visual.thumbnails.map((thumbnail) => ({
		sourceTimeSeconds: thumbnail.sourceTimeSeconds,
		width: thumbnail.width,
		height: thumbnail.height,
		hasUrl: /^blob:/.test(thumbnail.url),
	})), [{
		sourceTimeSeconds: 5,
		width: 320,
		height: 180,
		hasUrl: true,
	}]);

	controller.actions.projectBin.rename('persisted-bin-audio', 'Reusable scene');
	assert.deepEqual(
		controller.getSnapshot().project.projectBin.clips.map((clip) => clip.title),
		['Reusable scene', 'Reusable scene'],
	);
	const placedVideoId = controller.actions.projectBin.place('persisted-bin-audio', {
		timelineStartFrame: 24_000,
	});
	const placed = controller.getSnapshot();
	assert.equal(placed.project.tracks.length, 2);
	assert.deepEqual(placed.project.tracks.map((track) => track.type), ['video', 'audio']);
	assert.ok(placed.project.tracks[0].laneGroupId);
	assert.equal(placed.project.tracks[0].laneGroupId, placed.project.tracks[1].laneGroupId);
	const placedVideo = placed.project.clips.find((clip) => clip.id === placedVideoId);
	const placedAudio = placed.project.clips.find((clip) => clip.kind === 'audio');
	assert.equal(placedVideo.kind, 'video');
	assert.equal(placedVideo.timelineStartFrame, 24_000);
	assert.equal(placedAudio.timelineStartFrame, 24_000);
	assert.ok(placedVideo.avLinkId);
	assert.equal(placedVideo.avLinkId, placedAudio.avLinkId);
	assert.equal(placedVideo.binItemId, null);
	assert.equal(placedAudio.binItemId, null);
	assert.equal(placed.selectedTrackId, placed.project.tracks[0].id);
	assert.equal(placed.selectedClipId, placedVideoId);
	assert.equal(placed.project.projectBin.clips.length, 2);

	assert.equal(controller.actions.projectBin.remove('persisted-bin-video'), 'persisted-bin-video');
	assert.deepEqual(controller.getSnapshot().project.projectBin.clips, []);
	await controller.dispose();
});

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
		snapshot.project.clips.map((clip) => [clip.kind, clip.timelineStartFrame, clip.avLinkId]),
		[
			['video', 12_000, 'persisted-av-link'],
			['audio', 12_000, 'persisted-av-link'],
		],
	);
	await controller.dispose();
});

test('linked video moves create crossfades with aligned audio and reject a third overlap atomically', async () => {
	const store = createMemoryStore();
	const fixture = createPersistedVideoProject({ timeline: true });
	const project = structuredClone(fixture.project);
	for (const [suffix, timelineStartFrame] of [['second', 48_000], ['third', 96_000]]) {
		const avLinkId = `${suffix}-av-link`;
		const videoClip = createVideoClipV4({
			id: `${suffix}-timeline-video`,
			sourceId: fixture.videoSource.id,
			title: `${suffix} video`,
			timelineStartFrame,
			sourceStartFrame: 0,
			sourceDurationFrames: 48_000,
			durationFrames: 48_000,
			avLinkId,
		});
		const audioClip = createAudioClipV4({
			id: `${suffix}-timeline-audio`,
			sourceId: fixture.audioSource.id,
			title: `${suffix} audio`,
			timelineStartFrame,
			sourceStartFrame: 0,
			sourceDurationFrames: 48_000,
			durationFrames: 48_000,
			avLinkId,
		});
		project.clips.push(videoClip, audioClip);
		project.tracks[0].clipIds.push(videoClip.id);
		project.tracks[1].clipIds.push(audioClip.id);
	}
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
	assert.equal(snapshot.project.clips.find((clip) => clip.id === 'persisted-timeline-video').timelineStartFrame, 24_000);
	assert.equal(snapshot.project.clips.find((clip) => clip.id === 'persisted-timeline-audio').timelineStartFrame, 24_000);

	controller.actions.edit.undo();
	snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.clips.find((clip) => clip.id === 'persisted-timeline-video').timelineStartFrame, 0);
	assert.equal(snapshot.project.clips.find((clip) => clip.id === 'persisted-timeline-audio').timelineStartFrame, 0);
	controller.actions.edit.redo();
	assert.equal(
		controller.getSnapshot().project.clips.find((clip) => clip.id === 'persisted-timeline-video').timelineStartFrame,
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
		controller.getSnapshot().project.clips.find((clip) => clip.id === 'persisted-timeline-video').timelineStartFrame,
		24_000,
	);

	const beforeInvalidMove = controller.getSnapshot().project;
	assert.throws(() => (
		controller.actions.clip.move('third-timeline-video', 'persisted-video-track', 60_000)
	));
	assert.strictEqual(controller.getSnapshot().project, beforeInvalidMove);
	assert.equal(
		controller.getSnapshot().project.clips.find((clip) => clip.id === 'third-timeline-audio').timelineStartFrame,
		96_000,
	);
	await controller.dispose();
});

test('track move actions reorder paired video and audio lanes as one layer block', async () => {
	const store = createMemoryStore();
	const fixture = createPersistedVideoProject({ timeline: true });
	const project = structuredClone(fixture.project);
	project.tracks.push({
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

		const videoClip = snapshot.project.clips.find((clip) => clip.kind === 'video');
		const audioClip = snapshot.project.clips.find((clip) => clip.avLinkId === videoClip?.avLinkId && clip.kind === 'audio');
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

test('video export API and generic export dispatch stage raw media and audio for MP4 and WebM', async () => {
	const store = createMemoryStore();
	const fixture = createPersistedVideoProject({ timeline: true });
	store.projects.set(fixture.project.id, structuredClone(fixture.project));
	store.settings.set('last-project-id', fixture.project.id);
	const rawVideo = new Blob(['raw-video-bytes'], { type: 'video/mp4' });
	store.mediaAssets.set(fixture.videoSource.id, rawVideo);
	store.videoDerivatives.set(fixture.videoSource.id, []);
	store.audioSources.set(fixture.audioSource.id, [
		new Float32Array(fixture.audioSource.frameCount),
		new Float32Array(fixture.audioSource.frameCount),
	]);
	const ffmpeg = createVideoMemoryFfmpeg();
	const renderCalls = [];
	const downloads = [];
	const cleanups = [];
	const fileService = {
		isDesktop: false,
		async createDownload(request) {
			downloads.push(request);
			return {
				url: null,
				fileName: request.suggestedName,
				method: 'test',
				cleanup: async () => { cleanups.push(request.suggestedName); },
			};
		},
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg,
		fileService,
		renderSnapshot: async (project, range, sourceBuffers, signal) => {
			renderCalls.push({ project, range, sourceBuffers, signal });
			return new MockAudioBuffer(2, range.outputFrames, project.sampleRate);
		},
	});
	await controller.ready;

	const mp4 = await controller.actions.video.export({ format: 'video-mp4' });
	assert.deepEqual({
		fileName: mp4.fileName,
		mimeType: mp4.mimeType,
		method: mp4.method,
	}, {
		fileName: 'Persisted-video-project.mp4',
		mimeType: 'video/mp4',
		method: 'test',
	});
	assert.equal(ffmpeg.videoCalls.length, 1);
	assert.equal(ffmpeg.videoCalls[0].videoBlobs.get(fixture.videoSource.id), rawVideo);
	assert.equal(ffmpeg.videoCalls[0].audioMixBlob.type, 'audio/wav');
	assert.ok(ffmpeg.videoCalls[0].audioMixBlob.size > 44);
	assert.equal(ffmpeg.videoCalls[0].plan.format, 'mp4');
	assert.equal(ffmpeg.videoCalls[0].plan.mimeType, 'video/mp4');
	assert.equal(ffmpeg.videoCalls[0].plan.canvas.width, 640);
	assert.equal(ffmpeg.videoCalls[0].plan.canvas.height, 360);
	assert.equal(ffmpeg.videoCalls[0].plan.version, 3);
	assert.equal(
		ffmpeg.videoCalls[0].plan.intervals[0].layers[0].clips[0].clipId,
		'persisted-timeline-video',
	);
	assert.equal(renderCalls[0].range.startFrame, 0);
	assert.equal(renderCalls[0].range.endFrame, fixture.videoSource.frameCount);
	assert.equal(renderCalls[0].range.outputFrames, fixture.videoSource.frameCount);
	assert.equal(downloads[0].purpose, 'video');
	assert.equal(downloads[0].mimeType, 'video/mp4');

	const webm = await controller.actions.export.start({ format: 'video-webm' });
	assert.equal(webm.fileName, 'Persisted-video-project.webm');
	assert.equal(webm.mimeType, 'video/webm');
	assert.equal(ffmpeg.videoCalls.length, 2);
	assert.equal(ffmpeg.videoCalls[1].plan.format, 'webm');
	assert.equal(ffmpeg.videoCalls[1].plan.codecs.videoEncoder, 'libvpx-vp9');
	assert.equal(downloads[1].mimeType, 'video/webm');
	assert.deepEqual(cleanups, ['Persisted-video-project.mp4']);
	assert.equal(controller.getSnapshot().export.output.fileName, 'Persisted-video-project.webm');

	await controller.dispose();
	assert.deepEqual(cleanups, [
		'Persisted-video-project.mp4',
		'Persisted-video-project.webm',
	]);
});

test('bin-only missing audio is unavailable without blocking timeline transport', async () => {
	const store = createMemoryStore();
	let controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [{
			type: 'source/add',
			source: {
				id: 'missing-bin-source',
				storageKey: 'missing-bin-source',
				name: 'missing-bin.wav',
				mimeType: 'audio/wav',
				frameCount: 48_000,
				channelCount: 1,
				sampleRate: 48_000,
			},
		}, {
			type: 'project-bin/add',
			clip: {
				id: 'missing-bin-clip',
				sourceId: 'missing-bin-source',
				title: 'Unavailable take',
				timelineStartFrame: 0,
				sourceStartFrame: 0,
				sourceDurationFrames: 48_000,
				durationFrames: 48_000,
			},
		}],
	});
	await controller.actions.project.save();
	await controller.dispose();

	const engine = createMemoryEngine();
	controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine,
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	const visuals = controller.actions.projectBin.getVisualData('missing-bin-clip');
	assert.equal(visuals.available, false);
	assert.equal(controller.getSnapshot().missingSourceIds.includes('missing-bin-source'), true);
	assert.throws(
		() => controller.actions.projectBin.place('missing-bin-clip'),
		/missing|source|audio/i,
	);
	await assert.doesNotReject(() => controller.actions.transport.playPause());
	assert.equal(engine.state, 'playing');
	await controller.dispose();
});

test('controller persists direct workspace panel and toolbar moves', async () => {
	const store = createMemoryStore();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	await controller.actions.preferences.setWorkspace('music');
	await controller.actions.preferences.setPanel('history', { visible: false, dock: 'right', order: 0 });
	await controller.actions.preferences.setPanel('labels', { visible: true, dock: 'right', order: 1 });
	await controller.actions.preferences.setPanel('effects', { visible: true, dock: 'right', order: 2 });
	await controller.actions.preferences.movePanel('mixer', 'right', 1);
	let workspace = controller.getSnapshot().preferences.workspace;
	assert.equal(workspace.panels.mixer.dock, 'right');
	assert.deepEqual(
		Object.entries(workspace.panels)
			.filter(([, panel]) => panel.visible && panel.dock === 'right')
			.sort((left, right) => left[1].order - right[1].order)
			.map(([id]) => id),
		['labels', 'mixer', 'effects'],
	);
	await controller.actions.preferences.setPanel('mixer', {
		dock: 'floating', size: 512, x: 44, y: 52, width: 512, height: 384,
	});
	workspace = controller.getSnapshot().preferences.workspace;
	assert.deepEqual({
		visible: workspace.panels.mixer.visible,
		dock: workspace.panels.mixer.dock,
		size: workspace.panels.mixer.size,
		x: workspace.panels.mixer.x,
		y: workspace.panels.mixer.y,
		width: workspace.panels.mixer.width,
		height: workspace.panels.mixer.height,
	}, { visible: true, dock: 'floating', size: 512, x: 44, y: 52, width: 512, height: 384 });
	await controller.actions.preferences.moveToolbar('meter', 0);
	workspace = controller.getSnapshot().preferences.workspace;
	assert.equal(workspace.toolbars.meter.order, 0);
	assert.equal(workspace.toolbars.transport.order, 1);
	assert.deepEqual(
		store.settings.get('audio-editor-preferences-v1').workspace.panels.mixer,
		workspace.panels.mixer,
	);
	await controller.dispose();
});

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

test('controller persists play-at-speed pitch behavior and dispatches the selected mode', async () => {
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

	controller.actions.transport.setPlayAtSpeedRate(1.5);
	await controller.actions.transport.playAtSpeed();
	assert.equal(controller.getSnapshot().playbackOptions.rate, 1.5);
	assert.equal(engine.playAtSpeedCalls[0].rate, 1.5);
	assert.equal(engine.playAtSpeedCalls[0].options.preservePitch, false);
	engine.stop();

	await controller.actions.preferences.update({ playback: { playAtSpeedMode: 'staffpad' } });
	await controller.actions.transport.playAtSpeed(0.75);
	assert.equal(engine.playAtSpeedCalls[1].rate, 0.75);
	assert.equal(engine.playAtSpeedCalls[1].options.preservePitch, true);
	assert.equal(typeof engine.playAtSpeedCalls[1].options.pitchPreserver, 'function');
	assert.equal(store.settings.get('audio-editor-preferences-v1').playback.playAtSpeedMode, 'staffpad');

	await controller.dispose();
});

test('play-at-speed preparation is cancellable while transformed clip caches are pending', async () => {
	const engine = createMemoryEngine();
	const cache = createMemoryClipTimePitchCache();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine,
		ffmpeg: createMemoryFfmpeg(),
		clipTimePitchCache: cache,
	});
	await controller.ready;
	const trackId = controller.project.tracks.find((track) => track.type === 'audio').id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [
			{ type: 'source/add', source: {
				id: 'speed-source', storageKey: 'speed-source', name: 'speed.wav', mimeType: 'audio/wav',
				frameCount: 48_000, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
			} },
			{ type: 'clip/add', trackId, clip: {
				id: 'speed-clip', sourceId: 'speed-source', title: 'Speed', timelineStartFrame: 0,
				sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000,
				pitchCents: 200, speedRatio: 1,
			} },
		],
	});
	const cacheGate = deferred();
	cache.queuePlayback({ gate: cacheGate, stale: false, revision: 'pending-speed' });

	const pending = controller.actions.transport.playAtSpeed(1.25);
	await waitFor(() => cache.resolveCalls.length === 1);
	assert.equal(controller.getSnapshot().playbackOptions.preparing, true);
	assert.equal(cache.resolveCalls[0].signal.aborted, false);
	assert.equal(await controller.actions.transport.playAtSpeed(), false);
	assert.equal(cache.resolveCalls[0].signal.aborted, true);
	assert.equal(await pending, false);
	assert.equal(controller.getSnapshot().playbackOptions.preparing, false);
	assert.equal(engine.playAtSpeedCalls.length, 0);
	await controller.dispose();
});

test('metronome transport timing scales both the next click and beat interval by playback rate', () => {
	const normal = calculateAudioEditorMetronomeSchedule({
		bpm: 120,
		sampleRate: 48_000,
		positionFrame: 12_000,
		playbackRate: 1,
	});
	const doubleSpeed = calculateAudioEditorMetronomeSchedule({
		bpm: 120,
		sampleRate: 48_000,
		positionFrame: 12_000,
		playbackRate: 2,
	});
	assert.deepEqual(normal, { beatIndex: 1, delaySeconds: 0.25, beatDurationSeconds: 0.5 });
	assert.deepEqual(doubleSpeed, { beatIndex: 1, delaySeconds: 0.125, beatDurationSeconds: 0.25 });
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

test('group selection expands atomically while horizontal and vertical trim relationships stay distinct', async () => {
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
	const secondTrackId = controller.actions.track.add({ name: 'Vertical companions' });
	controller.actions.edit.commit({
		type: 'batch',
		commands: [
			{ type: 'source/add', source: {
				id: 'group-trim-source', storageKey: 'group-trim-source', name: 'group.wav',
				mimeType: 'audio/wav', frameCount: 8_000, channelCount: 1,
			} },
			{ type: 'clip/add', trackId: firstTrackId, clip: {
				id: 'horizontal-left', sourceId: 'group-trim-source', timelineStartFrame: 0,
				sourceStartFrame: 0, durationFrames: 1_000,
			} },
			{ type: 'clip/add', trackId: firstTrackId, clip: {
				id: 'horizontal-right', sourceId: 'group-trim-source', timelineStartFrame: 1_000,
				sourceStartFrame: 1_000, durationFrames: 1_000,
			} },
			{ type: 'clip/group', clipIds: ['horizontal-left', 'horizontal-right'], groupId: 'horizontal-group' },
			{ type: 'clip/add', trackId: firstTrackId, clip: {
				id: 'vertical-top', sourceId: 'group-trim-source', timelineStartFrame: 3_000,
				sourceStartFrame: 3_000, durationFrames: 1_000,
			} },
			{ type: 'clip/add', trackId: secondTrackId, clip: {
				id: 'vertical-bottom', sourceId: 'group-trim-source', timelineStartFrame: 3_000,
				sourceStartFrame: 4_000, durationFrames: 1_000,
			} },
			{ type: 'clip/group', clipIds: ['vertical-top', 'vertical-bottom'], groupId: 'vertical-group' },
		],
	});

	controller.actions.timeline.selectClip('horizontal-left');
	assert.deepEqual(
		new Set(controller.getSnapshot().project.selection.clipIds),
		new Set(['horizontal-left', 'horizontal-right']),
	);
	controller.actions.clip.trim('horizontal-left', { durationFrames: 800 });
	let clips = Object.fromEntries(controller.getSnapshot().project.clips.map((clip) => [clip.id, clip]));
	assert.equal(clips['horizontal-left'].durationFrames, 800);
	assert.equal(clips['horizontal-right'].durationFrames, 1_000);

	controller.actions.timeline.selectClip('vertical-top');
	assert.deepEqual(
		new Set(controller.getSnapshot().project.selection.clipIds),
		new Set(['vertical-top', 'vertical-bottom']),
	);
	controller.actions.clip.trim('vertical-top', { durationFrames: 750 });
	clips = Object.fromEntries(controller.getSnapshot().project.clips.map((clip) => [clip.id, clip]));
	assert.equal(clips['vertical-top'].durationFrames, 750);
	assert.equal(clips['vertical-bottom'].durationFrames, 750);
	controller.actions.timeline.selectClip('vertical-top', { toggle: true });
	assert.deepEqual(controller.getSnapshot().project.selection.clipIds, []);
	assert.equal(controller.getSnapshot().selectedClipId, null);
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

test('controller copies and atomically replaces realtime effect stacks across tracks', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;

	const sourceTrackId = controller.getSnapshot().project.tracks[0].id;
	const destinationTrackId = controller.actions.track.add({ name: 'Destination' });
	const emptyTrackId = controller.actions.track.add({ name: 'Empty' });
	const highpassId = controller.actions.effects.add({
		scope: 'track',
		trackId: sourceTrackId,
		type: 'highpass',
		options: { params: { frequency: 240, q: 1.25 } },
	});
	const delayId = controller.actions.effects.add({
		scope: 'track',
		trackId: sourceTrackId,
		type: 'delay',
		options: { enabled: false, params: { time: 0.375, feedback: 0.45, mix: 0.3 } },
	});
	const replacedId = controller.actions.effects.add({
		scope: 'track',
		trackId: destinationTrackId,
		type: 'compressor',
		options: { params: { threshold: -18, knee: 12, ratio: 3, attack: 0.01, release: 0.2, makeupGain: 2 } },
	});

	const copied = controller.actions.effects.copyStack('track', sourceTrackId);
	assert.equal(controller.getSnapshot().effects.hasStackClipboard, true);
	assert.deepEqual(copied.map(({ id, type }) => ({ id, type })), [
		{ id: highpassId, type: 'highpass' },
		{ id: delayId, type: 'delay' },
	]);
	const historyBeforePaste = controller.getSnapshot().history.undoEntries.length;
	controller.actions.effects.pasteStack('track', destinationTrackId);

	let snapshot = controller.getSnapshot();
	let destinationEffects = snapshot.project.tracks.find((track) => track.id === destinationTrackId).effects;
	assert.deepEqual(destinationEffects.map(({ type, enabled, params }) => ({ type, enabled, params })), [
		{ type: 'highpass', enabled: true, params: { frequency: 240, q: 1.25 } },
		{ type: 'delay', enabled: false, params: { time: 0.375, feedback: 0.45, mix: 0.3 } },
	]);
	assert.ok(destinationEffects.every((effect) => ![highpassId, delayId, replacedId].includes(effect.id)));
	assert.equal(snapshot.history.undoEntries.length, historyBeforePaste + 1);
	assert.deepEqual(snapshot.history.undoEntries[0], {
		type: 'batch',
		commandCount: 3,
		commands: ['effect/remove', 'effect/add', 'effect/add'],
	});

	controller.actions.edit.undo();
	snapshot = controller.getSnapshot();
	destinationEffects = snapshot.project.tracks.find((track) => track.id === destinationTrackId).effects;
	assert.deepEqual(destinationEffects.map(({ id, type }) => ({ id, type })), [
		{ id: replacedId, type: 'compressor' },
	]);
	controller.actions.edit.redo();
	snapshot = controller.getSnapshot();
	destinationEffects = snapshot.project.tracks.find((track) => track.id === destinationTrackId).effects;
	assert.deepEqual(destinationEffects.map((effect) => effect.type), ['highpass', 'delay']);

	assert.deepEqual(controller.actions.effects.copyStack('track', emptyTrackId), []);
	const historyBeforeClear = controller.getSnapshot().history.undoEntries.length;
	controller.actions.effects.pasteStack('track', destinationTrackId);
	snapshot = controller.getSnapshot();
	assert.deepEqual(snapshot.project.tracks.find((track) => track.id === destinationTrackId).effects, []);
	assert.equal(snapshot.history.undoEntries.length, historyBeforeClear + 1);
	assert.deepEqual(snapshot.history.undoEntries[0], {
		type: 'batch',
		commandCount: 2,
		commands: ['effect/remove', 'effect/remove'],
	});
	controller.actions.edit.undo();
	assert.deepEqual(
		controller.getSnapshot().project.tracks.find((track) => track.id === destinationTrackId).effects.map((effect) => effect.type),
		['highpass', 'delay'],
	);
	await controller.dispose();
});

test('video effect gestures publish transient previews and commit one undo entry or cancel cleanly', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		productId: 'framescaper',
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [
			{ type: 'source/add', source: {
				kind: 'video', id: 'gesture-video-source', storageKey: 'gesture-video-source',
				name: 'gesture.webm', mimeType: 'video/webm', frameCount: 48_000, sampleRate: 48_000,
				width: 1_280, height: 720, frameRate: 30, videoCodec: 'vp9', hasAudio: false,
			} },
			{ type: 'track/add', track: {
				type: 'video', id: 'gesture-video-track', name: 'Video', clipIds: [],
			} },
			{ type: 'clip/add', trackId: 'gesture-video-track', clip: {
				kind: 'video', id: 'gesture-video-clip', sourceId: 'gesture-video-source', title: 'Gesture',
				timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000,
				durationFrames: 48_000, videoEffects: [],
			} },
		],
	});
	const effectId = controller.actions.video.effects.add(
		'gesture-video-clip',
		'pixelate',
		{ id: 'gesture-pixelate' },
	);
	assert.equal(effectId, 'gesture-pixelate');
	const historyBeforeBypass = controller.getSnapshot().history.undoEntries.length;
	assert.throws(
		() => controller.actions.video.effects.bypass('gesture-video-clip', effectId, 'yes'),
		/must be boolean/,
	);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyBeforeBypass);
	controller.actions.video.effects.bypass('gesture-video-clip', effectId);
	assert.equal(controller.project.clips[0].videoEffects[0].enabled, false);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyBeforeBypass + 1);
	controller.actions.edit.undo();
	assert.equal(controller.project.clips[0].videoEffects[0].enabled, true);
	controller.actions.edit.redo();
	assert.equal(controller.project.clips[0].videoEffects[0].enabled, false);
	controller.actions.video.effects.bypass('gesture-video-clip', effectId, false);
	assert.equal(controller.project.clips[0].videoEffects[0].enabled, true);
	const historyBeforeGesture = controller.getSnapshot().history.undoEntries.length;

	assert.deepEqual(controller.actions.video.effects.beginGesture('gesture-video-clip', effectId), { blockSize: 16 });
	controller.actions.video.effects.preview('gesture-video-clip', effectId, { blockSize: 24 });
	controller.actions.video.effects.preview('gesture-video-clip', effectId, { blockSize: 32 });
	assert.equal(
		controller.getSnapshot().project.clips[0].videoEffects[0].params.blockSize,
		32,
		'the document snapshot exposes the transient preview',
	);
	assert.equal(
		controller.project.clips[0].videoEffects[0].params.blockSize,
		16,
		'the persisted history project remains unchanged during preview',
	);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyBeforeGesture);

	controller.actions.video.effects.commit('gesture-video-clip', effectId);
	assert.equal(controller.project.clips[0].videoEffects[0].params.blockSize, 32);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyBeforeGesture + 1);
	controller.actions.edit.undo();
	assert.equal(controller.project.clips[0].videoEffects[0].params.blockSize, 16);
	controller.actions.edit.redo();
	assert.equal(controller.project.clips[0].videoEffects[0].params.blockSize, 32);

	const historyBeforeCancel = controller.getSnapshot().history.undoEntries.length;
	controller.actions.video.effects.beginGesture('gesture-video-clip', effectId);
	controller.actions.video.effects.preview('gesture-video-clip', effectId, { blockSize: 64 });
	assert.equal(controller.getSnapshot().project.clips[0].videoEffects[0].params.blockSize, 64);
	assert.equal(controller.actions.video.effects.cancel('gesture-video-clip', effectId), true);
	assert.equal(controller.getSnapshot().project.clips[0].videoEffects[0].params.blockSize, 32);
	assert.equal(controller.project.clips[0].videoEffects[0].params.blockSize, 32);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyBeforeCancel);

	const colorEffectId = controller.actions.video.effects.add(
		'gesture-video-clip',
		'color-adjust',
		{ id: 'gesture-color-adjust' },
	);
	const historyBeforeMultiParameterGesture = controller.getSnapshot().history.undoEntries.length;
	controller.actions.video.effects.beginGesture('gesture-video-clip', colorEffectId);
	controller.actions.video.effects.preview('gesture-video-clip', colorEffectId, { brightness: 0.25 });
	controller.actions.video.effects.preview('gesture-video-clip', colorEffectId, { contrast: 1.5 });
	assert.deepEqual(controller.getSnapshot().project.clips[0].videoEffects[1].params, {
		brightness: 0.25,
		contrast: 1.5,
		saturation: 1,
		gamma: 1,
		hueDegrees: 0,
	});
	assert.deepEqual(controller.project.clips[0].videoEffects[1].params, {
		brightness: 0,
		contrast: 1,
		saturation: 1,
		gamma: 1,
		hueDegrees: 0,
	});
	controller.actions.video.effects.commit('gesture-video-clip', colorEffectId);
	assert.deepEqual(controller.project.clips[0].videoEffects[1].params, {
		brightness: 0.25,
		contrast: 1.5,
		saturation: 1,
		gamma: 1,
		hueDegrees: 0,
	});
	assert.equal(
		controller.getSnapshot().history.undoEntries.length,
		historyBeforeMultiParameterGesture + 1,
	);

	controller.actions.track.duplicate('gesture-video-track');
	const duplicatedSnapshot = controller.getSnapshot();
	const duplicatedTrack = duplicatedSnapshot.project.tracks.find((track) => (
		track.type === 'video' && track.id !== 'gesture-video-track'
	));
	assert.ok(duplicatedTrack);
	assert.equal(duplicatedTrack.laneGroupId, null);
	const originalClip = duplicatedSnapshot.project.clips.find((clip) => clip.id === 'gesture-video-clip');
	const duplicatedClip = duplicatedSnapshot.project.clips.find((clip) => duplicatedTrack.clipIds.includes(clip.id));
	assert.ok(duplicatedClip);
	assert.equal(duplicatedClip.avLinkId, null);
	assert.deepEqual(
		duplicatedClip.videoEffects.map((effect) => ({
			type: effect.type,
			enabled: effect.enabled,
			params: effect.params,
		})),
		originalClip.videoEffects.map((effect) => ({
			type: effect.type,
			enabled: effect.enabled,
			params: effect.params,
		})),
	);
	assert.equal(
		duplicatedClip.videoEffects.some((effect) => (
			originalClip.videoEffects.some((originalEffect) => originalEffect.id === effect.id)
		)),
		false,
	);

	controller.actions.video.effects.beginGesture('gesture-video-clip', effectId);
	controller.actions.video.effects.preview('gesture-video-clip', effectId, { blockSize: 48 });
	assert.equal(controller.getSnapshot().project.clips
		.find((clip) => clip.id === 'gesture-video-clip').videoEffects[0].params.blockSize, 48);
	controller.actions.edit.undo();
	assert.equal(controller.getSnapshot().project.tracks.filter((track) => track.type === 'video').length, 1);
	assert.equal(controller.getSnapshot().project.clips
		.find((clip) => clip.id === 'gesture-video-clip').videoEffects[0].params.blockSize, 32);
	controller.actions.edit.redo();
	assert.equal(controller.getSnapshot().project.tracks.filter((track) => track.type === 'video').length, 2);
	assert.equal(controller.getSnapshot().project.clips
		.find((clip) => clip.id === 'gesture-video-clip').videoEffects[0].params.blockSize, 32);
	await controller.dispose();
});

test('rack effect gestures preview Delay live and commit once without rebuilding playback', async () => {
	const engine = createMemoryEngine();
	engine.rackConfigurations = [];
	engine.configureRackEffect = function configureRackEffect(scope, targetId, effectId, params) {
		this.rackConfigurations.push({ scope, targetId, effectId, params: structuredClone(params) });
		return this.rackConfigurations.length;
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine,
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project.tracks[0].id;
	const effectId = controller.actions.effects.add({
		scope: 'track',
		trackId,
		type: 'delay',
		options: { params: { time: 0.25, feedback: 0.3, mix: 0.2 } },
	});
	await Promise.resolve();
	await Promise.resolve();
	engine.appliedProjects.length = 0;
	engine.play();

	const before = controller.getSnapshot();
	controller.actions.effects.beginRackEffectGesture('track', trackId, effectId);
	controller.actions.effects.previewRackEffect('track', trackId, effectId, {
		time: 0.5,
		feedback: 0.6,
		mix: 0.4,
	});
	assert.deepEqual(engine.rackConfigurations.at(-1).params, {
		time: 0.5,
		feedback: 0.6,
		mix: 0.4,
	});
	assert.deepEqual(before.project.tracks[0].effects[0].params, {
		time: 0.25,
		feedback: 0.3,
		mix: 0.2,
	});

	controller.actions.effects.commitRackEffectGesture('track', trackId, effectId, {
		time: 0.5,
		feedback: 0.6,
		mix: 0.4,
	});
	const committed = controller.getSnapshot();
	assert.deepEqual(committed.project.tracks[0].effects[0].params, {
		time: 0.5,
		feedback: 0.6,
		mix: 0.4,
	});
	assert.equal(committed.history.undoEntries.length, before.history.undoEntries.length + 1);
	assert.equal(engine.appliedProjects.length, 0);
	assert.equal(engine.state, 'playing');

	controller.actions.effects.beginRackEffectGesture('track', trackId, effectId);
	controller.actions.effects.previewRackEffect('track', trackId, effectId, { feedback: 0.1 });
	controller.actions.effects.cancelRackEffectGesture('track', trackId, effectId);
	assert.deepEqual(engine.rackConfigurations.at(-1).params, {
		time: 0.5,
		feedback: 0.6,
		mix: 0.4,
	});
	assert.equal(controller.getSnapshot().history.undoEntries.length, committed.history.undoEntries.length);
	await controller.dispose();
});

test('parametric EQ gestures preview live and commit one history entry without rebuilding playback', async () => {
	const engine = createMemoryEngine();
	engine.eqConfigurations = [];
	engine.eqAuditions = [];
	engine.configureParametricEq = function configureParametricEq(scope, targetId, effectId, params) {
		this.eqConfigurations.push({ scope, targetId, effectId, params: structuredClone(params) });
		return this.eqConfigurations.length;
	};
	engine.auditionParametricEq = function auditionParametricEq(scope, targetId, effectId, bandId) {
		this.eqAuditions.push({ scope, targetId, effectId, bandId });
		return this.eqAuditions.length;
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine,
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project.tracks[0].id;
	const effectId = controller.actions.effects.add({ scope: 'track', trackId, type: 'eq' });
	await Promise.resolve();
	await Promise.resolve();
	engine.appliedProjects.length = 0;

	const before = controller.getSnapshot();
	const original = before.project.tracks[0].effects.find((effect) => effect.id === effectId).params;
	const preview = structuredClone(original);
	preview.bands[0].gain = 9;
	controller.actions.effects.beginParametricEqGesture('track', trackId, effectId);
	controller.actions.effects.previewParametricEq('track', trackId, effectId, preview);
	assert.equal(engine.eqConfigurations.at(-1).params.bands[0].gain, 9);
	assert.equal(controller.getSnapshot().project.tracks[0].effects[0].params.bands[0].gain, 0);

	const finalParams = structuredClone(preview);
	finalParams.bands[0].gain = 12;
	controller.actions.effects.commitParametricEqGesture('track', trackId, effectId, finalParams);
	const committed = controller.getSnapshot();
	assert.equal(committed.project.tracks[0].effects[0].params.bands[0].gain, 12);
	assert.equal(committed.history.undoEntries.length, before.history.undoEntries.length + 1);
	assert.equal(engine.appliedProjects.length, 0);

	controller.actions.effects.beginParametricEqGesture('track', trackId, effectId);
	const cancelled = structuredClone(finalParams);
	cancelled.bands[0].gain = -18;
	controller.actions.effects.previewParametricEq('track', trackId, effectId, cancelled);
	controller.actions.effects.cancelParametricEqGesture('track', trackId, effectId);
	assert.equal(engine.eqConfigurations.at(-1).params.bands[0].gain, 12);
	assert.equal(controller.getSnapshot().history.undoEntries.length, committed.history.undoEntries.length);
	const invalid = structuredClone(finalParams);
	invalid.bands[0].gain = Number.NaN;
	const configurationCount = engine.eqConfigurations.length;
	assert.throws(
		() => controller.actions.effects.previewParametricEq('track', trackId, effectId, invalid),
		/eq\.bands\[0\]\.gain must be between -24 and 24/,
	);
	assert.equal(engine.eqConfigurations.length, configurationCount);
	controller.actions.effects.auditionParametricEq('track', trackId, effectId, finalParams.bands[0].id);
	assert.equal(engine.eqAuditions.at(-1).bandId, finalParams.bands[0].id);
	await controller.dispose();
});

test('controller renders a macro as an ordered isolated rack and persists one destructive history edit', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `controller-effect-macro-${Date.now()}-${Math.random()}`,
	});
	const sourceId = 'controller-macro-source';
	const input = new Float32Array(64).fill(0.1);
	const writer = await store.beginSourceWrite(sourceId, {
		name: 'macro.wav', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1,
	});
	await writer.write([input]);
	await writer.commit({ sampleRate: 48_000, channelCount: 1 });
	const project = createAudioEditorProjectV2({
		id: 'controller-macro-project',
		title: 'Macro project',
		now: '2026-07-15T00:00:00.000Z',
		sources: [{
			id: sourceId,
			name: 'macro.wav',
			mimeType: 'audio/wav',
			storageKey: sourceId,
			frameCount: input.length,
			channelCount: 1,
			sampleRate: 48_000,
			originalSampleRate: 48_000,
			sampleFormat: 'float32',
			chunkFrames: 65_536,
		}],
		tracks: [{ type: 'audio', id: 'controller-macro-track', name: 'Macro source', clipIds: ['controller-macro-clip'] }],
		clips: [{
			id: 'controller-macro-clip',
			sourceId,
			title: 'Macro source',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: input.length,
			durationFrames: input.length,
		}],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const renderCalls = [];
	let failRender = false;
	const output = new Float32Array(input.length).fill(0.75);
	const renderSnapshot = async (snapshot, range) => {
		renderCalls.push({ snapshot: structuredClone(snapshot), range: structuredClone(range) });
		if (failRender) throw new Error('Macro render failed.');
		return audioBuffer([output.slice()], snapshot.sampleRate);
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
		const existingRackEffectId = controller.actions.effects.add({
			scope: 'track',
			trackId: 'controller-macro-track',
			type: 'reverb',
			options: { params: { mix: 0.1, decay: 1.5, preDelay: 0.02 } },
		});
		controller.actions.timeline.selectTrack('controller-macro-track');
		controller.actions.timeline.setSelection(0, input.length);
		const historyBeforeRun = controller.getSnapshot().history.undoEntries.length;

		const request = {
			name: 'Voice polish',
			trackId: 'controller-macro-track',
			effects: [{
				id: 'macro-delay',
				type: 'delay',
				enabled: true,
				params: { time: 0.125, feedback: 0.2, mix: 0.4 },
			}, {
				id: 'macro-invert',
				type: 'audacity-invert',
				enabled: true,
				params: {},
			}],
		};
		const run = controller.actions.macros.run(request);
		const duplicate = controller.actions.macros.run(request);
		assert.equal(await duplicate, null);
		const result = await run;
		assert.equal(result, true);
		assert.equal(renderCalls.length, 1);
		const renderedTrack = renderCalls[0].snapshot.tracks.find((track) => track.id === 'controller-macro-track');
		assert.deepEqual(renderedTrack.effects.map(({ type, enabled, params }) => ({ type, enabled, params })), [{
			type: 'delay',
			enabled: true,
			params: { time: 0.125, feedback: 0.2, mix: 0.4 },
		}, {
			type: 'audacity-invert',
			enabled: true,
			params: {},
		}]);
		assert.ok(renderedTrack.effects.every((effect) => !['macro-delay', 'macro-invert'].includes(effect.id)));
		assert.deepEqual(renderCalls[0].range, {
			startFrame: 0,
			endFrame: input.length,
			trackId: 'controller-macro-track',
			includeMaster: false,
			includeTrackPan: false,
			respectMuteSolo: false,
			outputFrames: input.length,
			preRollFrames: 0,
		});
		assert.deepEqual(renderCalls[0].snapshot.master.effects, []);
		assert.equal(renderedTrack.gain, 1);
		assert.equal(renderedTrack.pan, 0);

		let snapshot = controller.getSnapshot();
		const liveTrack = snapshot.project.tracks.find((track) => track.id === 'controller-macro-track');
		assert.deepEqual(liveTrack.effects.map((effect) => effect.id), [existingRackEffectId]);
		const replacementClip = snapshot.project.clips.find((clip) => liveTrack.clipIds.includes(clip.id));
		assert.notEqual(replacementClip.sourceId, sourceId);
		assert.equal(await storedSample(store, replacementClip.sourceId, 0), 0.75);
		assert.equal(snapshot.history.undoEntries.length, historyBeforeRun + 1);
		assert.deepEqual(snapshot.history.undoEntries[0], {
			type: 'batch',
			commandCount: 2,
			commands: ['range/replace', 'selection/set'],
		});

		controller.actions.edit.undo();
		snapshot = controller.getSnapshot();
		const restoredTrack = snapshot.project.tracks.find((track) => track.id === 'controller-macro-track');
		assert.deepEqual(restoredTrack.effects.map((effect) => effect.id), [existingRackEffectId]);
		assert.deepEqual(restoredTrack.clipIds, ['controller-macro-clip']);
		assert.equal(snapshot.project.clips.find((clip) => clip.id === 'controller-macro-clip').sourceId, sourceId);

		failRender = true;
		const historyBeforeFailure = snapshot.history.undoEntries.length;
		await assert.rejects(controller.actions.macros.run(request), /Macro render failed/);
		snapshot = controller.getSnapshot();
		assert.equal(snapshot.processingEffect, false);
		assert.equal(snapshot.status.state, 'error');
		assert.match(snapshot.status.message, /Macro render failed/);
		assert.equal(snapshot.history.undoEntries.length, historyBeforeFailure);
	} finally {
		await controller.dispose();
	}
});

test('controller rejects oversized macro renders before allocating or editing', async () => {
	let renderCalls = 0;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		renderSnapshot: async () => {
			renderCalls += 1;
			throw new Error('The oversized macro must not reach the renderer.');
		},
	});
	try {
		await controller.ready;
		const trackId = controller.getSnapshot().project.tracks[0].id;
		const frameCount = 48_000 * 60 * 20;
		controller.actions.edit.commit({
			type: 'batch',
			commands: [{
				type: 'source/add',
				source: {
					id: 'oversized-macro-source',
					name: 'oversized.wav',
					storageKey: 'oversized-macro-source',
					mimeType: 'audio/wav',
					frameCount,
					channelCount: 2,
				},
			}, {
				type: 'clip/add',
				trackId,
				clip: {
					id: 'oversized-macro-clip',
					sourceId: 'oversized-macro-source',
					timelineStartFrame: 0,
					sourceStartFrame: 0,
					durationFrames: frameCount,
				},
			}],
		});
		controller.actions.timeline.selectTrack(trackId);
		controller.actions.timeline.setSelection(0, frameCount);
		const historyBeforeRun = controller.getSnapshot().history.undoEntries.length;
		await assert.rejects(controller.actions.macros.run({
			name: 'Oversized macro',
			trackId,
			effects: [{ type: 'audacity-invert', params: {} }],
		}), /too much memory/i);
		assert.equal(renderCalls, 0);
		assert.equal(controller.getSnapshot().processingEffect, false);
		assert.equal(controller.getSnapshot().history.undoEntries.length, historyBeforeRun);
	} finally {
		await controller.dispose();
	}
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
	assert.throws(() => controller.actions.sampleEdit.setMode('pencil'), /one pixel per sample/);
	controller.actions.timeline.setZoom(48_000);
	assert.equal(controller.getSnapshot().sampleEdit.available, true);
	assert.equal(controller.getSnapshot().sampleEdit.mode, 'pencil');
	controller.actions.sampleEdit.setMode(null);
	assert.equal(controller.getSnapshot().sampleEdit.mode, null);
	controller.actions.timeline.setZoom(100);
	assert.equal(controller.getSnapshot().sampleEdit.available, false);
	controller.actions.timeline.setZoom(48_000);
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

test('controller surfaces parametric EQ processor failures and unsubscribes on disposal', async () => {
	const engine = createMemoryEngine();
	const listeners = new Set();
	let unsubscribeCalls = 0;
	engine.subscribeParametricEqErrors = (listener) => {
		listeners.add(listener);
		return () => {
			unsubscribeCalls += 1;
			listeners.delete(listener);
		};
	};
	engine.emitParametricEqError = (error) => {
		for (const listener of listeners) listener(error);
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store: createMemoryStore(),
		engine,
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;

	engine.emitParametricEqError({
		type: 'error',
		message: 'mock EQ processor failure',
		scope: 'track',
		targetId: 'track-1',
		effectId: 'track-eq',
	});
	assert.deepEqual(controller.getSnapshot().status, {
		message: 'Error: mock EQ processor failure',
		state: 'error',
	});

	await controller.dispose();
	const disposed = controller.getSnapshot();
	assert.equal(unsubscribeCalls, 1);
	assert.equal(listeners.size, 0);
	engine.emitParametricEqError({ type: 'error', message: 'late EQ processor failure' });
	assert.strictEqual(controller.getSnapshot(), disposed);
});

test('canceling an asynchronous parametric EQ selection preview prevents a late source from starting', async () => {
	const engine = createMemoryEngine();
	const renderStarted = deferred();
	const renderGate = deferred();
	let previewCreations = 0;
	let previewStarts = 0;
	engine.createParametricEqPreview = async () => {
		previewCreations += 1;
		return {
			start() { previewStarts += 1; },
			stop() {},
			disconnect() {},
		};
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store: createMemoryStore(),
		engine,
		ffmpeg: createMemoryFfmpeg(),
		renderSnapshot: async () => {
			renderStarted.resolve();
			await renderGate.promise;
			return new MockAudioBuffer(1, 4_800, 48_000);
		},
	});
	try {
		await controller.ready;
		installSelectionPreviewFixture(controller);
		const pending = controller.actions.effects.previewSelection({ type: 'eq' });
		await renderStarted.promise;
		assert.equal(controller.getSnapshot().processingEffect, true);

		assert.equal(controller.actions.effects.cancelPreview(), false);
		renderGate.resolve();
		assert.equal(await pending, false);
		assert.equal(previewCreations, 0);
		assert.equal(previewStarts, 0);
		assert.equal(controller.getSnapshot().effects.previewing, false);
		assert.equal(controller.getSnapshot().processingEffect, false);
	} finally {
		renderGate.resolve();
		await controller.dispose();
	}
});

test('parametric EQ selection preview errors stop the source and cannot be overwritten by a late ending', async () => {
	const engine = createMemoryEngine();
	const listeners = new Set();
	engine.subscribeParametricEqErrors = (listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	engine.emitParametricEqError = (error) => {
		for (const listener of listeners) listener(error);
	};
	const preview = {
		onended: null,
		onerror: null,
		startCalls: 0,
		stopCalls: 0,
		disconnectCalls: 0,
		start() { this.startCalls += 1; },
		stop() { this.stopCalls += 1; },
		disconnect() { this.disconnectCalls += 1; },
	};
	engine.createParametricEqPreview = async () => preview;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store: createMemoryStore(),
		engine,
		ffmpeg: createMemoryFfmpeg(),
		renderSnapshot: async () => new MockAudioBuffer(1, 4_800, 48_000),
	});
	try {
		await controller.ready;
		installSelectionPreviewFixture(controller);
		assert.equal(await controller.actions.effects.previewSelection({ type: 'eq' }), true);
		assert.equal(preview.startCalls, 1);
		assert.equal(controller.getSnapshot().effects.previewing, true);
		const lateEnded = preview.onended;

		const error = { type: 'error', message: 'mock selection EQ processor failure' };
		engine.emitParametricEqError(error);
		preview.onerror(error);
		assert.equal(preview.stopCalls, 1);
		assert.equal(preview.disconnectCalls, 1);
		assert.equal(preview.onended, null);
		assert.equal(controller.getSnapshot().effects.previewing, false);
		assert.deepEqual(controller.getSnapshot().status, {
			message: 'Error: mock selection EQ processor failure',
			state: 'error',
		});

		lateEnded();
		assert.deepEqual(controller.getSnapshot().status, {
			message: 'Error: mock selection EQ processor failure',
			state: 'error',
		});
		assert.equal(preview.disconnectCalls, 1);
	} finally {
		await controller.dispose();
	}
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

test('reopening the active project retains its writer lock', async () => {
	let acquisitions = 0;
	let releases = 0;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		acquireProjectLock: async (projectId) => {
			acquisitions += 1;
			return {
				projectId,
				readOnly: false,
				method: 'test',
				release() { releases += 1; },
			};
		},
	});
	await controller.ready;
	const projectId = controller.getSnapshot().project.id;
	await controller.actions.project.openById(projectId);
	assert.equal(controller.getSnapshot().readOnly, false);
	assert.equal(acquisitions, 1);
	assert.equal(releases, 0);
	await controller.dispose();
	assert.equal(releases, 1);
});

test('a read-only project automatically becomes writable after its competing lock disappears', async () => {
	let acquisitions = 0;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		acquireProjectLock: async (projectId) => {
			acquisitions += 1;
			return {
				projectId,
				readOnly: acquisitions === 1,
				method: 'test',
				retryAt: Date.now(),
				release() {},
			};
		},
	});
	await controller.ready;
	assert.equal(controller.getSnapshot().readOnly, true);
	await new Promise((resolve) => setTimeout(resolve, 150));
	assert.equal(controller.getSnapshot().readOnly, false);
	assert.equal(controller.getSnapshot().status.message, COPY.ready);
	assert.equal(acquisitions, 2);
	await controller.dispose();
});

test('project flush serializes the latest snapshot and rejects persistence failures', async () => {
	const store = createMemoryStore();
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
	const firstSave = deferred();
	const persistedNames = [];
	let saveCount = 0;
	store.saveProject = async (project) => {
		saveCount += 1;
		if (saveCount === 1) await firstSave.promise;
		persistedNames.push(project.tracks[0].name);
		store.projects.set(project.id, structuredClone(project));
		return structuredClone(project);
	};

	controller.actions.track.update(trackId, { name: 'First pending name' });
	const pendingFlush = controller.actions.project.flush();
	await Promise.resolve();
	controller.actions.track.update(trackId, { name: 'Latest name' });
	const latestFlush = controller.actions.project.flush();
	firstSave.resolve();
	await Promise.all([pendingFlush, latestFlush]);
	assert.deepEqual(persistedNames, ['First pending name', 'Latest name']);
	assert.equal(store.projects.get(controller.getSnapshot().project.id).tracks[0].name, 'Latest name');

	store.saveProject = async () => { throw new Error('disk full'); };
	controller.actions.track.update(trackId, { name: 'Cannot persist' });
	await assert.rejects(() => controller.actions.project.flush(), /disk full/);
	assert.equal(controller.getSnapshot().save.state, 'dirty');
	assert.match(controller.getSnapshot().status.message, /disk full/);
	await controller.dispose();
});

function createMemoryStore() {
	const projects = new Map();
	const settings = new Map();
	const analysis = new Map();
	const mediaAssets = new Map();
	const videoDerivatives = new Map();
	const audioSources = new Map();
	return {
		projects,
		settings,
		analysis,
		mediaAssets,
		videoDerivatives,
		audioSources,
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
		async loadSourceAudioBuffer(sourceId, context) {
			const channels = audioSources.get(sourceId);
			if (!channels) throw new Error(`Missing test PCM source ${sourceId}.`);
			const buffer = context.createBuffer(channels.length, channels[0].length, 48_000);
			for (let channel = 0; channel < channels.length; channel += 1) {
				buffer.copyToChannel(channels[channel], channel);
			}
			return buffer;
		},
		async loadMediaAsset(sourceId) { return mediaAssets.get(sourceId) || null; },
		async listVideoDerivatives(sourceId) {
			return (videoDerivatives.get(sourceId) || []).map(({ blob, ...descriptor }) => structuredClone(descriptor));
		},
		async loadVideoDerivative(sourceId, descriptor) {
			const derivative = (videoDerivatives.get(sourceId) || []).find((candidate) => (
				candidate.type === descriptor.type && candidate.timestamp === descriptor.timestamp
			));
			return derivative?.blob || null;
		},
		async pruneUnreferencedSources(options = {}) { this.pruneCalls.push(options); return { deletedSourceIds: [] }; },
		async estimateStorage() { return { usage: 0, quota: 64 * 1024 * 1024 }; },
		async close() { this.closeCalls += 1; },
	};
}

function createPersistedVideoProject({ projectBin = false, timeline = false } = {}) {
	const frameCount = 48_000;
	const videoSource = createVideoSourceV4({
		id: 'persisted-video-source',
		name: 'persisted-camera.mp4',
		mimeType: 'video/mp4',
		storageKey: 'persisted-video-source',
		frameCount,
		sampleRate: 48_000,
		width: 640,
		height: 360,
		frameRate: 25,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
		opaqueExtensions: { byteLength: 15 },
	});
	const audioSource = createAudioSourceV4({
		id: 'persisted-audio-source',
		name: 'persisted camera audio',
		storageKey: 'persisted-audio-source',
		frameCount,
		channelCount: 2,
		sampleRate: 48_000,
	});
	const binClips = projectBin
		? [
			createVideoClipV4({
				id: 'persisted-bin-video',
				sourceId: videoSource.id,
				title: 'Persisted scene',
				sourceStartFrame: 0,
				sourceDurationFrames: frameCount,
				durationFrames: frameCount,
				binItemId: 'persisted-bin-item',
			}),
			createAudioClipV4({
				id: 'persisted-bin-audio',
				sourceId: audioSource.id,
				title: 'Persisted scene',
				sourceStartFrame: 0,
				sourceDurationFrames: frameCount,
				durationFrames: frameCount,
				binItemId: 'persisted-bin-item',
			}),
		]
		: [];
	const avLinkId = timeline ? 'persisted-av-link' : null;
	const timelineClips = timeline
		? [
			createVideoClipV4({
				id: 'persisted-timeline-video',
				sourceId: videoSource.id,
				title: 'Timeline scene',
				sourceStartFrame: 0,
				sourceDurationFrames: frameCount,
				durationFrames: frameCount,
				avLinkId,
			}),
			createAudioClipV4({
				id: 'persisted-timeline-audio',
				sourceId: audioSource.id,
				title: 'Timeline scene audio',
				sourceStartFrame: 0,
				sourceDurationFrames: frameCount,
				durationFrames: frameCount,
				avLinkId,
			}),
		]
		: [];
	const laneGroupId = timeline ? 'persisted-lane-group' : null;
	const tracks = timeline
		? [{
			type: 'video',
			id: 'persisted-video-track',
			name: 'Persisted video',
			clipIds: ['persisted-timeline-video'],
			mute: false,
			hidden: false,
			collapsed: false,
			height: 96,
			laneGroupId,
			opaqueExtensions: {},
		}, {
			type: 'audio',
			id: 'persisted-audio-track',
			name: 'Persisted audio',
			clipIds: ['persisted-timeline-audio'],
			mute: false,
			solo: false,
			armed: false,
			gain: 1,
			pan: 0,
			channelCount: 2,
			color: 'auto',
			effects: [],
			laneGroupId,
			opaqueExtensions: {},
		}]
		: [];
	const project = createAudioEditorProjectV4({
		id: `persisted-video-project-${projectBin ? 'bin' : 'timeline'}`,
		title: 'Persisted video project',
		now: '2026-07-18T12:00:00.000Z',
		sources: [videoSource, audioSource],
		clips: timelineClips,
		tracks,
		projectBin: { clips: binClips },
	});
	return { project, videoSource, audioSource };
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
		playAtSpeedCalls: [],
		loadProject(project) { this.loadedProjects.push(structuredClone(project)); },
		async applyProject(project) { this.appliedProjects.push(structuredClone(project)); },
		getPositionFrames() { return this.positionFrame; },
		getState() { return { state: this.state, loop: { enabled: false } }; },
		stop() { this.state = 'stopped'; },
		play() { this.state = 'playing'; },
		async playAtSpeed(rate, options) { this.playAtSpeedCalls.push({ rate, options }); this.state = 'playing'; },
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

function installSelectionPreviewFixture(controller) {
	const trackId = controller.getSnapshot().project.tracks[0].id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [{
			type: 'source/add',
			source: {
				id: 'selection-preview-source',
				name: 'preview.wav',
				storageKey: 'selection-preview-source',
				mimeType: 'audio/wav',
				frameCount: 4_800,
				channelCount: 1,
				sampleRate: 48_000,
				originalSampleRate: 48_000,
			},
		}, {
			type: 'clip/add',
			trackId,
			clip: {
				id: 'selection-preview-clip',
				sourceId: 'selection-preview-source',
				title: 'Preview',
				timelineStartFrame: 0,
				sourceStartFrame: 0,
				sourceDurationFrames: 4_800,
				durationFrames: 4_800,
			},
		}],
	});
	controller.actions.timeline.selectTrack(trackId);
	controller.actions.timeline.setSelection(0, 4_800);
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

function createVideoMemoryFfmpeg() {
	return {
		videoCalls: [],
		disposeCalls: 0,
		async encodeVideo(videoBlobs, audioMixBlob, plan, options) {
			this.videoCalls.push({ videoBlobs, audioMixBlob, plan, options });
			return {
				bytes: new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode(plan.format)]),
				mimeType: plan.mimeType,
			};
		},
		dispose() { this.disposeCalls += 1; },
	};
}

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createMemoryFfmpeg,
	deferred,
	waitFor,
} from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import {
	COPY,
	createAudioEditorController,
	createMemoryClipTimePitchCache,
	createMemoryEngine,
	createMemoryRenderEngine,
} from './helpers/audio-editor-controller-harness.js';


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
		'project', 'projectBin', 'video', 'edit', 'transport', 'recording', 'capture', 'webVcr', 'metering', 'audioDevices', 'storage', 'timeline', 'timelineAnnotations', 'sequences', 'trackFolders', 'audioWarp', 'takeComp', 'sampleEdit', 'spectral',
		'track', 'mixer', 'generators', 'nyquist', 'labels', 'metadata', 'preferences', 'clip', 'effects', 'macros', 'analysis', 'export', 'media',
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
	assert.deepEqual(controller.getSnapshot().selection, { startFrame: 48_000, endFrame: 96_000, annotationIds: [] });
	assert.deepEqual(controller.getSnapshot().project.selection, { startFrame: 48_000, endFrame: 96_000, annotationIds: [] });

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
		clipIds: ['clip-controller-test', 'clip-controller-second'], annotationIds: [],
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
	assert.deepEqual(controller.getSnapshot().project.selection, { startFrame: 48_000, endFrame: 96_000, annotationIds: [] });
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
	await controller.actions.preferences.movePanel('mixer', { kind: 'tab', targetPanelId: 'effects' });
	workspace = controller.getSnapshot().preferences.workspace;
	assert.equal(workspace.panels.mixer.tabGroup, workspace.panels.effects.tabGroup);
	assert.equal(workspace.panels.mixer.tabActive, true);
	assert.equal(workspace.panels.effects.tabActive, false);
	await controller.actions.preferences.activatePanelTab('effects');
	workspace = controller.getSnapshot().preferences.workspace;
	assert.equal(workspace.panels.mixer.tabActive, false);
	assert.equal(workspace.panels.effects.tabActive, true);
	await controller.actions.preferences.setPanelVisibility('effects', false);
	workspace = controller.getSnapshot().preferences.workspace;
	assert.equal(workspace.panels.effects.visible, false);
	assert.equal(workspace.panels.mixer.tabActive, true);
	await controller.actions.preferences.setPanelVisibility('effects', true);
	await controller.actions.preferences.setPanelFrameSize('effects', 480);
	workspace = controller.getSnapshot().preferences.workspace;
	assert.equal(workspace.panels.effects.size, 480);
	assert.equal(workspace.panels.mixer.size, 480);
	await controller.actions.preferences.setPanelDockExtent('right', { width: 444 });
	workspace = controller.getSnapshot().preferences.workspace;
	assert.equal(workspace.panels.effects.width, 444);
	assert.equal(workspace.panels.mixer.width, 444);
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

test('controller reverts editor preferences to product factory defaults without removing projects', async () => {
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
	const projectId = controller.getSnapshot().project.id;

	await controller.actions.preferences.update({
		appearance: { theme: 'dark', clipStyle: 'classic', layout: 'compact' },
		shortcuts: {},
	});
	await controller.actions.preferences.setWorkspace('music');
	await controller.actions.preferences.revertFactorySettings();

	const snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.id, projectId);
	assert.deepEqual(snapshot.preferences.appearance, { theme: 'system', clipStyle: 'colorful', layout: 'auto', defaultView: 'waveform' });
	assert.equal(snapshot.preferences.workspace.activeId, 'modern');
	assert.ok(Object.keys(snapshot.preferences.shortcuts).length > 0);
	assert.deepEqual(store.settings.get('audio-editor-preferences-v1'), snapshot.preferences);
	assert.equal(store.projects.has(projectId), true);
	await controller.dispose();
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

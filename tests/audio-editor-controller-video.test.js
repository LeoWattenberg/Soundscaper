import test from 'node:test';
import assert from 'node:assert/strict';

import {
	MockAudioBuffer,
	createMemoryFfmpeg,
	createVideoMemoryFfmpeg,
} from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import {
	CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
	COPY,
	availableDesktopVideoExportCapabilities,
	createAudioEditorController,
	createMemoryEngine,
	createPersistedVideoProject,
	resolveRuntimeProjectProjection,
} from './helpers/audio-editor-controller-harness.js';


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
	assert.ok(visual, JSON.stringify({ phase: snapshot.phase, status: snapshot.status, notifications: snapshot.notifications }));
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
	const placedRuntime = resolveRuntimeProjectProjection(placed.project);
	const placedVideo = placedRuntime.clips.find((clip) => clip.id === placedVideoId);
	const placedAudio = placedRuntime.clips.find((clip) => clip.kind === 'audio');
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

test('desktop video export API and generic FFmpeg dispatch stage raw media and audio for MP4 and WebM', async () => {
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
	const renderCalls = [], downloads = [], cleanups = [];
	const fileService = {
		isDesktop: true,
		getDesktopVideoExportCapabilities: availableDesktopVideoExportCapabilities,
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
	assert.ok(mp4);
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
	const mp4Plan = ffmpeg.videoCalls[0].plan;
	assert.deepEqual([mp4Plan.format, mp4Plan.mimeType], ['mp4', 'video/mp4']);
	assert.deepEqual(
		[mp4Plan.version, mp4Plan.canvas.width, mp4Plan.canvas.height, mp4Plan.canvas.fit],
		[CANONICAL_VIDEO_EXPORT_PLAN_VERSION, 640, 360, 'contain'],
	);
	assert.equal(mp4Plan.intervals[0].layers[0].clips[0].clipId, 'persisted-timeline-video');
	assert.equal(renderCalls[0].range.startFrame, 0);
	assert.equal(renderCalls[0].range.endFrame, fixture.videoSource.sampleFrameCount);
	assert.equal(renderCalls[0].range.outputFrames, fixture.videoSource.sampleFrameCount);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ControllerEngine,
	LONG_MONO_SOURCE_FRAMES,
	LONG_STEREO_SOURCE_FRAMES,
	LogicalPcmStore,
	SOURCE_CHUNK_FRAMES,
	audioFile,
	createTestController,
	encodedAudioFile,
	logicalAudioBuffer,
	realAudioBuffer,
	settleController,
	virtualPcm16Wav,
	restoreWorkerAfterSuite,
} from './helpers/audio-editor-disk-backed-harness.js';

restoreWorkerAfterSuite();

test('decoded imports route to the visible project bin and honor exact timeline lane placement', async () => {
	const store = new LogicalPcmStore();
	const engine = new ControllerEngine({
		decoded: [
			realAudioBuffer(128, 0.25),
			realAudioBuffer(96, 0.5),
			realAudioBuffer(64, -0.25),
		],
	});
	const controller = createTestController({ store, engine });

	try {
		await controller.ready;
		const targetTrackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.project.importFiles([audioFile('bin-take.wav')], {
			destination: 'auto',
			projectBinVisible: true,
		});
		let snapshot = controller.getSnapshot();
		assert.equal(snapshot.project.clips.length, 0);
		assert.equal(snapshot.project.projectBin.clips.length, 1);
		const binClip = snapshot.project.projectBin.clips[0];
		assert.equal(binClip.title, 'bin-take');
		assert.equal(controller.actions.projectBin.getVisualData(binClip.id).available, true);

		const placedId = controller.actions.projectBin.place(binClip.id, {
			trackId: targetTrackId,
			timelineStartFrame: 1_234,
		});
		assert.equal(controller.getSnapshot().project.clips.find((clip) => clip.id === placedId).timelineStartFrame, 1_234);

		await controller.actions.project.importFiles([
			audioFile('lane-first.wav'),
			audioFile('lane-second.wav'),
		], {
			destination: 'timeline',
			trackId: targetTrackId,
			timelineStartFrame: 4_321,
		});
		snapshot = controller.getSnapshot();
		const first = snapshot.project.clips.find((clip) => clip.title === 'lane-first');
		const second = snapshot.project.clips.find((clip) => clip.title === 'lane-second');
		assert.equal(first.timelineStartFrame, 4_321);
		assert.equal(second.timelineStartFrame, 4_321);
		assert.equal(snapshot.project.tracks.find((track) => track.id === targetTrackId).clipIds.includes(first.id), true);
		const targetIndex = snapshot.project.tracks.findIndex((track) => track.id === targetTrackId);
		assert.equal(snapshot.project.tracks[targetIndex + 1].clipIds.includes(second.id), true);
		assert.equal(snapshot.project.projectBin.clips.length, 1, 'placing and timeline imports keep the reusable bin item');
	} finally {
		await controller.dispose();
	}
});

test('native decoded imports preserve the encoded source sample rate metadata', async () => {
	const store = new LogicalPcmStore();
	const engine = new ControllerEngine({ decoded: [realAudioBuffer(128, 0.25)] });
	const controller = createTestController({ store, engine });

	try {
		await controller.ready;
		await controller.actions.project.importFiles([encodedAudioFile(
			'original-rate.mp3',
			'audio/mpeg',
			Uint8Array.of(0xff, 0xfb, 0x90, 0),
		)]);
		const source = controller.getSnapshot().project.sources[0];
		assert.equal(source.sampleRate, 48_000, 'native PCM remains at the AudioContext rate');
		assert.equal(source.originalSampleRate, 44_100);
	} finally {
		await controller.dispose();
	}
});

test('an imported source over 32 MiB is persisted and immediately represented by a chunk provider', async () => {
	const store = new LogicalPcmStore();
	const decoded = logicalAudioBuffer({ frameCount: LONG_MONO_SOURCE_FRAMES });
	const engine = new ControllerEngine({ decoded: [decoded] });
	const controller = createTestController({
		store,
		engine,
		// The source fits the global budget, so this specifically verifies the
		// long-source disk policy rather than incidental capacity eviction.
		sourceBufferCacheMaxBytes: 64 * 1024 * 1024,
	});

	try {
		await controller.ready;
		await controller.actions.project.importFiles([audioFile('long.wav')]);

		const snapshot = controller.getSnapshot();
		const source = snapshot.project.sources[0];
		const clip = snapshot.project.clips[0];
		const metadata = await store.getSourceMetadata(source.storageKey);
		assert.equal(metadata.frameCount, LONG_MONO_SOURCE_FRAMES);
		assert.equal(metadata.chunkFrames, SOURCE_CHUNK_FRAMES);
		assert.equal(metadata.chunkCount, Math.ceil(LONG_MONO_SOURCE_FRAMES / SOURCE_CHUNK_FRAMES));
		assert.equal(controller.getClipVisualData(clip.id).buffer, null);
		assert.equal(engine.sourceBuffers.has(source.id), false);
		assert.equal(engine.chunkSources.has(source.id), true);
		assert.equal(engine.chunkSources.get(source.id).frameCount, LONG_MONO_SOURCE_FRAMES);
	} finally {
		await controller.dispose();
	}
});

test('sample-level waveform zoom demand-loads a bounded PCM window across stored chunks', async () => {
	const store = new LogicalPcmStore();
	const decoded = logicalAudioBuffer({ frameCount: LONG_MONO_SOURCE_FRAMES });
	const engine = new ControllerEngine({ decoded: [decoded] });
	const controller = createTestController({
		store,
		engine,
		sourceBufferCacheMaxBytes: 64 * 1024 * 1024,
	});

	try {
		await controller.ready;
		await controller.actions.project.importFiles([audioFile('sample-zoom.wav')]);
		const clip = controller.getSnapshot().project.clips[0];
		store.readSourceChunkCalls.length = 0;

		const window = await controller.actions.timeline.requestWaveformPcmWindow(clip.id, {
			startFrame: SOURCE_CHUNK_FRAMES - 2,
			endFrame: SOURCE_CHUNK_FRAMES + 4,
		});

		assert.equal(window.sourceId, clip.sourceId);
		assert.equal(window.startFrame, SOURCE_CHUNK_FRAMES - 4);
		assert.equal(window.endFrame, SOURCE_CHUNK_FRAMES + 6);
		assert.equal(window.channels.length, 1);
		assert.equal(window.channels[0].length, 10);
		assert.deepEqual(store.readSourceChunkCalls.map(({ index }) => index), [0, 1]);
		assert.equal(controller.getClipVisualData(clip.id).pcmWindow, window);

		const cached = await controller.actions.timeline.requestWaveformPcmWindow(clip.id, {
			startFrame: SOURCE_CHUNK_FRAMES - 1,
			endFrame: SOURCE_CHUNK_FRAMES + 1,
		});
		assert.equal(cached, window);
		assert.equal(store.readSourceChunkCalls.length, 2);
	} finally {
		await controller.dispose();
	}
});

test('large PCM WAV imports are decoded from bounded slices directly into storage', async () => {
	const store = new LogicalPcmStore();
	const engine = new ControllerEngine();
	const file = virtualPcm16Wav(LONG_MONO_SOURCE_FRAMES);
	const controller = createTestController({
		store,
		engine,
		sourceBufferCacheMaxBytes: 64 * 1024 * 1024,
	});

	try {
		await controller.ready;
		await controller.actions.project.importFiles([file], { destination: 'project-bin' });
		await settleController();

		const source = controller.getSnapshot().project.sources[0];
		const binClip = controller.getSnapshot().project.projectBin.clips[0];
		assert.equal(controller.getSnapshot().project.clips.length, 0);
		assert.equal(binClip.sourceId, source.id);
		assert.equal(source.frameCount, LONG_MONO_SOURCE_FRAMES);
		assert.equal(engine.decodeCalls, 0, 'the Web Audio whole-file decoder is bypassed');
		assert.equal(file.arrayBufferCalls, 0, 'the complete File is never materialized');
		assert.ok(file.reads.length > 100);
		assert.ok(Math.max(...file.reads.map(({ byteLength }) => byteLength)) <= SOURCE_CHUNK_FRAMES * 2);
		assert.equal(store.sourceWriteCalls.length, Math.ceil(LONG_MONO_SOURCE_FRAMES / SOURCE_CHUNK_FRAMES));
		assert.equal(store.sourceWriteCalls.every(({ frameCount }) => frameCount <= SOURCE_CHUNK_FRAMES), true);
		assert.equal(engine.sourceBuffers.has(source.id), false);
		assert.equal(engine.chunkSources.has(source.id), true);
		assert.equal(controller.actions.projectBin.getVisualData(binClip.id).available, true);
	} finally {
		await controller.dispose();
	}
});

test('sample editing a long source rebuilds peaks from chunks without rehydrating it', async () => {
	const store = new LogicalPcmStore();
	const engine = new ControllerEngine();
	const controller = createTestController({
		store,
		engine,
		sourceBufferCacheMaxBytes: 64 * 1024 * 1024,
	});

	try {
		await controller.ready;
		await controller.actions.project.importFiles([virtualPcm16Wav(LONG_STEREO_SOURCE_FRAMES, 2)]);
		const originalClip = controller.getSnapshot().project.clips[0];
		controller.actions.timeline.selectClip(originalClip.id);
		controller.actions.timeline.setZoom(192_000);
		assert.equal(controller.getSnapshot().sampleEdit.available, true);

		await controller.actions.sampleEdit.pencil({
			clipId: originalClip.id,
			channel: 0,
			points: [{ timelineFrame: 100, value: 0.75 }],
		});
		await settleController();

		const editedClip = controller.getSnapshot().project.clips.find(({ id }) => id === originalClip.id);
		assert.notEqual(editedClip.sourceId, originalClip.sourceId);
		assert.equal(store.loadSourceAudioBufferCalls, 0);
		assert.equal(controller.getClipVisualData(editedClip.id).buffer, null);
		assert.equal(engine.chunkSources.has(editedClip.sourceId), true);
	} finally {
		await controller.dispose();
	}
});

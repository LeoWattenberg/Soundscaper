import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ControllerEngine,
	LONG_MONO_SOURCE_FRAMES,
	LogicalPcmStore,
	SOURCE_CHUNK_FRAMES,
	audioFile,
	createRecordingHarness,
	createTestController,
	realAudioBuffer,
	settleController,
	restoreWorkerAfterSuite,
} from './helpers/audio-editor-disk-backed-harness.js';

restoreWorkerAfterSuite();

test('finalizing a long recording never asks storage to rehydrate its complete AudioBuffer', async () => {
	const store = new LogicalPcmStore({ nextWriterFrameCount: LONG_MONO_SOURCE_FRAMES });
	const engine = new ControllerEngine();
	const recording = createRecordingHarness();
	const controller = createTestController({
		store,
		engine,
		recordingCapturePool: recording.capturePool,
		recordingControllerFactory: recording.factory,
		sourceBufferCacheMaxBytes: 64 * 1024 * 1024,
	});

	try {
		await controller.ready;
		const trackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.start({ trackId });
		await recording.options.onChunk({ channels: [Float32Array.of(0.25)] });
		await controller.actions.recording.stop();

		const snapshot = controller.getSnapshot();
		const source = snapshot.project.sources[0];
		const clip = snapshot.project.clips[0];
		assert.equal(source.frameCount, LONG_MONO_SOURCE_FRAMES);
		assert.equal(store.loadSourceAudioBufferCalls, 0);
		assert.equal(controller.getClipVisualData(clip.id).buffer, null);
		assert.equal(engine.sourceBuffers.has(source.id), false);
		assert.equal(engine.chunkSources.has(source.id), true);
	} finally {
		await controller.dispose();
	}
});

test('recording packets are coalesced into canonical storage chunks before finalization', async () => {
	const store = new LogicalPcmStore();
	const engine = new ControllerEngine();
	const recording = createRecordingHarness();
	const controller = createTestController({
		store,
		engine,
		recordingCapturePool: recording.capturePool,
		recordingControllerFactory: recording.factory,
		sourceBufferCacheMaxBytes: 1024 * 1024,
	});

	try {
		await controller.ready;
		const trackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.start({ trackId });
		for (let packet = 0; packet < 17; packet += 1) {
			await recording.options.onChunk({ channels: [new Float32Array(4_096).fill(packet / 20)] });
		}
		await controller.actions.recording.stop();

		assert.deepEqual(store.sourceWriteCalls.map((call) => call.frameCount), [65_536, 4_096]);
		assert.equal(store.sourceWriteCalls.every((call) => call.channelCount === 1), true);
		const source = controller.getSnapshot().project.sources[0];
		const metadata = await store.getSourceMetadata(source.id);
		assert.equal(metadata.frameCount, 69_632);
		assert.equal(metadata.chunkFrames, SOURCE_CHUNK_FRAMES);
		assert.equal(metadata.chunkCount, 2);
	} finally {
		await controller.dispose();
	}
});

test('undo can play a history source after its AudioBuffer has been evicted', async () => {
	const bytesPerSource = 64 * Float32Array.BYTES_PER_ELEMENT;
	const store = new LogicalPcmStore();
	const engine = new ControllerEngine({
		decoded: [realAudioBuffer(64, 0.25), realAudioBuffer(64, -0.5)],
	});
	const controller = createTestController({
		store,
		engine,
		sourceBufferCacheMaxBytes: bytesPerSource,
	});

	try {
		await controller.ready;
		await controller.actions.project.importFiles([audioFile('first.wav')]);
		const firstSnapshot = controller.getSnapshot();
		const firstSourceId = firstSnapshot.project.sources[0].id;
		const firstClipId = firstSnapshot.project.clips[0].id;

		await controller.actions.project.importFiles([audioFile('second.wav')]);
		assert.equal(controller.getClipVisualData(firstClipId).buffer, null, 'the first buffer is evicted by the second import');
		assert.equal(engine.chunkSources.has(firstSourceId), true, 'history retention keeps a disk provider, not a RAM buffer');

		controller.actions.edit.undo();
		await settleController();
		assert.deepEqual(controller.getSnapshot().project.sources.map((source) => source.id), [firstSourceId]);
		await controller.actions.transport.playPause();

		assert.equal(engine.lastPlayedSourceId, firstSourceId);
		assert.equal(engine.lastPlaybackSourceKind, 'chunk-provider');
		assert.equal(store.readSourceChunkCalls.some((call) => call.sourceId === firstSourceId), true);
	} finally {
		await controller.dispose();
	}
});

test('many individually small sources share one global byte-bounded AudioBuffer cache', async () => {
	const framesPerSource = 64;
	const bytesPerSource = framesPerSource * Float32Array.BYTES_PER_ELEMENT;
	const budget = bytesPerSource * 2;
	const sourceCount = 7;
	const store = new LogicalPcmStore();
	const engine = new ControllerEngine({
		decoded: Array.from({ length: sourceCount }, (_, index) => realAudioBuffer(framesPerSource, index / 10)),
	});
	const controller = createTestController({
		store,
		engine,
		sourceBufferCacheMaxBytes: budget,
	});

	try {
		await controller.ready;
		for (let index = 0; index < sourceCount; index += 1) {
			await controller.actions.project.importFiles([audioFile(`small-${index}.wav`)]);
		}

		const snapshot = controller.getSnapshot();
		const visuals = snapshot.project.clips.map((clip) => controller.getClipVisualData(clip.id));
		const retainedBytes = visuals.reduce((total, visual) => (
			total + (visual.buffer?.length || 0) * (visual.buffer?.numberOfChannels || 0) * Float32Array.BYTES_PER_ELEMENT
		), 0);
		assert.ok(snapshot.project.sources.every((source) => source.frameCount * source.channelCount * 4 < 32 * 1024 * 1024));
		assert.ok(retainedBytes <= budget, `retained ${retainedBytes} bytes with a ${budget}-byte budget`);
		assert.ok(visuals.filter((visual) => visual.buffer).length <= 2);
		assert.ok(visuals.some((visual) => visual.buffer === null), 'capacity pressure evicts older short sources');
		assert.ok(snapshot.project.sources.every((source) => (
			engine.sourceBuffers.has(source.id) || engine.chunkSources.has(source.id)
		)), 'every source remains playable from RAM or persisted chunks');
	} finally {
		await controller.dispose();
	}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createAudioEditorController,
	createCapturePool,
	createFfmpegStub,
	createMockStream,
	createMockTrack,
	createProjectStore,
	createRecordingControllerFactory,
	createRecordingEngine,
} from './helpers/audio-editor-recording-controller-harness.js';

test('legacy recording reuses a retained mono default input between takes', async () => {
	const store = createProjectStore();
	const engine = createRecordingEngine();
	const input = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const pool = createCapturePool({ hardware: { default: input } });
	const createdControllers = [];
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		recordingCapturePool: pool,
		recordingControllerFactory: createRecordingControllerFactory(createdControllers),
	});

	try {
		await controller.ready;
		const trackId = controller.getSnapshot().project.tracks[0].id;

		await controller.actions.recording.start({ trackId });
		assert.equal(controller.getSnapshot().recording, true);
		await controller.actions.recording.stop();
		assert.equal(controller.getSnapshot().recording, false);
		assert.equal(input.getAudioTracks()[0].stopCount, 0);

		await controller.actions.recording.start({ trackId });
		await controller.actions.recording.stop();

		assert.equal(pool.hardwareRequests.length, 1);
		assert.deepEqual(pool.hardwareRequests[0], { deviceId: 'default', channelCount: 1 });
		assert.equal(createdControllers.length, 2);
		assert.equal(createdControllers.every(({ channelCount }) => channelCount === 1), true);
		assert.equal(createdControllers.every(({ discreteChannels }) => discreteChannels !== false), true);
		assert.equal(input.getAudioTracks()[0].stopCount, 0);
		assert.equal(controller.getSnapshot().recordingInputs.hasOpenInputs, true);
		assert.equal((await store.listSources()).length, 0);
	} finally {
		await controller.dispose();
	}

	assert.equal(input.getAudioTracks()[0].stopCount, 1);
});

test('legacy recording stores context-rate PCM and scales latency into native source frames', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-native-legacy' });
	const engine = createRecordingEngine({ sampleRate: 96_000, baseLatency: 0.005 });
	const input = createMockStream([createMockTrack('audio', { channelCount: 1, sampleRate: 44_100 })]);
	const pool = createCapturePool({ hardware: { default: input } });
	const createdControllers = [];
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		recordingCapturePool: pool,
		recordingControllerFactory: createRecordingControllerFactory(createdControllers),
	});

	try {
		await controller.ready;
		const trackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.start({ trackId });
		let telemetryUpdates = 0;
		const unsubscribeTelemetry = controller.subscribeTelemetry(() => {
			telemetryUpdates += 1;
		});
		const captured = Float32Array.from({ length: 1_440 }, (_, frame) => frame / 1_440);
		await createdControllers[0].onChunk({ channels: [captured] });
		unsubscribeTelemetry();
		assert.equal(telemetryUpdates, 1, 'one capture chunk publishes one coalesced telemetry update');
		await controller.actions.recording.stop();

		const project = controller.getSnapshot().project;
		const source = project.sources[0];
		const clip = project.clips[0];
		assert.equal(source.sampleRate, 96_000);
		assert.equal(source.originalSampleRate, 96_000);
		assert.equal(source.frameCount, 1_440);
		assert.equal(clip.timelineStartFrame, 0);
		assert.equal(clip.durationFrames, 480);
		assert.equal(clip.sourceStartFrame, 480);
		assert.equal(clip.sourceDurationFrames, 960);
		assert.equal(clip.sourceStartFrame + clip.sourceDurationFrames, source.frameCount);
		const stored = await store.readSourceChunk(source.id, 0);
		assert.equal(stored.channels[0].length, captured.length);
		assert.equal(stored.channels[0][500], captured[500]);
	} finally {
		await controller.dispose();
	}
});

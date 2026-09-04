import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createAudioEditorController,
	createCapturePool,
	createFfmpegStub,
	createMockStream,
	createMockTrack,
	createProjectStore,
	createRecordingCapturePool,
	createRecordingControllerFactory,
	createRecordingEngine,
} from './helpers/audio-editor-recording-controller-harness.js';

test('timer recording opens the input immediately and starts the prepared take only when its clock fires', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-timer-start' });
	const engine = createRecordingEngine();
	const input = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const pool = createCapturePool({ hardware: { default: input } });
	const createdControllers = [];
	let now = Date.UTC(2030, 0, 2, 3, 4, 5);
	let wake = null;
	let scheduledDelay = null;
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		recordingCapturePool: pool,
		recordingControllerFactory: createRecordingControllerFactory(createdControllers),
		now: () => now,
		setTimeout(callback, delay) {
			wake = callback;
			scheduledDelay = delay;
			return 41;
		},
		clearTimeout() {},
	});

	try {
		await controller.ready;
		const trackId = controller.getSnapshot().project.tracks[0].id;
		controller.actions.recording.toggleLeadIn();
		const startTimeMs = now + 10_000;
		const scheduled = await controller.actions.recording.schedule(startTimeMs, { trackId });

		assert.equal(scheduled.startTimeMs, startTimeMs);
		assert.equal(controller.getSnapshot().scheduledRecording.startTimeMs, startTimeMs);
		assert.equal(controller.getSnapshot().recording, false);
		assert.equal(controller.getSnapshot().recordingInputs.hasOpenInputs, true);
		assert.deepEqual(pool.hardwareRequests, [{ deviceId: 'default', channelCount: 1 }]);
		assert.equal(createdControllers.length, 1, 'the recorder pipeline is prepared while permission is available');
		assert.deepEqual(createdControllers[0].startOptions, {
			startFrame: 480_000,
			stopFrame: undefined,
		}, 'capture is armed for the requested wall time without adding lead-in delay');
		assert.equal(engine.playAtCalls.length, 0, 'timeline playback does not begin while the take is only armed');
		assert.equal(scheduledDelay, 10_000);
		assert.equal(typeof wake, 'function');

		now = startTimeMs;
		await wake();
		assert.equal(controller.getSnapshot().scheduledRecording, null);
		assert.equal(controller.getSnapshot().recording, true);
		assert.equal(createdControllers.length, 1);
		assert.equal(pool.hardwareRequests.length, 1, 'the unattended start reuses the already-open input');
		assert.equal(engine.playCalls, 1, 'the timer callback begins timeline playback at the armed time');
		await controller.actions.recording.stop();
	} finally {
		await controller.dispose();
	}
});

test('timer recording leases an input until cancellation even when input retention is disabled', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-timer-cancel' });
	const engine = createRecordingEngine();
	const input = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const pool = createCapturePool({ hardware: { default: input } });
	const createdControllers = [];
	const clearedTimers = [];
	const now = Date.UTC(2030, 0, 2, 3, 4, 5);
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		recordingCapturePool: pool,
		recordingControllerFactory: createRecordingControllerFactory(createdControllers),
		now: () => now,
		setTimeout: () => 73,
		clearTimeout: (timer) => clearedTimers.push(timer),
	});

	try {
		await controller.ready;
		await controller.actions.recording.setRetainInputs(false);
		const trackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.schedule(now + 60_000, { trackId });
		assert.equal(controller.getSnapshot().recordingInputs.retainInputs, false);
		assert.equal(controller.getSnapshot().recordingInputs.hasOpenInputs, true);
		assert.equal(input.getAudioTracks()[0].stopCount, 0);
		await createdControllers[0].onChunk({ channels: [new Float32Array(128).fill(0.25)] });

		assert.equal(controller.actions.recording.cancelScheduled(), true);
		assert.equal(controller.getSnapshot().scheduledRecording, null);
		assert.equal(controller.getSnapshot().recordingInputs.hasOpenInputs, false);
		assert.equal(input.getAudioTracks()[0].stopCount, 1);
		assert.deepEqual(clearedTimers, [73]);
		assert.equal(createdControllers.length, 1);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal((await store.listSources()).length, 0, 'cancelling an armed timer discards any partial capture');
	} finally {
		await controller.dispose();
	}
});

test('cancelling timer recording invalidates a permission request that is still opening', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-timer-pending-cancel' });
	const engine = createRecordingEngine();
	const lateInput = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	let resolveInput;
	let permissionRequested = false;
	const inputPromise = new Promise((resolve) => { resolveInput = resolve; });
	const pool = createRecordingCapturePool({
		requestHardwareInput: () => {
			permissionRequested = true;
			return inputPromise;
		},
	});
	const now = Date.UTC(2030, 0, 2, 3, 4, 5);
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		recordingCapturePool: pool,
		recordingControllerFactory: createRecordingControllerFactory([]),
		now: () => now,
		setTimeout: () => 91,
		clearTimeout() {},
	});

	try {
		await controller.ready;
		await controller.actions.recording.setRetainInputs(false);
		const trackId = controller.getSnapshot().project.tracks[0].id;
		const scheduling = controller.actions.recording.schedule(now + 60_000, { trackId });
		await Promise.resolve();
		// The capture pool intentionally crosses a microtask before invoking the
		// browser permission API; flush both controller and pool boundaries.
		await Promise.resolve();
		assert.equal(permissionRequested, true);
		assert.equal(controller.getSnapshot().recordingScheduling, true);

		assert.equal(controller.actions.recording.cancelScheduled(), true);
		resolveInput(lateInput);
		assert.equal(await scheduling, null);
		assert.equal(lateInput.getAudioTracks()[0].stopCount, 1);
		assert.equal(pool.size, 0);
		assert.equal(controller.getSnapshot().recordingInputs.hasOpenInputs, false);
		assert.equal(controller.getSnapshot().scheduledRecording, null);
	} finally {
		await controller.dispose();
	}
});

test('timer recording cancels a lost display lease and never reopens its chooser unattended', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-timer-display-loss' });
	const engine = createRecordingEngine();
	const audioTrack = createMockTrack('audio', { channelCount: 2 });
	const display = createMockStream([audioTrack, createMockTrack('video')]);
	const createdControllers = [];
	const clearedTimers = [];
	let displayRequests = 0;
	let now = Date.UTC(2030, 0, 2, 3, 4, 5);
	let wake = null;
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		mediaDevices: {
			async getDisplayMedia() {
				displayRequests += 1;
				return display;
			},
		},
		recordingControllerFactory: createRecordingControllerFactory(createdControllers),
		now: () => now,
		setTimeout(callback) {
			wake = callback;
			return 109;
		},
		clearTimeout: (timer) => clearedTimers.push(timer),
	});

	try {
		await controller.ready;
		const trackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.setTrackInput(trackId, {
			kind: 'display',
			channelStart: 0,
			channelCount: 2,
		});
		const startTimeMs = now + 60_000;
		await controller.actions.recording.schedule(startTimeMs);

		assert.equal(displayRequests, 1);
		assert.equal(createdControllers.length, 1);
		assert.equal(controller.getSnapshot().recording, false);
		assert.equal(controller.getSnapshot().scheduledRecording.startTimeMs, startTimeMs);

		audioTrack.stop();
		await Promise.resolve();
		await Promise.resolve();
		assert.equal(controller.getSnapshot().scheduledRecording, null);
		assert.equal(controller.getSnapshot().recording, false);
		assert.deepEqual(clearedTimers, [109]);

		now = startTimeMs;
		await wake?.();
		assert.equal(displayRequests, 1, 'a lost display lease is never reacquired from the timer callback');
		assert.equal(engine.playCalls, 0);
	} finally {
		await controller.dispose();
	}
});

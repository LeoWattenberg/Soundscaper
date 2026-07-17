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
const { createRecordingCapturePool } = await import('../src/lib/tools/audio-editor/recording.js');
const { createProjectStore } = await import('../src/lib/tools/audio-editor/storage.js');

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
		assert.deepEqual(pool.hardwareRequests[0], { deviceId: 'default', channelCount: 2 });
		assert.equal(createdControllers.length, 2);
		assert.equal(createdControllers.every(({ channelCount }) => channelCount === 1), true);
		assert.equal(createdControllers.every(({ discreteChannels }) => discreteChannels === false), true);
		assert.equal(input.getAudioTracks()[0].stopCount, 0);
		assert.equal(controller.getSnapshot().recordingInputs.hasOpenInputs, true);
		assert.equal((await store.listSources()).length, 0);
	} finally {
		await controller.dispose();
	}

	assert.equal(input.getAudioTracks()[0].stopCount, 1);
});

test('idle microphone metering owns a live analyser and shares its input with recording', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-idle-metering' });
	const meterSamples = new Float32Array(256).fill(0.25);
	const engine = createRecordingEngine({ meterSamples });
	const input = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const pool = createCapturePool({ hardware: { default: input } });
	const createdControllers = [];
	let meterTick = null;
	let clearedInterval = null;
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		recordingCapturePool: pool,
		recordingControllerFactory: createRecordingControllerFactory(createdControllers),
		setInterval(callback) {
			meterTick = callback;
			return 97;
		},
		clearInterval(interval) {
			clearedInterval = interval;
		},
	});

	try {
		await controller.ready;
		await controller.actions.recording.setRetainInputs(false);
		assert.equal(controller.getSnapshot().monitor.metering, false);

		await controller.actions.recording.setMetering(true);
		assert.equal(controller.getSnapshot().monitor.metering, true);
		assert.equal(controller.getSnapshot().recordingInputs.hasOpenInputs, true);
		assert.equal(pool.hardwareRequests.length, 1);
		assert.equal(typeof meterTick, 'function');
		meterTick();
		assert.ok(Math.abs(controller.getTelemetrySnapshot().inputMeterDb - (-12.0412)) < 0.001);

		const trackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.start({ trackId });
		assert.equal(pool.hardwareRequests.length, 1, 'recording reuses the metering input');
		await controller.actions.recording.stop();
		assert.equal(controller.getSnapshot().monitor.metering, true);
		assert.equal(controller.getSnapshot().recordingInputs.hasOpenInputs, true);
		assert.equal(input.getAudioTracks()[0].stopCount, 0);

		await controller.actions.recording.setMetering(false);
		assert.equal(controller.getSnapshot().monitor.metering, false);
		assert.equal(controller.getTelemetrySnapshot().inputMeterDb, -60);
		assert.equal(controller.getSnapshot().recordingInputs.hasOpenInputs, false);
		assert.equal(clearedInterval, 97);
		assert.equal(input.getAudioTracks()[0].stopCount, 1);
	} finally {
		await controller.dispose();
	}
});

test('idle microphone metering follows the selected track input route and channels', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-idle-metering-route' });
	const splitOutputs = [];
	const engine = createRecordingEngine({
		onChannelSplitConnect(output) {
			splitOutputs.push(output);
		},
	});
	const defaultInput = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const routedInput = createMockStream([createMockTrack('audio', { channelCount: 4 })]);
	const pool = createCapturePool({
		hardware: {
			default: defaultInput,
			'mic-2': routedInput,
		},
	});
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		recordingCapturePool: pool,
	});

	try {
		await controller.ready;
		await controller.actions.recording.setRetainInputs(false);
		await controller.actions.recording.setMetering(true);

		const trackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.setTrackInput(trackId, {
			kind: 'device',
			deviceId: 'mic-2',
			deviceLabel: 'Second microphone',
			channelStart: 2,
			channelCount: 2,
		});

		assert.equal(controller.getSnapshot().monitor.metering, true);
		assert.deepEqual(pool.hardwareRequests, [
			{ deviceId: 'default', channelCount: 1 },
			{ deviceId: 'mic-2', channelCount: 4 },
		]);
		assert.deepEqual(splitOutputs.slice(-2), [2, 3]);
		assert.equal(defaultInput.getAudioTracks()[0].stopCount, 1);
		assert.equal(routedInput.getAudioTracks()[0].stopCount, 0);

		await controller.actions.recording.setMetering(false);
		assert.equal(routedInput.getAudioTracks()[0].stopCount, 1);
	} finally {
		await controller.dispose();
	}
});

test('idle microphone metering follows selected and cleared channel routes on one device', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-idle-metering-selection' });
	const splitOutputs = [];
	const engine = createRecordingEngine({
		onChannelSplitConnect(output) {
			splitOutputs.push(output);
		},
	});
	const input = createMockStream([createMockTrack('audio', { channelCount: 4 })]);
	const pool = createCapturePool({
		hardware: {
			'mic-1': input,
		},
	});
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		recordingCapturePool: pool,
	});

	try {
		await controller.ready;
		const firstTrackId = controller.getSnapshot().project.tracks[0].id;
		const secondTrackId = controller.actions.track.addMono({ name: 'Second track' });
		await controller.actions.recording.setTrackInput(firstTrackId, {
			kind: 'device',
			deviceId: 'mic-1',
			channelStart: 0,
			channelCount: 1,
		});
		await controller.actions.recording.setTrackInput(secondTrackId, {
			kind: 'device',
			deviceId: 'mic-1',
			channelStart: 2,
			channelCount: 2,
		});
		controller.actions.timeline.selectTrack(firstTrackId);
		await controller.actions.recording.setMetering(true);
		assert.equal(splitOutputs.at(-1), 0);

		controller.actions.timeline.selectTrack(secondTrackId);
		await new Promise((resolve) => setImmediate(resolve));

		assert.equal(controller.getSnapshot().monitor.metering, true);
		assert.deepEqual(splitOutputs.slice(-2), [2, 3]);

		await controller.actions.recording.clearTrackInput(secondTrackId);
		assert.equal(controller.getSnapshot().monitor.metering, true);
		assert.equal(splitOutputs.at(-1), 0);
	} finally {
		await controller.dispose();
	}
});

test('idle microphone metering follows the active project recording route', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-idle-metering-project' });
	const meteredStreams = [];
	const engine = createRecordingEngine({
		onMediaStreamSource(stream) {
			meteredStreams.push(stream);
		},
	});
	const firstInput = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const secondInput = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const pool = createCapturePool({
		hardware: {
			'mic-1': firstInput,
			'mic-2': secondInput,
		},
	});
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		recordingCapturePool: pool,
	});

	try {
		await controller.ready;
		const firstProjectId = controller.getSnapshot().project.id;
		const firstTrackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.setTrackInput(firstTrackId, {
			kind: 'device',
			deviceId: 'mic-1',
			channelStart: 0,
			channelCount: 1,
		});

		await controller.actions.project.create({ title: 'Second metering project' });
		const secondProjectId = controller.getSnapshot().project.id;
		const secondTrackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.setTrackInput(secondTrackId, {
			kind: 'device',
			deviceId: 'mic-2',
			channelStart: 0,
			channelCount: 1,
		});

		await controller.actions.project.openById(firstProjectId);
		await controller.actions.recording.setMetering(true);
		assert.equal(meteredStreams.at(-1), firstInput);

		await controller.actions.project.openById(secondProjectId);
		await new Promise((resolve) => setImmediate(resolve));

		assert.equal(controller.getSnapshot().monitor.metering, true);
		assert.equal(meteredStreams.at(-1), secondInput);
	} finally {
		await controller.dispose();
	}
});

test('a pending input route change cannot re-enable disabled microphone metering', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-idle-metering-route-cancel' });
	const engine = createRecordingEngine();
	const defaultInput = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const routedInput = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	let routedInputRequested = false;
	let resolveRoutedInput;
	const routedInputGate = new Promise((resolve) => { resolveRoutedInput = resolve; });
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		mediaDevices: {
			getUserMedia(constraints) {
				if (constraints?.audio?.deviceId?.exact === 'mic-2') {
					routedInputRequested = true;
					return routedInputGate;
				}
				return Promise.resolve(defaultInput);
			},
		},
	});

	try {
		await controller.ready;
		await controller.actions.recording.setRetainInputs(false);
		await controller.actions.recording.setMetering(true);
		const trackId = controller.getSnapshot().project.tracks[0].id;
		const routeChange = controller.actions.recording.setTrackInput(trackId, {
			kind: 'device',
			deviceId: 'mic-2',
			channelStart: 0,
			channelCount: 1,
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(routedInputRequested, true);

		await controller.actions.recording.setMetering(false);
		resolveRoutedInput(routedInput);
		await routeChange;

		assert.equal(controller.getSnapshot().monitor.metering, false);
		assert.equal(controller.getSnapshot().recordingInputs.hasOpenInputs, false);
		assert.equal(defaultInput.getAudioTracks()[0].stopCount, 1);
		assert.equal(routedInput.getAudioTracks()[0].stopCount, 1);
	} finally {
		resolveRoutedInput(routedInput);
		await controller.dispose();
	}
});

test('idle microphone metering reconnects when its pooled input is upgraded', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-idle-metering-upgrade' });
	const engine = createRecordingEngine();
	const initialInput = createMockStream([
		createMockTrack('audio', { channelCount: 1 }, { emitEndedOnStop: false }),
	]);
	const upgradedInput = createMockStream([createMockTrack('audio', { channelCount: 2 })]);
	const requestedInputs = [initialInput, upgradedInput];
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		mediaDevices: {
			async getUserMedia() {
				const stream = requestedInputs.shift();
				if (!stream) throw new Error('Unexpected extra hardware request.');
				return stream;
			},
		},
	});

	try {
		await controller.ready;
		await controller.actions.recording.setRetainInputs(false);
		await controller.actions.recording.setMetering(true);
		assert.equal(controller.getSnapshot().monitor.metering, true);

		await controller.actions.recording.requestInputAccess();
		await new Promise((resolve) => setImmediate(resolve));

		assert.equal(controller.getSnapshot().monitor.metering, true);
		assert.equal(initialInput.getAudioTracks()[0].stopCount, 1);
		assert.equal(upgradedInput.getAudioTracks()[0].stopCount, 0);

		await controller.actions.recording.setMetering(false);
		assert.equal(upgradedInput.getAudioTracks()[0].stopCount, 1);
	} finally {
		await controller.dispose();
	}
});

test('disabling microphone metering while the audio context resumes leaves no analyser or input lease', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-idle-metering-cancel' });
	const input = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const pool = createCapturePool({ hardware: { default: input } });
	let contextRequested = false;
	let resolveContext;
	let intervalStarted = false;
	const contextGate = new Promise((resolve) => { resolveContext = resolve; });
	const engine = createRecordingEngine({
		getAudioContext(context) {
			contextRequested = true;
			return contextGate.then(() => context);
		},
	});
	const controller = createAudioEditorController(null, {
		store,
		engine,
		ffmpeg: createFfmpegStub(),
		recordingCapturePool: pool,
		setInterval() {
			intervalStarted = true;
			return 101;
		},
		clearInterval() {},
	});

	try {
		await controller.ready;
		await controller.actions.recording.setRetainInputs(false);
		const enabling = controller.actions.recording.setMetering(true);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(contextRequested, true);

		assert.equal(await controller.actions.recording.setMetering(false), false);
		resolveContext();
		assert.equal(await enabling, false);
		assert.equal(intervalStarted, false);
		assert.equal(controller.getSnapshot().monitor.metering, false);
		assert.equal(controller.getSnapshot().recordingInputs.hasOpenInputs, false);
		assert.equal(controller.getTelemetrySnapshot().inputMeterDb, -60);
		assert.equal(input.getAudioTracks()[0].stopCount, 1);
	} finally {
		resolveContext();
		await controller.dispose();
	}
});

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
		assert.deepEqual(pool.hardwareRequests, [{ deviceId: 'default', channelCount: 2 }]);
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
		const captured = Float32Array.from({ length: 1_440 }, (_, frame) => frame / 1_440);
		await createdControllers[0].onChunk({ channels: [captured] });
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

test('routed recording starts surviving desktop audio when a hardware source is unavailable', async () => {
	const store = createProjectStore();
	const engine = createRecordingEngine();
	const desktop = createMockStream([
		createMockTrack('audio', { channelCount: 2 }),
		createMockTrack('video'),
	]);
	const pool = createCapturePool({
		display: desktop,
		hardwareFailures: new Set(['missing-interface']),
	});
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
		const desktopTrackId = controller.getSnapshot().project.tracks[0].id;
		const missingTrackId = controller.actions.track.addMono({ name: 'Missing input', armed: true });
		await controller.actions.recording.setTrackInput(desktopTrackId, {
			kind: 'display',
			channelStart: 0,
			channelCount: 2,
		});
		await controller.actions.recording.setTrackInput(missingTrackId, {
			kind: 'device',
			deviceId: 'missing-interface',
			channelStart: 0,
			channelCount: 1,
		});

		await controller.actions.recording.start();
		const recording = controller.getSnapshot();
		assert.equal(recording.recording, true);
		assert.equal(recording.recordingInputs.health[desktopTrackId], 'recording');
		assert.equal(recording.recordingInputs.health[missingTrackId], 'unavailable');
		assert.equal(createdControllers.length, 1);
		assert.equal(createdControllers[0].stream, desktop);
		assert.equal(createdControllers[0].monitor, false);
		assert.equal(createdControllers[0].inputGain, 1);

		await controller.actions.recording.stop();
		assert.equal(controller.getSnapshot().recording, false);
		assert.equal(controller.getSnapshot().project.clips.length, 0);
		assert.equal(desktop.getTracks().every((track) => track.stopCount === 0), true);
		assert.equal(pool.displayRequests, 1, 'the take reuses display capture opened while assigning the route');
		assert.equal(pool.hardwareRequests.filter(({ deviceId }) => deviceId === 'missing-interface').length, 2);
		assert.equal((await store.listSources()).length, 0);
	} finally {
		await controller.dispose();
	}

	assert.equal(desktop.getTracks().every((track) => track.stopCount === 1), true);
});

test('configured desktop audio stays open and compact single-track recording uses its route', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-retained-display' });
	const engine = createRecordingEngine();
	const desktop = createMockStream([
		createMockTrack('audio', { channelCount: 2 }),
		createMockTrack('video'),
	]);
	const pool = createCapturePool({ display: desktop });
	const createdControllers = [];
	const controller = createAudioEditorController(null, {
		store,
		engine,
		mediaDevices: {
			async enumerateDevices() { return []; },
			async getDisplayMedia() { return desktop; },
		},
		ffmpeg: createFfmpegStub(),
		recordingCapturePool: pool,
		recordingControllerFactory: createRecordingControllerFactory(createdControllers),
	});

	try {
		await controller.ready;
		await controller.actions.recording.setRetainInputs(false);
		await controller.actions.audioDevices.setPreferredInput('display');
		await controller.actions.audioDevices.configureDisplayInput();
		assert.equal(controller.getSnapshot().recordingInputs.retainInputs, true);
		assert.equal(controller.getSnapshot().audioDevices.displayCaptureOpen, true);

		const trackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.setTrackInput(trackId, {
			kind: 'display',
			channelStart: 0,
			channelCount: 2,
		});
		await controller.actions.recording.start({ trackId });
		assert.equal(createdControllers.length, 1);
		assert.equal(createdControllers[0].stream, desktop);

		await controller.actions.recording.stop();
		assert.equal(desktop.getTracks().every((track) => track.stopCount === 0), true);
		assert.equal(controller.getSnapshot().audioDevices.displayCaptureOpen, true);

		assert.equal(controller.actions.recording.releaseInputs(), 1);
		assert.equal(desktop.getTracks().every((track) => track.stopCount === 1), true);
	} finally {
		await controller.dispose();
	}
});

test('routed recording stores context-rate channels while clips keep project-rate timing', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-native-routed' });
	const engine = createRecordingEngine({ sampleRate: 96_000 });
	const desktop = createMockStream([
		createMockTrack('audio', { channelCount: 2, sampleRate: 44_100 }),
		createMockTrack('video'),
	]);
	const pool = createCapturePool({ display: desktop });
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
		await controller.actions.recording.setTrackInput(trackId, {
			kind: 'display',
			channelStart: 0,
			channelCount: 2,
		});
		await controller.actions.recording.start();
		const left = new Float32Array(960).fill(0.25);
		const right = new Float32Array(960).fill(-0.5);
		await createdControllers[0].onChunk({ channels: [left, right] });
		await controller.actions.recording.stop();

		const project = controller.getSnapshot().project;
		const source = project.sources[0];
		const clip = project.clips[0];
		assert.equal(source.sampleRate, 96_000);
		assert.equal(source.originalSampleRate, 96_000);
		assert.equal(source.channelCount, 2);
		assert.equal(source.frameCount, 960);
		assert.equal(clip.durationFrames, 480);
		assert.equal(clip.sourceStartFrame, 0);
		assert.equal(clip.sourceDurationFrames, 960);
		const stored = await store.readSourceChunk(source.id, 0);
		assert.equal(stored.channels[0][100], 0.25);
		assert.equal(stored.channels[1][100], -0.5);
	} finally {
		await controller.dispose();
	}
});

test('audio device preferences persist, preserve explicit routes, and recover from output hot-plug changes', async () => {
	const store = createProjectStore({ databaseName: 'audio-device-preferences' });
	const engine = createRecordingEngine();
	const sinkIds = [];
	let activeSinkId = '';
	engine.setOutputDevice = async (deviceId = '') => {
		sinkIds.push(deviceId);
		activeSinkId = deviceId;
		return { activeDeviceId: deviceId, preferredDeviceId: deviceId, supported: true, error: null };
	};
	engine.getOutputDeviceState = () => ({
		activeDeviceId: activeSinkId,
		preferredDeviceId: activeSinkId,
		supported: true,
		error: null,
	});
	let devices = [
		{ kind: 'audioinput', deviceId: 'default', label: 'System microphone' },
		{ kind: 'audioinput', deviceId: 'mic-2', label: 'USB microphone' },
		{ kind: 'audiooutput', deviceId: 'default', label: 'System speakers' },
		{ kind: 'audiooutput', deviceId: 'speaker-2', label: 'USB speakers' },
	];
	const listeners = new Set();
	const mediaDevices = {
		async enumerateDevices() { return devices; },
		async getDisplayMedia() { throw new Error('Not used by this preference test.'); },
		addEventListener(type, listener) {
			if (type === 'devicechange') listeners.add(listener);
		},
		removeEventListener(type, listener) {
			if (type === 'devicechange') listeners.delete(listener);
		},
		emitDeviceChange() {
			for (const listener of [...listeners]) listener();
		},
	};
	const controller = createAudioEditorController(null, {
		store,
		engine,
		mediaDevices,
		ffmpeg: createFfmpegStub(),
		recordingCapturePool: createCapturePool({
			hardware: {
				default: createMockStream([createMockTrack('audio', { channelCount: 1 })]),
				'mic-2': createMockStream([createMockTrack('audio', { channelCount: 2 })]),
			},
		}),
	});

	try {
		await controller.ready;
		const firstTrackId = controller.getSnapshot().project.tracks[0].id;
		assert.equal(controller.getSnapshot().recordingInputs.routes[firstTrackId].deviceId, 'default');

		await controller.actions.recording.setRetainInputs(false);
		await controller.actions.audioDevices.setPreferredInput('mic-2');
		assert.equal(controller.getSnapshot().recordingInputs.retainInputs, true);
		assert.equal(controller.getSnapshot().recordingInputs.sources.some((source) => source.deviceId === 'mic-2'), true);
		await controller.actions.audioDevices.setPreferredInputChannelCount(2);
		assert.equal(
			controller.getSnapshot().recordingInputs.routes[firstTrackId].deviceId,
			'default',
			'changing the default does not overwrite an explicit track route',
		);
		const secondTrackId = controller.actions.track.add({ armed: false });
		assert.equal(controller.getSnapshot().recordingInputs.routes[secondTrackId].deviceId, 'mic-2');
		assert.equal(controller.getSnapshot().recordingInputs.routes[secondTrackId].channelCount, 2);

		await controller.actions.audioDevices.setOutput('speaker-2');
		assert.equal(controller.getSnapshot().audioDevices.preferredOutputDeviceId, 'speaker-2');
		assert.equal(controller.getSnapshot().audioDevices.outputStatus, 'active');
		assert.deepEqual(await store.loadSetting('audio-device-preferences-v1'), {
			inputDeviceId: 'mic-2',
			inputChannelCount: 2,
			outputDeviceId: 'speaker-2',
		});
		await controller.actions.audioDevices.setPreferredInput('display');
		const displayTrackId = controller.actions.track.add({ armed: false });
		assert.equal(controller.getSnapshot().recordingInputs.routes[displayTrackId].kind, 'display');
		assert.equal(controller.getSnapshot().recordingInputs.routes[displayTrackId].channelCount, 2);

		devices = devices.filter((device) => device.deviceId !== 'speaker-2');
		mediaDevices.emitDeviceChange();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(controller.getSnapshot().audioDevices.preferredOutputDeviceId, 'speaker-2');
		assert.equal(controller.getSnapshot().audioDevices.activeOutputDeviceId, '');
		assert.equal(controller.getSnapshot().audioDevices.outputStatus, 'unavailable');

		devices = [...devices, { kind: 'audiooutput', deviceId: 'speaker-2', label: 'USB speakers' }];
		mediaDevices.emitDeviceChange();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(controller.getSnapshot().audioDevices.activeOutputDeviceId, 'speaker-2');
		assert.equal(controller.getSnapshot().audioDevices.outputStatus, 'active');
		assert.ok(sinkIds.includes(''));
		assert.equal(sinkIds.at(-1), 'speaker-2');
	} finally {
		await controller.dispose();
	}
	assert.equal(listeners.size, 0);
});

function createCapturePool({ hardware = {}, display = null, hardwareFailures = new Set() } = {}) {
	const hardwareEntries = new Map();
	let displayEntry = null;
	let disposed = false;
	const pool = {
		hardwareRequests: [],
		displayRequests: 0,
		async acquireHardware(deviceId, options = {}) {
			if (disposed) throw new Error('Capture pool is disposed.');
			pool.hardwareRequests.push({ deviceId, channelCount: options.channelCount });
			if (hardwareFailures.has(deviceId)) throw new Error(`Input ${deviceId} is unavailable.`);
			const stream = hardwareEntries.get(deviceId) || hardware[deviceId];
			if (!stream) throw new Error(`Input ${deviceId} is unavailable.`);
			hardwareEntries.set(deviceId, stream);
			return stream;
		},
		async acquireDisplay() {
			if (disposed) throw new Error('Capture pool is disposed.');
			if (!display) throw new Error('Display audio is unavailable.');
			if (!displayEntry) {
				pool.displayRequests += 1;
				displayEntry = display;
			}
			return displayEntry;
		},
		getHardware(deviceId) {
			return hardwareEntries.get(deviceId) || null;
		},
		getDisplay() {
			return displayEntry;
		},
		getSnapshot() {
			return [
				...[...hardwareEntries].map(([deviceId, stream]) => ({
					key: `device:${deviceId}`,
					kind: 'device',
					deviceId,
					channelCount: stream.getAudioTracks()[0]?.getSettings().channelCount || 1,
					state: 'open',
				})),
				...(displayEntry ? [{
					key: 'display',
					kind: 'display',
					channelCount: displayEntry.getAudioTracks()[0]?.getSettings().channelCount || 1,
					state: 'open',
				}] : []),
			];
		},
		releaseHardware(deviceId) {
			const stream = hardwareEntries.get(deviceId);
			if (!stream) return false;
			stopStream(stream);
			hardwareEntries.delete(deviceId);
			return true;
		},
		releaseDisplay() {
			if (!displayEntry) return false;
			stopStream(displayEntry);
			displayEntry = null;
			return true;
		},
		releaseAll() {
			const count = hardwareEntries.size + (displayEntry ? 1 : 0);
			for (const stream of hardwareEntries.values()) stopStream(stream);
			hardwareEntries.clear();
			if (displayEntry) stopStream(displayEntry);
			displayEntry = null;
			return count;
		},
		dispose() {
			disposed = true;
			return pool.releaseAll();
		},
	};
	return pool;
}

function createRecordingControllerFactory(created) {
	return async (options) => {
		created.push(options);
		let state = 'ready';
		return {
			get state() { return state; },
			start(startOptions = {}) {
				options.startOptions = { ...startOptions };
				state = 'recording';
				options.onState?.(state);
			},
			pause() {
				if (state !== 'recording') return false;
				state = 'paused';
				options.onState?.(state);
				return true;
			},
			resume() {
				if (state !== 'paused') return false;
				state = 'recording';
				options.onState?.(state);
				return true;
			},
			async stop() {
				if (state === 'stopped' || state === 'disposed') return;
				state = 'stopped';
				options.onState?.(state);
			},
			setMonitoring() {},
			setInputGain() {},
			async dispose() {
				if (state === 'recording' || state === 'paused') await this.stop();
				state = 'disposed';
				options.onState?.(state);
			},
		};
	};
}

function createRecordingEngine(options = {}) {
	const listeners = new Map();
	const context = {
		sampleRate: options.sampleRate || 48_000,
		currentTime: 0,
		baseLatency: options.baseLatency || 0,
		outputLatency: options.outputLatency || 0,
		state: 'running',
		async resume() { this.state = 'running'; },
		addEventListener(type, listener) { listeners.set(type, listener); },
		removeEventListener(type, listener) {
			if (listeners.get(type) === listener) listeners.delete(type);
		},
		createBuffer(channelCount, frameCount, sampleRate) {
			const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
			return {
				numberOfChannels: channelCount,
				length: frameCount,
				sampleRate,
				getChannelData: (channel) => channels[channel],
				copyToChannel: (values, channel, offset = 0) => channels[channel].set(values, offset),
			};
		},
		createMediaStreamSource(stream) {
			options.onMediaStreamSource?.(stream);
			return {
				connect() {},
				disconnect() {},
			};
		},
		createChannelSplitter(channelCount) {
			options.onChannelSplitter?.(channelCount);
			return {
				connect(_target, output) {
					options.onChannelSplitConnect?.(output);
				},
				disconnect() {},
			};
		},
		createAnalyser() {
			return {
				fftSize: 256,
				smoothingTimeConstant: 0,
				connect() {},
				disconnect() {},
				getFloatTimeDomainData(target) {
					target.set(options.meterSamples || new Float32Array(target.length));
				},
			};
		},
	};
	return {
		state: 'stopped',
		positionFrame: 0,
		playCalls: 0,
		playAtCalls: [],
		setSourceResolver() {},
		loadProject() {},
		async applyProject() {},
		getPositionFrames() { return this.positionFrame; },
		getState() { return { state: this.state, loop: { enabled: false } }; },
		async getAudioContext() {
			return typeof options.getAudioContext === 'function'
				? options.getAudioContext(context)
				: context;
		},
		setLoop() {},
		seek(frame) { this.positionFrame = Math.max(0, Math.round(frame)); },
		async playAt(contextTime, fromFrame) {
			this.playAtCalls.push({ contextTime, fromFrame });
			this.state = 'playing';
		},
		play() {
			this.playCalls += 1;
			this.state = 'playing';
		},
		pause() { this.state = 'paused'; },
		stop() { this.state = 'stopped'; },
		async dispose() {},
	};
}

function createMockTrack(kind, settings = {}, options = {}) {
	const listeners = new Map();
	return {
		kind,
		readyState: 'live',
		stopCount: 0,
		getSettings: () => ({ ...settings }),
		addEventListener(type, listener) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type).add(listener);
		},
		removeEventListener(type, listener) {
			listeners.get(type)?.delete(listener);
		},
		stop() {
			if (this.readyState === 'ended') return;
			this.readyState = 'ended';
			this.stopCount += 1;
			if (options.emitEndedOnStop !== false) {
				for (const listener of [...(listeners.get('ended') || [])]) listener({ type: 'ended', target: this });
			}
		},
	};
}

function createMockStream(tracks) {
	return {
		getTracks: () => tracks,
		getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
		getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
	};
}

function stopStream(stream) {
	for (const track of stream.getTracks()) track.stop();
}

function createFfmpegStub() {
	return { dispose() {} };
}

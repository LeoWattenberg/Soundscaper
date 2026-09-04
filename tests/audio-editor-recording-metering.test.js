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

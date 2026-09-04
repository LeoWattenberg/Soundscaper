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

test('one routed source chunk publishes telemetry once across multiple track routes', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-routed-telemetry' });
	const engine = createRecordingEngine();
	const input = createMockStream([
		createMockTrack('audio', { channelCount: 2 }),
	]);
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
		const firstTrackId = controller.getSnapshot().project.tracks[0].id;
		const secondTrackId = controller.actions.track.addMono({ name: 'Second route', armed: true });
		await controller.actions.recording.setTrackInput(firstTrackId, {
			kind: 'device',
			deviceId: 'default',
			channelStart: 0,
			channelCount: 1,
		});
		await controller.actions.recording.setTrackInput(secondTrackId, {
			kind: 'device',
			deviceId: 'default',
			channelStart: 1,
			channelCount: 1,
		});
		await controller.actions.recording.start();
		assert.equal(createdControllers.length, 1);

		let telemetryUpdates = 0;
		const unsubscribeTelemetry = controller.subscribeTelemetry(() => {
			telemetryUpdates += 1;
		});
		await createdControllers[0].onChunk({
			channels: [
				new Float32Array(128).fill(0.25),
				new Float32Array(128).fill(-0.5),
			],
		});
		unsubscribeTelemetry();
		assert.equal(telemetryUpdates, 1);
		await controller.actions.recording.stop();
	} finally {
		await controller.dispose();
	}
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

test('selecting stereo upgrades the active default input and stores two recording channels', async () => {
	const store = createProjectStore({ databaseName: 'recording-controller-preferred-stereo' });
	const engine = createRecordingEngine();
	const mono = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const stereo = createMockStream([createMockTrack('audio', { channelCount: 2 })]);
	const pool = createCapturePool({
		hardware: {
			default: ({ channelCount }) => channelCount === 2 ? stereo : mono,
		},
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
		const trackId = controller.getSnapshot().project.tracks[0].id;
		await controller.actions.recording.setTrackInput(trackId, {
			kind: 'device',
			deviceId: 'default',
			channelStart: 0,
			channelCount: 1,
		});
		await controller.actions.audioDevices.setPreferredInputChannelCount(2);
		assert.equal(controller.getSnapshot().recordingInputs.routes[trackId].channelCount, 2);
		assert.equal(pool.hardwareRequests.at(-1).channelCount, 2);

		await controller.actions.recording.start({ trackId });
		const left = new Float32Array(480).fill(0.25);
		const right = new Float32Array(480).fill(-0.5);
		await createdControllers[0].onChunk({ channels: [left, right] });
		await controller.actions.recording.stop();

		const source = controller.getSnapshot().project.sources[0];
		assert.equal(source.channelCount, 2);
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

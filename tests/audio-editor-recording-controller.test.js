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
			start() {
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
	};
	return {
		state: 'stopped',
		positionFrame: 0,
		setSourceResolver() {},
		loadProject() {},
		async applyProject() {},
		getPositionFrames() { return this.positionFrame; },
		getState() { return { state: this.state, loop: { enabled: false } }; },
		async getAudioContext() { return context; },
		setLoop() {},
		seek(frame) { this.positionFrame = Math.max(0, Math.round(frame)); },
		async playAt() { this.state = 'playing'; },
		play() { this.state = 'playing'; },
		pause() { this.state = 'paused'; },
		stop() { this.state = 'stopped'; },
		async dispose() {},
	};
}

function createMockTrack(kind, settings = {}) {
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

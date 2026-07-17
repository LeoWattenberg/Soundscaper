import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createRecordingCapturePool,
	createRecordingController,
	normalizeRecordingChannelCount,
	RECORDING_CHANNEL_COUNT_MAXIMUM,
	requestDisplayInput,
	requestHardwareInput,
} from '../src/lib/tools/audio-editor/recording.js';
import { StreamingRecorderProcessor } from '../src/lib/tools/audio-editor/recording-worklet.js';

test('hardware input requests exact devices with bounded multichannel constraints and speech processing disabled', async () => {
	let received = null;
	const expectedStream = { id: 'hardware-stream' };
	const mediaDevices = {
		async getUserMedia(constraints) {
			assert.equal(this, mediaDevices);
			received = constraints;
			return expectedStream;
		},
	};
	const stream = await requestHardwareInput({
		deviceId: 'interface-1',
		channelCount: 100,
		sampleRate: 48_000.9,
		audioConstraints: { latency: { ideal: 0.01 }, echoCancellation: true, channelCount: 1 },
		mediaDevices,
	});

	assert.equal(stream, expectedStream);
	assert.deepEqual(received, { audio: {
		channelCount: { ideal: 32, max: 32 },
		echoCancellation: false,
		noiseSuppression: false,
		autoGainControl: false,
		latency: { ideal: 0.01 },
		deviceId: { exact: 'interface-1' },
		sampleRate: { ideal: 48_000 },
	} });
	assert.equal(RECORDING_CHANNEL_COUNT_MAXIMUM, 32);
	assert.equal(normalizeRecordingChannelCount(12.9), 12);
	assert.equal(normalizeRecordingChannelCount(100), 32);
});

test('display input requests audio with browser surface and system audio hints', async () => {
	let received = null;
	const expectedStream = { id: 'display-stream' };
	const mediaDevices = {
		async getDisplayMedia(constraints) {
			assert.equal(this, mediaDevices);
			received = constraints;
			return expectedStream;
		},
	};
	const stream = await requestDisplayInput({
		audioConstraints: { suppressLocalAudioPlayback: false },
		displayConstraints: { surfaceSwitching: 'include', audio: false, video: false, selfBrowserSurface: 'include' },
		mediaDevices,
	});

	assert.equal(stream, expectedStream);
	assert.deepEqual(received, {
		video: true,
		audio: { suppressLocalAudioPlayback: false },
		selfBrowserSurface: 'exclude',
		systemAudio: 'include',
		windowAudio: 'system',
		surfaceSwitching: 'include',
	});
});

test('recording controller configures discrete multichannel capture and can detach without stopping tracks', async () => {
	let nodeOptions = null;
	const track = createMockTrack('audio', 8);
	const stream = createMockStream([track]);
	const source = createMockNode();
	const node = createMockNode();
	const controller = await createRecordingController({
		context: {
			destination: createMockNode(),
			audioWorklet: { async addModule() {} },
			createMediaStreamSource: () => source,
		},
		stream,
		channelCount: 8,
		nodeFactory: (_context, _name, options) => {
			nodeOptions = options;
			return node;
		},
	});

	assert.equal(nodeOptions.channelCount, 8);
	assert.equal(nodeOptions.channelCountMode, 'explicit');
	assert.equal(nodeOptions.channelInterpretation, 'discrete');
	assert.deepEqual(nodeOptions.outputChannelCount, [8]);
	assert.equal(nodeOptions.processorOptions.channelCount, 8);
	await controller.detach();
	assert.equal(controller.state, 'disposed');
	assert.equal(track.stopCount, 0);
	assert.equal(source.disconnected, true);
	assert.equal(node.disconnected, true);
});

test('recording controller can preserve legacy channel interpretation for mono-to-stereo duplication', async () => {
	let nodeOptions = null;
	const controller = await createRecordingController({
		context: {
			destination: createMockNode(),
			audioWorklet: { async addModule() {} },
			createMediaStreamSource: () => createMockNode(),
		},
		stream: createMockStream([createMockTrack('audio', 1)]),
		channelCount: 2,
		discreteChannels: false,
		nodeFactory: (_context, _name, options) => {
			nodeOptions = options;
			return createMockNode();
		},
	});

	assert.equal('channelCountMode' in nodeOptions, false);
	assert.equal('channelInterpretation' in nodeOptions, false);
	assert.deepEqual(nodeOptions.outputChannelCount, [2]);
	await controller.detach();
});

test('recording worklet modules load once per context and failed loads remain retryable', async () => {
	const pending = deferred();
	let moduleLoads = 0;
	const context = {
		destination: createMockNode(),
		audioWorklet: {
			addModule() {
				moduleLoads += 1;
				return pending.promise;
			},
		},
		createMediaStreamSource: () => createMockNode(),
	};
	const options = {
		context,
		stream: createMockStream([createMockTrack('audio', 1)]),
		workletUrl: '/shared-recorder.js',
		nodeFactory: () => createMockNode(),
	};
	const firstPending = createRecordingController(options);
	const secondPending = createRecordingController(options);
	await Promise.resolve();
	assert.equal(moduleLoads, 1);
	pending.resolve();
	const [first, second] = await Promise.all([firstPending, secondPending]);
	await first.detach();
	await second.detach();

	let attempts = 0;
	const retryContext = {
		destination: createMockNode(),
		audioWorklet: {
			async addModule() {
				attempts += 1;
				if (attempts === 1) throw new Error('temporary load failure');
			},
		},
		createMediaStreamSource: () => createMockNode(),
	};
	const retryOptions = { ...options, context: retryContext, workletUrl: '/retry-recorder.js' };
	await assert.rejects(createRecordingController(retryOptions), /temporary load failure/);
	const retried = await createRecordingController(retryOptions);
	assert.equal(attempts, 2);
	await retried.detach();
});

test('recording worklet preserves distinct browser-exposed channels', () => {
	const processor = new StreamingRecorderProcessor({
		processorOptions: { channelCount: 4, chunkFrames: 128, monitor: true },
	});
	const initialBuffers = processor.buffers;
	const messages = [];
	processor.port.postMessage = (message, transfer = []) => messages.push({ message, transfer });
	processor.port.onmessage({ data: { type: 'start', startFrame: 0, stopFrame: 128 } });
	const input = Array.from({ length: 4 }, (_, channel) => new Float32Array(128).fill((channel + 1) / 10));
	const output = Array.from({ length: 4 }, () => new Float32Array(128));
	processor.process([input], [output]);

	const chunk = messages.find(({ message }) => message.type === 'audio-chunk');
	assert.equal(chunk.message.channels.length, 4);
	assert.equal(chunk.transfer.length, 4);
	for (let channel = 0; channel < 4; channel += 1) {
		assert.strictEqual(chunk.message.channels[channel], initialBuffers[channel]);
		assert.deepEqual(chunk.message.channels[channel], input[channel]);
		assert.deepEqual(output[channel], input[channel]);
	}
	assert.equal(new StreamingRecorderProcessor({ processorOptions: { channelCount: 100 } }).buffers.length, 32);
});

test('recording worklet only copies partial flushes', () => {
	const processor = new StreamingRecorderProcessor({
		processorOptions: { channelCount: 1, chunkFrames: 128 },
	});
	const initialBuffer = processor.buffers[0];
	const messages = [];
	processor.port.postMessage = (message) => messages.push(message);
	processor.port.onmessage({ data: { type: 'start', startFrame: 0 } });
	const input = Float32Array.from({ length: 64 }, (_, frame) => frame / 64);
	processor.process([[input]], [[new Float32Array(64)]]);
	processor.port.onmessage({ data: { type: 'stop' } });

	const chunk = messages.find(({ type }) => type === 'audio-chunk');
	assert.equal(chunk.frames, 64);
	assert.notStrictEqual(chunk.channels[0], initialBuffer);
	assert.deepEqual(chunk.channels[0], input);
});

test('recording worklet keeps chunk frame starts contiguous across quantum boundaries', () => {
	const previousFrame = globalThis.currentFrame;
	try {
		const processor = new StreamingRecorderProcessor({
			processorOptions: { channelCount: 1, chunkFrames: 128 },
		});
		const messages = [];
		processor.port.postMessage = (message) => messages.push(message);
		processor.port.onmessage({ data: { type: 'start', startFrame: 64 } });
		globalThis.currentFrame = 0;
		processor.process([[new Float32Array(128).fill(0.25)]], [[new Float32Array(128)]]);
		globalThis.currentFrame = 128;
		processor.process([[new Float32Array(128).fill(0.5)]], [[new Float32Array(128)]]);
		processor.port.onmessage({ data: { type: 'stop' } });

		const chunks = messages.filter(({ type }) => type === 'audio-chunk');
		assert.deepEqual(chunks.map(({ frameStart, frames }) => ({ frameStart, frames })), [
			{ frameStart: 64, frames: 128 },
			{ frameStart: 192, frames: 64 },
		]);
	} finally {
		if (previousFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousFrame;
	}
});

test('capture pool reuses live inputs, reacquires for more exposed channels, and releases explicitly', async () => {
	const requestedChannels = [];
	const hardwareStreams = [];
	let displayRequests = 0;
	let rejectDisplay = false;
	const changes = [];
	const pool = createRecordingCapturePool({
		requestHardwareInput: async ({ channelCount }) => {
			requestedChannels.push(channelCount);
			const stream = createMockStream([createMockTrack('audio', channelCount)]);
			hardwareStreams.push(stream);
			return stream;
		},
		requestDisplayInput: async () => {
			displayRequests += 1;
			if (rejectDisplay) throw new Error('Display chooser cancelled.');
			return createMockStream([createMockTrack('audio', 2), createMockTrack('video')]);
		},
		onChange: (snapshot) => changes.push(snapshot),
	});

	const first = await pool.acquireHardware('interface-1', { channelCount: 2 });
	assert.equal(await pool.acquireHardware('interface-1', { channelCount: 2 }), first);
	const expanded = await pool.acquireHardware('interface-1', { channelCount: 8 });
	assert.notEqual(expanded, first);
	assert.deepEqual(requestedChannels, [2, 8]);
	assert.equal(hardwareStreams[0].getAudioTracks()[0].stopCount, 1);
	assert.equal(pool.getHardware('interface-1'), expanded);

	const display = await pool.acquireDisplay();
	assert.equal(await pool.acquireDisplay(), display);
	assert.equal(displayRequests, 1);
	const replacementDisplay = await pool.replaceDisplay();
	assert.notEqual(replacementDisplay, display);
	assert.equal(displayRequests, 2);
	assert.equal(display.getTracks().every((track) => track.stopCount === 1), true);
	rejectDisplay = true;
	await assert.rejects(pool.replaceDisplay(), /chooser cancelled/);
	assert.equal(pool.getDisplay(), replacementDisplay);
	assert.equal(replacementDisplay.getTracks().every((track) => track.stopCount === 0), true);
	assert.deepEqual(pool.getSnapshot(), [
		{ key: 'device:interface-1', kind: 'device', deviceId: 'interface-1', channelCount: 8, state: 'open' },
		{ key: 'display', kind: 'display', channelCount: 2, state: 'open' },
	]);
	assert.equal(pool.hasInputs, true);
	assert.equal(pool.releaseHardware('interface-1'), true);
	assert.equal(expanded.getAudioTracks()[0].stopCount, 1);
	assert.equal(pool.releaseAll(), 1);
	assert.equal(replacementDisplay.getTracks().every((track) => track.stopCount === 1), true);
	assert.equal(pool.size, 0);
	assert.ok(changes.length >= 4);
});

test('capture pool invalidates pending acquisitions on release and keeps a working stream when expansion fails', async () => {
	const pending = deferred();
	const lateStream = createMockStream([createMockTrack('audio', 2)]);
	const pendingPool = createRecordingCapturePool({ requestHardwareInput: () => pending.promise });
	const acquisition = pendingPool.acquireHardware('late-device', { channelCount: 2 });
	await Promise.resolve();
	assert.equal(pendingPool.releaseAll(), 1);
	pending.resolve(lateStream);
	await assert.rejects(acquisition, /released while it was opening/);
	assert.equal(lateStream.getAudioTracks()[0].stopCount, 1);
	assert.equal(pendingPool.size, 0);

	const original = createMockStream([createMockTrack('audio', 2)]);
	const replacement = createMockStream([createMockTrack('audio', 1)]);
	let request = 0;
	const pool = createRecordingCapturePool({
		requestHardwareInput: async () => {
			request += 1;
			if (request === 1) return original;
			if (request === 2) throw new Error('expansion denied');
			return replacement;
		},
	});
	await pool.acquireHardware('interface', { channelCount: 2 });
	await assert.rejects(pool.acquireHardware('interface', { channelCount: 8 }), /expansion denied/);
	assert.equal(pool.getHardware('interface'), original);
	assert.equal(original.getAudioTracks()[0].stopCount, 0);
	assert.equal(await pool.acquireHardware('interface', { channelCount: 8 }), original);
	assert.equal(replacement.getAudioTracks()[0].stopCount, 1);
});

test('worklet reaches a scheduled stop without input and controller overrun accounting remains bounded', async () => {
	const processor = new StreamingRecorderProcessor({ processorOptions: { channelCount: 1, chunkFrames: 128 } });
	const messages = [];
	processor.port.postMessage = (message) => messages.push(message);
	processor.port.onmessage({ data: { type: 'start', startFrame: 0, stopFrame: 128 } });
	processor.process([[]], [[new Float32Array(128)]]);
	assert.equal(messages.some((message) => message.type === 'stopped'), true);

	const node = createMockNode();
	let overrun = null;
	const controller = await createRecordingController({
		context: {
			destination: createMockNode(),
			audioWorklet: { async addModule() {} },
			createMediaStreamSource: () => createMockNode(),
		},
		stream: createMockStream([createMockTrack('audio', 1)]),
		maxPendingChunks: 0,
		onError: (error) => { overrun = error; },
		nodeFactory: () => node,
	});
	node.port.onmessage({ data: { type: 'audio-chunk', channels: [new Float32Array(1)], frames: 1 } });
	assert.match(overrun.message, /could not keep up/);
	assert.equal(controller.pendingChunks, 0);
	await controller.detach();
});

test('capture pool discards audio-less display capture and removes externally ended streams', async () => {
	const videoOnly = createMockStream([createMockTrack('video')]);
	const invalidPool = createRecordingCapturePool({ requestDisplayInput: async () => videoOnly });
	await assert.rejects(invalidPool.acquireDisplay(), /did not include a live audio track/);
	assert.equal(videoOnly.getVideoTracks()[0].stopCount, 1);
	assert.equal(invalidPool.size, 0);

	const audio = createMockTrack('audio', 2);
	const video = createMockTrack('video');
	const stream = createMockStream([audio, video]);
	const pool = createRecordingCapturePool({ requestDisplayInput: async () => stream });
	await pool.acquireDisplay();
	video.end();
	assert.equal(pool.getDisplay(), null);
	assert.equal(pool.size, 0);
	assert.equal(audio.stopCount, 1, 'ending display video releases its remaining audio track');
});

function createMockTrack(kind, channelCount = 1) {
	const listeners = new Map();
	return {
		kind,
		readyState: 'live',
		stopCount: 0,
		getSettings: () => kind === 'audio' ? { channelCount } : {},
		addEventListener(type, listener) {
			if (!listeners.has(type)) listeners.set(type, []);
			listeners.get(type).push(listener);
		},
		stop() {
			this.stopCount += 1;
			this.readyState = 'ended';
		},
		end() {
			this.readyState = 'ended';
			for (const listener of listeners.get('ended') || []) listener();
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

function createMockNode() {
	return {
		disconnected: false,
		port: { onmessage: null, start() {}, postMessage() {} },
		connect() {},
		disconnect() { this.disconnected = true; },
	};
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

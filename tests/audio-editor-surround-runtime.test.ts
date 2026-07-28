import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { RenderCaptureProcessor } from '../src/common/editor/render-capture-worklet.js';

class MockParam {
	value: number;

	constructor(value = 0) { this.value = value; }
	setValueAtTime(value: number) { this.value = value; }
	linearRampToValueAtTime(value: number) { this.value = value; }
}

class MockNode {
	maxChannelCount?: number;
	channelCount?: number;
	channelCountMode?: string;
	channelInterpretation?: string;
	connections: MockNode[] = [];

	connect(node: MockNode) { this.connections.push(node); return node; }
	disconnect() { this.connections = []; }
}

class MockAudioBuffer {
	numberOfChannels: number;
	length: number;
	sampleRate: number;
	duration: number;
	channels: Float32Array[];

	constructor(numberOfChannels: number, length: number, sampleRate: number) {
		this.numberOfChannels = numberOfChannels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.duration = length / sampleRate;
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}

	getChannelData(index: number) { return this.channels[index]; }
}

class MockAudioContext {
	sampleRate = 48_000;
	currentTime = 0;
	state = 'running';
	destination = new MockNode();
	audioWorklet = { addModule: async () => undefined };

	make(properties: Record<string, unknown> = {}) { return Object.assign(new MockNode(), properties); }
	createGain() { return this.make({ gain: new MockParam(1) }); }
	createStereoPanner() { return this.make({ pan: new MockParam() }); }
	createBiquadFilter() { return this.make({ frequency: new MockParam(), Q: new MockParam(), gain: new MockParam() }); }
	createDynamicsCompressor() {
		return this.make({
			threshold: new MockParam(), knee: new MockParam(), ratio: new MockParam(),
			attack: new MockParam(), release: new MockParam(),
		});
	}
	createDelay() { return this.make({ delayTime: new MockParam() }); }
	createConvolver() { return this.make({ buffer: null }); }
	createWaveShaper() { return this.make({ curve: null }); }
	createAnalyser() {
		return this.make({
			fftSize: 256,
			getFloatTimeDomainData(values: Float32Array) { values.fill(0); },
			getFloatFrequencyDomainData(values: Float32Array) { values.fill(-100); },
		});
	}
	createBufferSource() {
		return this.make({ buffer: null, playbackRate: new MockParam(1), start() {}, stop() {} });
	}
	createBuffer(channels: number, length: number, sampleRate: number) {
		return new MockAudioBuffer(channels, length, sampleRate);
	}
	async resume() { this.state = 'running'; }
	async close() { this.state = 'closed'; }
}

class MockOfflineAudioContext extends MockAudioContext {
	numberOfChannels: number;
	length: number;

	constructor(options: { numberOfChannels: number; length: number }) {
		super();
		this.numberOfChannels = options.numberOfChannels;
		this.length = options.length;
	}

	async startRendering() {
		return new MockAudioBuffer(this.numberOfChannels, this.length, this.sampleRate);
	}
}

function createSixChannelProject() {
	return {
		id: 'surround-project', sampleRate: 48_000, masterChannels: 6,
		sources: [{ id: 'source-1', frameCount: 4_800, channelCount: 6, sampleRate: 48_000 }],
		clips: [{
			id: 'clip-1', sourceId: 'source-1', timelineStartFrame: 0, sourceStartFrame: 0,
			durationFrames: 4_800, gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
		}],
		tracks: [{
			id: 'bed', clipIds: ['clip-1'], gain: 1, pan: 0, mute: false, solo: false, effects: [],
		}],
		master: { gain: 1, effects: [] },
	};
}

test('realtime render capture preserves a declared six-channel bed', () => {
	const previousFrame = globalThis.currentFrame;
	globalThis.currentFrame = 0;
	try {
		const processor = new RenderCaptureProcessor({
			processorOptions: { startFrame: 0, totalFrames: 4, chunkFrames: 128, channelCount: 6 },
		});
		const messages: Array<{ message: { type: string; channels: Float32Array[] }; transfer: unknown[] }> = [];
		processor.port.postMessage = (message, transfer = []) => messages.push({ message, transfer });
		const channels = Array.from({ length: 6 }, (_, channel) => Float32Array.of(
			channel + 0.1, channel + 0.2, channel + 0.3, channel + 0.4,
		));
		assert.equal(processor.process([channels], [channels.map(() => new Float32Array(4))]), false);
		const chunk = messages.find(({ message }) => message.type === 'audio-chunk');
		assert.equal(chunk?.message.channels.length, 6);
		assert.equal(chunk?.transfer.length, 6);
		assert.deepEqual([...(chunk?.message.channels[5] ?? [])], [...channels[5]]);
	} finally {
		if (previousFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousFrame;
	}
});

test('offline rendering and native monitoring preserve the six-channel master', async () => {
	const offlineContexts: MockOfflineAudioContext[] = [];
	const realtime = new MockAudioContext();
	realtime.destination.maxChannelCount = 8;
	const engine = createAudioEditorEngine({
		audioContextFactory: () => realtime as never,
		offlineAudioContextFactory: (options) => {
			const context = new MockOfflineAudioContext(options);
			offlineContexts.push(context);
			return context as never;
		},
	});
	try {
		engine.loadProject(createSixChannelProject(), new Map([
			['source-1', new MockAudioBuffer(6, 4_800, 48_000) as never],
		]));
		await engine.getAudioContext({ resume: false });
		const rendered = await engine.renderMix({ startFrame: 0, endFrame: 4_800 });
		assert.equal(realtime.destination.channelCount, 6);
		assert.equal(realtime.destination.channelCountMode, 'explicit');
		assert.equal(realtime.destination.channelInterpretation, 'discrete');
		assert.equal(offlineContexts[0].numberOfChannels, 6);
		assert.equal(rendered.numberOfChannels, 6);
	} finally {
		await engine.dispose();
	}
});

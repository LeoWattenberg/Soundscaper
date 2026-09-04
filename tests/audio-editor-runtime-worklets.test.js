import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createAudioEditorEngine,
} from '../src/common/editor/engine.js';
import { StreamingRecorderProcessor } from '../src/common/editor/recording-worklet.js';
import { RenderCaptureProcessor } from '../src/common/editor/render-capture-worklet.js';
import { DynamicsProcessor } from '../src/common/editor/dynamics-worklet.js';
import { DelayProcessor } from '../src/common/editor/delay-worklet.js';
import {
	MockAudioContext,
} from './helpers/mock-audio-context.js';
import {
	MockAudioWorkletNode,
	createProject,
} from './helpers/audio-editor-runtime-harness.js';

test('recording worklet emits bounded transferable chunks and monitor output', () => {
	const processor = new StreamingRecorderProcessor({ processorOptions: { channelCount: 1, chunkFrames: 128, monitor: true } });
	const messages = [];
	processor.port.postMessage = (message, transfer = []) => messages.push({ message, transfer });
	processor.port.onmessage({ data: { type: 'start', startFrame: 0, stopFrame: 128 } });
	const input = Float32Array.from({ length: 128 }, (_, index) => index / 128);
	const output = new Float32Array(128);
	processor.process([[input]], [[output]]);
	assert.deepEqual(output, input);
	const chunk = messages.find((entry) => entry.message.type === 'audio-chunk');
	assert.equal(chunk.message.frames, 128);
	assert.equal(chunk.message.channels[0].length, 128);
	assert.equal(chunk.transfer.length, 1);
	assert.equal(messages.at(-1).message.type, 'stopped');
});

test('recording worklet pause omits paused input and extends a bounded punch stop', () => {
	const previousFrame = globalThis.currentFrame;
	globalThis.currentFrame = 0;
	try {
		const processor = new StreamingRecorderProcessor({ processorOptions: { channelCount: 1, chunkFrames: 128 } });
		const messages = [];
		processor.port.postMessage = (message) => messages.push(message);
		processor.port.onmessage({ data: { type: 'start', startFrame: 0, stopFrame: 384 } });
		const block = new Float32Array(128).fill(0.5);
		processor.process([[block]], [[new Float32Array(128)]]);
		processor.port.onmessage({ data: { type: 'pause' } });
		globalThis.currentFrame = 128;
		processor.process([[new Float32Array(128).fill(1)]], [[new Float32Array(128)]]);
		processor.port.onmessage({ data: { type: 'resume' } });
		globalThis.currentFrame = 256;
		processor.process([[block]], [[new Float32Array(128)]]);
		globalThis.currentFrame = 384;
		processor.process([[block]], [[new Float32Array(128)]]);
		const chunks = messages.filter((message) => message.type === 'audio-chunk');
		assert.deepEqual(chunks.map((message) => message.frames), [128, 128, 128]);
		assert.ok(chunks.every((message) => message.channels[0].every((sample) => sample === 0.5)));
		assert.equal(messages.some((message) => message.type === 'paused'), true);
		assert.equal(messages.some((message) => message.type === 'resumed'), true);
		assert.equal(messages.at(-1).type, 'stopped');
	} finally {
		if (previousFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousFrame;
	}
});

test('dynamics worklet gates quiet input and look-ahead limits overshoot', () => {
	const previousSampleRate = globalThis.sampleRate;
	globalThis.sampleRate = 48_000;
	try {
		const gate = new DynamicsProcessor({ processorOptions: { type: 'gate', params: { threshold: -20, attack: 0, hold: 0, release: 0, rangeDb: -80 } } });
		const gated = [new Float32Array(8)];
		gate.process([[Float32Array.of(0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001)]], [gated]);
		assert.ok(Math.max(...gated[0].map(Math.abs)) < 0.00001);

		const limiter = new DynamicsProcessor({ processorOptions: { type: 'limiter', params: { ceiling: -6, lookahead: 0.001, release: 0.05 } } });
		const input = new Float32Array(128).fill(1);
		const limited = [new Float32Array(128)];
		limiter.process([[input]], [limited]);
		const ceiling = 10 ** (-6 / 20);
		assert.ok(Math.max(...limited[0].map(Math.abs)) <= ceiling + 1e-6);
		assert.ok(limited[0].slice(0, 48).every((sample) => sample === 0));
	} finally {
		if (previousSampleRate === undefined) delete globalThis.sampleRate;
		else globalThis.sampleRate = previousSampleRate;
	}
});

test('delay worklet keeps feedback taps sample-accurate across render quanta', () => {
	const previousSampleRate = globalThis.sampleRate;
	globalThis.sampleRate = 8_000;
	try {
		const delay = new DelayProcessor({
			processorOptions: {
				sampleRate: 8_000,
				maximumSeconds: 1,
				params: { time: 0.01, feedback: 0.5, mix: 1 },
			},
		});
		const rendered = new Float32Array(512);
		for (let blockStart = 0; blockStart < rendered.length; blockStart += 128) {
			const input = new Float32Array(128);
			if (blockStart === 0) input[16] = 1;
			const output = new Float32Array(128);
			assert.equal(delay.process([[input]], [[output]]), true);
			rendered.set(output, blockStart);
		}

		assert.deepEqual(
			[...rendered.entries()].filter(([, sample]) => sample !== 0),
			[
				[96, 1],
				[176, 0.5],
				[256, 0.25],
				[336, 0.125],
				[416, 0.0625],
				[496, 0.03125],
			],
		);
	} finally {
		if (previousSampleRate === undefined) delete globalThis.sampleRate;
		else globalThis.sampleRate = previousSampleRate;
	}
});

test('delay worklet preserves feedback history when live parameters change', () => {
	const delay = new DelayProcessor({
		processorOptions: {
			sampleRate: 8_000,
			maximumSeconds: 1,
			params: { time: 0.01, feedback: 0.5, mix: 1 },
		},
	});
	const firstInput = new Float32Array(128);
	firstInput[16] = 1;
	const firstOutput = new Float32Array(128);
	delay.process([[firstInput]], [[firstOutput]]);
	assert.equal(firstOutput[96], 1);

	delay.configure({ feedback: 0.25 });
	const secondOutput = new Float32Array(128);
	delay.process([[new Float32Array(128)]], [[secondOutput]]);
	assert.equal(secondOutput[48], 0.5, 'the repeat already stored before configuration remains audible');
	assert.equal(secondOutput[128 - 1], 0);

	const thirdOutput = new Float32Array(128);
	delay.process([[new Float32Array(128)]], [[thirdOutput]]);
	assert.equal(thirdOutput[0], 0.125, 'new feedback applies without resetting the delay line');
});

test('realtime render worklet emits bounded stereo chunks at the requested frame range', () => {
	const previousFrame = globalThis.currentFrame;
	globalThis.currentFrame = 0;
	try {
		const processor = new RenderCaptureProcessor({ processorOptions: { startFrame: 64, totalFrames: 160, chunkFrames: 128 } });
		const messages = [];
		processor.port.postMessage = (message, transfer = []) => messages.push({ message, transfer });
		const left = Float32Array.from({ length: 128 }, (_, index) => index / 128);
		const right = Float32Array.from({ length: 128 }, (_, index) => -index / 128);
		assert.equal(processor.process([[left, right]], [[new Float32Array(128), new Float32Array(128)]]), true);
		globalThis.currentFrame = 128;
		assert.equal(processor.process([[left, right]], [[new Float32Array(128), new Float32Array(128)]]), false);
		const chunks = messages.filter(({ message }) => message.type === 'audio-chunk');
		assert.deepEqual(chunks.map(({ message }) => message.frames), [128, 32]);
		assert.equal(chunks[0].message.channels.length, 2);
		assert.equal(chunks[0].transfer.length, 2);
		assert.equal(messages.at(-1).message.type, 'done');
		assert.equal(messages.at(-1).message.frames, 160);
	} finally {
		if (previousFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousFrame;
	}
});

test('engine primes independent long-source clips concurrently with one worklet load', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	const project = createProject();
	project.sources = ['source-1', 'source-2'].map((id) => ({
		id,
		frameCount: 48_000,
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 65_536,
	}));
	project.clips = [
		{ ...project.clips[0], id: 'clip-1', sourceId: 'source-1' },
		{ ...project.clips[0], id: 'clip-2', sourceId: 'source-2' },
	];
	project.tracks[0].clipIds = ['clip-1', 'clip-2'];
	const providers = new Map(project.sources.map((source) => [source.id, {
		channelCount: source.channelCount,
		frameCount: source.frameCount,
		chunkFrames: source.chunkFrames,
		sampleRate: source.sampleRate,
		async readStorageChunk() { return [new Float32Array(source.frameCount)]; },
	}]));
	const handles = [];
	const streamClient = {
		open() {
			let resolvePrimed;
			let resolveDone;
			const handle = {
				ready: Promise.resolve(),
				primed: new Promise((resolve) => { resolvePrimed = resolve; }),
				done: new Promise((resolve) => { resolveDone = resolve; }),
				resolvePrimed,
				resolveDone,
				play() {},
				cancel() { resolveDone(); },
			};
			handle.resolvePrimed = resolvePrimed;
			handle.resolveDone = resolveDone;
			handles.push(handle);
			return handle;
		},
		dispose() {},
	};
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		chunkStreamClient: streamClient,
		meterInterval: 1_000,
	});
	try {
		engine.loadProject(project, new Map(), { chunkSources: providers });
		const playback = engine.play();
		for (let attempt = 0; attempt < 10 && handles.length < 2; attempt += 1) {
			await new Promise((resolve) => setImmediate(resolve));
		}
		assert.equal(handles.length, 2, 'all long-source streams open before any one finishes priming');
		assert.equal(
			context.audioWorkletModules.filter((url) => url.endsWith('/chunk-stream-worklet.js')).length,
			1,
		);
		for (const handle of handles) handle.resolvePrimed();
		await playback;
		assert.equal(engine.graph.sources.size, 2);
		assert.equal(engine.graph.nodes.transientNodes.size, 8);
		handles[0].resolveDone();
		await Promise.resolve();
		assert.equal(engine.graph.sources.size, 1);
		assert.equal(engine.graph.nodes.transientNodes.size, 4);
		assert.equal(
			context.workletNodes.find((node) => node.name === 'kw-audio-chunk-stream')?.disconnected,
			true,
		);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

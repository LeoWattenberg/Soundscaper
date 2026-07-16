import test from 'node:test';
import assert from 'node:assert/strict';

import { createAudioEditorEngine } from '../src/lib/tools/audio-editor/engine.js';
import {
	AUDIO_EDITOR_PCM_SINK_MAX_PENDING_CHUNKS,
	createAsyncPlanarPcmSinkQueue,
} from '../src/lib/tools/audio-editor/pcm-sink.js';

function packet(...values) {
	return [Float32Array.from(values)];
}

test('async PCM sink queue serializes writes and reports committed geometry', async () => {
	let releaseFirst;
	const firstWrite = new Promise((resolve) => { releaseFirst = resolve; });
	const calls = [];
	let activeWrites = 0;
	let maximumActiveWrites = 0;
	const sink = {
		name: 'fixture sink',
		async write(channels, metadata) {
			assert.equal(this.name, 'fixture sink');
			activeWrites += 1;
			maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
			calls.push({ channels, metadata });
			if (calls.length === 1) await firstWrite;
			activeWrites -= 1;
		},
	};
	const queue = createAsyncPlanarPcmSinkQueue(sink);
	assert.equal(queue.maximumPendingChunks, AUDIO_EDITOR_PCM_SINK_MAX_PENDING_CHUNKS);
	assert.equal(queue.enqueue(packet(1, 2), { frameOffset: 0, frames: 99 }), true);
	assert.equal(queue.enqueue(packet(3, 4, 5), { frameOffset: 2 }), true);
	await Promise.resolve();
	assert.equal(calls.length, 1, 'a later write waits for the active sink write');
	assert.equal(queue.pendingChunks, 2);
	releaseFirst();
	const result = await queue.finish();

	assert.equal(maximumActiveWrites, 1);
	assert.deepEqual(calls.map(({ metadata }) => metadata), [
		{ frameOffset: 0, frames: 2 },
		{ frameOffset: 2, frames: 3 },
	]);
	assert.deepEqual(result, { chunkCount: 2, frameCount: 5 });
	assert.equal(queue.state, 'finished');
	assert.equal(queue.pendingChunks, 0);
	assert.equal(queue.acceptedFrames, 5);
	assert.equal(queue.writtenFrames, 5);
	assert.throws(() => queue.enqueue(packet(6)), /closed/);
	assert.equal(await queue.finish(), result, 'finish is idempotent');
});

test('async PCM sink queue fails at its fixed pending-packet bound', async () => {
	const errors = [];
	const queue = createAsyncPlanarPcmSinkQueue(async () => {}, {
		maximumPendingChunks: 2,
		onError: (error) => errors.push(error),
	});
	assert.equal(queue.enqueue(packet(1)), true);
	assert.equal(queue.enqueue(packet(2)), true);
	assert.equal(queue.enqueue(packet(3)), false);
	assert.equal(queue.pendingChunks, 2, 'the rejected packet is never retained');
	assert.equal(errors.length, 1);
	assert.equal(errors[0].code, 'PCM_SINK_BACKPRESSURE');
	assert.match(errors[0].message, /2-chunk pending-write limit/);
	await assert.rejects(queue.finish(), errors[0]);
	assert.equal(queue.pendingChunks, 0);
	assert.equal(queue.writtenChunks, 0, 'atomic failure skips writes that had not started');
});

test('async PCM sink queue reports the first writer failure and skips queued packets', async () => {
	const sinkFailure = new Error('disk write failed');
	const errors = [];
	let writes = 0;
	const queue = createAsyncPlanarPcmSinkQueue(async () => {
		writes += 1;
		throw sinkFailure;
	}, { onError: (error) => errors.push(error) });
	queue.enqueue(packet(1, 2));
	queue.enqueue(packet(3, 4));
	await assert.rejects(queue.finish(), sinkFailure);
	assert.equal(writes, 1);
	assert.deepEqual(errors, [sinkFailure]);
	assert.equal(queue.failure, sinkFailure);
	assert.equal(queue.state, 'failed');
	await assert.rejects(queue.settled(), sinkFailure);
	assert.throws(() => queue.enqueue(packet(5)), sinkFailure);
});

test('async PCM sink queue rejects malformed packets and explicit aborts', async () => {
	let writes = 0;
	const malformed = createAsyncPlanarPcmSinkQueue(async () => { writes += 1; });
	assert.equal(malformed.enqueue([Float32Array.of(1), Float32Array.of(1, 2)]), false);
	await assert.rejects(malformed.finish(), /equally sized Float32Array/);
	assert.equal(writes, 0);

	const aborted = createAsyncPlanarPcmSinkQueue(async () => { writes += 1; });
	const reason = new Error('cancelled');
	assert.equal(aborted.abort(reason), true);
	assert.equal(aborted.abort(new Error('later reason')), false);
	await assert.rejects(aborted.settled(), reason);
	assert.equal(writes, 0);
});

test('renderMixToSink adapts a storage-writer-shaped sink without closing it', async () => {
	const engine = createAudioEditorEngine();
	const calls = [];
	let receivedOptions = null;
	let closed = false;
	const sink = {
		async write(channels, metadata) {
			calls.push({ channels, metadata, receiver: this });
		},
		async close() { closed = true; },
	};
	engine.renderMixRealtime = async (options) => {
		receivedOptions = options;
		await options.onChunk(packet(0.25, 0.5), { frameOffset: 12, sampleRate: 48_000 });
		return { sampleRate: 48_000, channelCount: 1, frameCount: 2, chunkCount: 1 };
	};

	const result = await engine.renderMixToSink({
		sink,
		startFrame: 12,
		endFrame: 14,
		includeTrackPan: false,
	});
	assert.deepEqual(result, { sampleRate: 48_000, channelCount: 1, frameCount: 2, chunkCount: 1 });
	assert.equal(receivedOptions.startFrame, 12);
	assert.equal(receivedOptions.endFrame, 14);
	assert.equal(receivedOptions.includeTrackPan, false);
	assert.equal(Object.hasOwn(receivedOptions, 'sink'), false);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].receiver, sink);
	assert.equal(calls[0].metadata.frameOffset, 12);
	assert.equal(closed, false, 'the sink owner retains commit/abort responsibility');
	await assert.rejects(engine.renderMixToSink(), /planar PCM sink/);
});

test('renderTrackToSink forces isolated-track mixer semantics', async () => {
	const engine = createAudioEditorEngine();
	engine.loadProject({
		sampleRate: 48_000,
		tracks: [{ id: 'track-1', type: 'audio' }],
		clips: [],
	}, new Map());
	engine.renderMixToSink = async (options) => options;
	const sink = async () => {};
	const options = await engine.renderTrackToSink('track-1', {
		sink,
		trackId: 'wrong-track',
		includeMaster: true,
		respectMuteSolo: true,
	});
	assert.equal(options.sink, sink);
	assert.equal(options.trackId, 'track-1');
	assert.equal(options.includeMaster, false);
	assert.equal(options.respectMuteSolo, false);
	await assert.rejects(engine.renderTrackToSink('missing', { sink }), /could not be found/);
});

test('realtime engine drains serialized sink writes before completing', async () => {
	let releaseFirst;
	const firstWrite = new Promise((resolve) => { releaseFirst = resolve; });
	let markFirstStarted;
	const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
	let activeWrites = 0;
	let maximumActiveWrites = 0;
	const writes = [];
	const progress = [];
	await withMockRealtimeRenderer((context) => {
		context.emit({
			type: 'audio-chunk', frameOffset: 0,
			channels: [Float32Array.of(1, 2), Float32Array.of(-1, -2)],
		});
		context.emit({
			type: 'audio-chunk', frameOffset: 2,
			channels: [Float32Array.of(3, 4), Float32Array.of(-3, -4)],
		});
		context.emit({ type: 'done', frames: 4 });
	}, async (contexts) => {
		const engine = createRealtimeFixtureEngine();
		const pending = engine.renderMixToSink({
			sink: async (channels, metadata) => {
				activeWrites += 1;
				maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
				writes.push({ channels, metadata });
				if (writes.length === 1) {
					markFirstStarted();
					await firstWrite;
				}
				activeWrites -= 1;
			},
			outputFrames: 4,
			chunkFrames: 128,
			onProgress: (value) => progress.push(value),
		});
		await firstStarted;
		assert.equal(writes.length, 1);
		releaseFirst();
		assert.deepEqual(await pending, {
			sampleRate: 48_000,
			channelCount: 2,
			frameCount: 4,
			chunkCount: 2,
		});
		assert.equal(maximumActiveWrites, 1);
		assert.deepEqual(writes.map(({ metadata }) => metadata), [
			{ frameOffset: 0, sampleRate: 48_000, frames: 2 },
			{ frameOffset: 2, sampleRate: 48_000, frames: 2 },
		]);
		assert.deepEqual(progress.map(({ progress: value }) => value), [0.5, 1]);
		assert.equal(contexts.length, 1);
		assert.equal(contexts[0].closed, true);
		assert.equal(contexts[0].modules.length, 1);
	});
});

test('realtime engine aborts immediately when its async sink fails', async () => {
	const failure = new Error('OPFS write failed');
	await withMockRealtimeRenderer((context) => {
		context.emit({
			type: 'audio-chunk', frameOffset: 0,
			channels: [Float32Array.of(1), Float32Array.of(1)],
		});
	}, async (contexts) => {
		const engine = createRealtimeFixtureEngine();
		await assert.rejects(engine.renderMixToSink({
			sink: async () => { throw failure; },
			outputFrames: 1,
		}), failure);
		assert.equal(contexts[0].closed, true);
	});
});

test('realtime engine treats progress callback failures as render failures', async () => {
	const failure = new Error('progress observer failed');
	await withMockRealtimeRenderer((context) => {
		context.emit({
			type: 'audio-chunk', frameOffset: 0,
			channels: [Float32Array.of(1), Float32Array.of(1)],
		});
	}, async (contexts) => {
		const engine = createRealtimeFixtureEngine();
		await assert.rejects(engine.renderMixToSink({
			sink: async () => {},
			outputFrames: 1,
			onProgress() { throw failure; },
		}), failure);
		assert.equal(contexts[0].closed, true);
	});
});

test('realtime engine rejects producer overrun without retaining an unbounded queue', async () => {
	let writes = 0;
	await withMockRealtimeRenderer((context) => {
		for (let index = 0; index <= AUDIO_EDITOR_PCM_SINK_MAX_PENDING_CHUNKS; index += 1) {
			context.emit({
				type: 'audio-chunk', frameOffset: index,
				channels: [Float32Array.of(index), Float32Array.of(-index)],
			});
		}
	}, async (contexts) => {
		const engine = createRealtimeFixtureEngine();
		await assert.rejects(engine.renderMixToSink({
			sink: async () => { writes += 1; },
			outputFrames: AUDIO_EDITOR_PCM_SINK_MAX_PENDING_CHUNKS + 1,
		}), (error) => error?.code === 'PCM_SINK_BACKPRESSURE');
		assert.equal(writes, 0, 'queued writes are discarded when the render can no longer be atomic');
		assert.equal(contexts[0].closed, true);
	});
});

function createRealtimeFixtureEngine() {
	const engine = createAudioEditorEngine();
	engine.loadProject({
		sampleRate: 48_000,
		tracks: [],
		clips: [],
		master: { gain: 1, pan: 0, mute: false, effects: [] },
	}, new Map());
	return engine;
}

async function withMockRealtimeRenderer(onResume, run) {
	const previousAudioContext = globalThis.AudioContext;
	const previousAudioWorkletNode = globalThis.AudioWorkletNode;
	const contexts = [];
	class MockParam {
		constructor(value = 1) { this.value = value; }
		setValueAtTime(value) { this.value = value; }
	}
	class MockNode {
		constructor() { this.connections = []; }
		connect(target) { this.connections.push(target); return target; }
		disconnect() { this.connections.length = 0; }
	}
	class MockRealtimeAudioContext {
		constructor(options = {}) {
			this.sampleRate = options.sampleRate || 48_000;
			this.currentTime = 0;
			this.state = 'suspended';
			this.destination = new MockNode();
			this.modules = [];
			this.audioWorklet = { addModule: async (url) => { this.modules.push(url); } };
			this.closed = false;
			contexts.push(this);
		}
		createGain() {
			const node = new MockNode();
			node.gain = new MockParam();
			return node;
		}
		async resume() {
			this.state = 'running';
			await onResume(this);
		}
		emit(data) { this.capture?.port.onmessage?.({ data }); }
		async close() { this.state = 'closed'; this.closed = true; }
	}
	class MockCaptureNode extends MockNode {
		constructor(context) {
			super();
			this.port = { onmessage: null, start() {} };
			this.onprocessorerror = null;
			context.capture = this;
		}
	}
	globalThis.AudioContext = MockRealtimeAudioContext;
	globalThis.AudioWorkletNode = MockCaptureNode;
	try {
		await run(contexts);
	} finally {
		if (previousAudioContext === undefined) delete globalThis.AudioContext;
		else globalThis.AudioContext = previousAudioContext;
		if (previousAudioWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousAudioWorkletNode;
	}
}

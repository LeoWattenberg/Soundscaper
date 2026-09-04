import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createAudioEditorEngine,
} from '../src/common/editor/engine.js';
import {
	MockAudioBuffer,
	MockAudioContext,
	MockChunkStreamClient,
} from './helpers/mock-audio-context.js';
import {
	MockOfflineAudioContext,
	createProject,
} from './helpers/audio-editor-runtime-harness.js';

test('engine streams persisted long sources live and schedules bounded chunks through the same offline graph', async () => {
	const realtime = new MockAudioContext();
	const offlineContexts = [];
	const streamClient = new MockChunkStreamClient();
	const project = createProject();
	project.sources = [{ id: 'source-1', frameCount: 70_000, sampleRate: 48_000, channelCount: 1, chunkFrames: 65_536 }];
	project.clips[0].durationFrames = 70_000;
	project.clips[0].sourceDurationFrames = 70_000;
	const reads = [];
	const provider = {
		channelCount: 1,
		frameCount: 70_000,
		chunkFrames: 65_536,
		sampleRate: 48_000,
		async readStorageChunk(index) {
			reads.push(index);
			const frames = index === 0 ? 65_536 : 4_464;
			return [new Float32Array(frames).fill(index ? 0.75 : 0.25)];
		},
	};
	const engine = createAudioEditorEngine({
		audioContextFactory: () => realtime,
		offlineAudioContextFactory: (options) => {
			const context = new MockOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
		chunkStreamClient: streamClient,
		chunkAudioNodeFactory: async (context) => context.make('chunk-stream', {
			port: { postMessage() {}, addEventListener() {}, removeEventListener() {}, start() {} },
		}),
		meterInterval: 1_000,
	});
	engine.loadProject(project, new Map(), { chunkSources: new Map([['source-1', provider]]) });
	assert.equal(await engine.playAt(0, 0), 0.02, 'playAt reports the start deferred for streamed-source priming');
	assert.equal(realtime.bufferSources.length, 0, 'live playback never creates a full-source AudioBufferSource');
	assert.equal(streamClient.opens.length, 1);
	assert.deepEqual(
		[streamClient.opens[0].startFrame, streamClient.opens[0].endFrame],
		[0, 70_000],
	);
	assert.equal(streamClient.handles[0].plays[0].contextStartFrame, 960);
	assert.ok(realtime.nodeKinds.includes('biquad'));
	assert.ok(realtime.nodeKinds.includes('compressor'));
	assert.ok(realtime.nodeKinds.includes('delay'));
	engine.stop();
	assert.equal(streamClient.handles[0].cancelled, true);

	const progress = [];
	await engine.renderMix({
		startFrame: 0,
		endFrame: 70_000,
		onProgress: (value) => progress.push(value.progress),
	});
	assert.deepEqual(reads, [0, 1]);
	assert.equal(offlineContexts.length, 1);
	assert.deepEqual(offlineContexts[0].bufferSources.map((source) => source.buffer.length), [65_536, 4_464]);
	assert.equal(offlineContexts[0].bufferSources.some((source) => source.buffer.length === 70_000), false);
	assert.ok(offlineContexts[0].nodeKinds.includes('biquad'));
	assert.ok(offlineContexts[0].nodeKinds.includes('compressor'));
	assert.ok(offlineContexts[0].nodeKinds.includes('delay'));
	assert.equal(progress.at(-1), 1);
	await engine.dispose();
});

test('stopping playback disconnects a long-source node whose factory resolves late', async () => {
	const context = new MockAudioContext();
	const project = createProject();
	project.sources = [{
		id: 'source-1',
		frameCount: 48_000,
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 65_536,
	}];
	const provider = {
		channelCount: 1,
		frameCount: 48_000,
		chunkFrames: 65_536,
		sampleRate: 48_000,
		async readStorageChunk() { return [new Float32Array(48_000)]; },
	};
	let resolveFactory;
	let markFactoryStarted;
	const factoryStarted = new Promise((resolve) => { markFactoryStarted = resolve; });
	const lateNode = context.make('late-chunk-stream', {
		port: { postMessage() {}, addEventListener() {}, removeEventListener() {}, start() {} },
	});
	const streamClient = {
		opens: 0,
		open() {
			this.opens += 1;
			throw new Error('an aborted late node must not open a stream');
		},
		dispose() {},
	};
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		chunkStreamClient: streamClient,
		chunkAudioNodeFactory: () => {
			markFactoryStarted();
			return new Promise((resolve) => { resolveFactory = resolve; });
		},
		meterInterval: 1_000,
	});
	engine.loadProject(project, new Map(), { chunkSources: new Map([['source-1', provider]]) });
	const playback = engine.play();
	await factoryStarted;
	const graph = engine.graph;
	engine.stop();
	resolveFactory(lateNode);

	await assert.rejects(playback, { name: 'AbortError' });
	assert.equal(streamClient.opens, 0);
	assert.equal(lateNode.disconnected, true);
	assert.equal(graph.sources.size, 0);
	assert.equal(graph.nodes.transientNodes.size, 0);
	await engine.dispose();
});

test('engine source resolver can schedule a committed nondestructive clip cache without changing callers', async () => {
	const context = new MockAudioContext();
	const project = createProject();
	project.clips[0].reversed = true;
	const original = new MockAudioBuffer(1, 48_000, 48_000);
	const committed = new MockAudioBuffer(1, 24_000, 48_000);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		sourceResolver: (clip, { defaultBuffer }) => {
			assert.equal(clip.id, 'clip-1');
			assert.equal(defaultBuffer, original);
			return {
				buffer: committed,
				sourceStartFrame: 0,
				sourceDurationFrames: committed.length,
				reversed: false,
			};
		},
		meterInterval: 1_000,
	});
	engine.loadProject(project, new Map([['source-1', original]]));
	await engine.play();
	assert.equal(context.bufferSources.length, 1);
	assert.equal(context.bufferSources[0].buffer, committed);
	assert.deepEqual(context.bufferSources[0].started, [0, 0, 0.5]);
	assert.equal(engine.setSourceResolver(null), engine);
	engine.stop();
	await engine.dispose();
});

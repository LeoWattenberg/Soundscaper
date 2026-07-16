import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_PCM_CHUNK_FRAMES,
	createPlanarPcmChunkCoalescer,
} from '../src/lib/tools/audio-editor/pcm-chunks.js';

test('recording-sized packets coalesce into 65,536-frame planar chunks and one remainder', async () => {
	const chunks = [];
	const metadata = [];
	const coalescer = createPlanarPcmChunkCoalescer({
		onChunk: async (channels, details) => {
			chunks.push(channels);
			metadata.push(details);
		},
	});
	for (let packet = 0; packet < 17; packet += 1) {
		const start = packet * 4_096;
		await coalescer.write([
			Float32Array.from({ length: 4_096 }, (_, frame) => start + frame),
			Float32Array.from({ length: 4_096 }, (_, frame) => -(start + frame)),
		]);
	}

	assert.equal(coalescer.chunkFrames, AUDIO_EDITOR_PCM_CHUNK_FRAMES);
	assert.equal(coalescer.channelCount, 2);
	assert.equal(coalescer.framesWritten, 69_632);
	assert.equal(coalescer.framesEmitted, 65_536);
	assert.equal(coalescer.pendingFrames, 4_096);
	assert.deepEqual(chunks.map((channels) => channels[0].length), [65_536]);

	const result = await coalescer.finalize();
	assert.deepEqual(chunks.map((channels) => channels[0].length), [65_536, 4_096]);
	assert.deepEqual(metadata.map(({ index, frames, final }) => ({ index, frames, final })), [
		{ index: 0, frames: 65_536, final: false },
		{ index: 1, frames: 4_096, final: true },
	]);
	assert.equal(chunks[0][0][0], 0);
	assert.equal(chunks[0][0][65_535], 65_535);
	assert.equal(chunks[1][0][0], 65_536);
	assert.equal(chunks[1][1][4_095], -69_631);
	assert.deepEqual(result, {
		channelCount: 2,
		frameCount: 69_632,
		chunkFrames: 65_536,
		chunkCount: 2,
	});
	assert.equal(coalescer.framesEmitted, 69_632);
	assert.equal(coalescer.pendingFrames, 0);
	assert.equal(coalescer.state, 'finalized');
});

test('write awaits chunk consumers and rejects overlapping producers', async () => {
	let releaseFirstChunk;
	let firstChunkStarted;
	const firstChunk = new Promise((resolve) => { firstChunkStarted = resolve; });
	const release = new Promise((resolve) => { releaseFirstChunk = resolve; });
	const chunks = [];
	const coalescer = createPlanarPcmChunkCoalescer({
		chunkFrames: 4,
		onChunk: async (channels) => {
			chunks.push(channels[0]);
			if (chunks.length === 1) {
				firstChunkStarted();
				await release;
			}
		},
	});

	const write = coalescer.write([Float32Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8)]);
	await firstChunk;
	assert.equal(coalescer.framesWritten, 4);
	assert.equal(coalescer.framesEmitted, 0);
	assert.deepEqual(chunks.map((channel) => [...channel]), [[0, 1, 2, 3]]);
	await assert.rejects(
		coalescer.write([Float32Array.of(9)]),
		/already in progress/,
	);
	await assert.rejects(coalescer.finalize(), /still in progress/);

	releaseFirstChunk();
	await write;
	assert.deepEqual(chunks.map((channel) => [...channel]), [
		[0, 1, 2, 3],
		[4, 5, 6, 7],
	]);
	assert.equal(coalescer.framesWritten, 9);
	assert.equal(coalescer.pendingFrames, 1);
	await coalescer.finalize();
	assert.deepEqual(chunks.map((channel) => [...channel]), [
		[0, 1, 2, 3],
		[4, 5, 6, 7],
		[8],
	]);
});

test('packet validation preserves channel consistency without corrupting buffered PCM', async () => {
	const chunks = [];
	const coalescer = createPlanarPcmChunkCoalescer({
		chunkFrames: 4,
		onChunk: (channels) => { chunks.push(channels); },
	});
	await coalescer.write([Float32Array.of(1, 2), Float32Array.of(10, 20)]);
	await assert.rejects(
		coalescer.write([Float32Array.of(3, 4)]),
		/channel count changed/,
	);
	await assert.rejects(
		coalescer.write([Float32Array.of(3, 4), Float32Array.of(30)]),
		/equally sized Float32Array/,
	);
	await assert.rejects(
		coalescer.write([Float32Array.of(3, 4), [30, 40]]),
		/equally sized Float32Array/,
	);
	assert.equal(coalescer.state, 'open');
	assert.equal(coalescer.framesWritten, 2);

	await coalescer.write([Float32Array.of(3, 4), Float32Array.of(30, 40)]);
	await coalescer.finalize();
	assert.deepEqual(chunks.map((channels) => channels.map((channel) => [...channel])), [
		[[1, 2, 3, 4], [10, 20, 30, 40]],
	]);
});

test('finalize is idempotent and never emits a remainder twice', async () => {
	const chunks = [];
	const coalescer = createPlanarPcmChunkCoalescer({
		chunkFrames: 4,
		onChunk: async (channels) => { chunks.push(channels); },
	});
	await coalescer.write([Float32Array.of(0.25, -0.25)]);
	const first = await coalescer.finalize();
	const second = await coalescer.finalize();

	assert.strictEqual(second, first);
	assert.equal(chunks.length, 1);
	assert.deepEqual([...chunks[0][0]], [0.25, -0.25]);
	assert.equal(coalescer.abort(), false);
	await assert.rejects(
		coalescer.write([Float32Array.of(0.5)]),
		/coalescer is closed/,
	);
});

test('abort discards a pending remainder and permanently closes the coalescer', async () => {
	let emissions = 0;
	const coalescer = createPlanarPcmChunkCoalescer({
		chunkFrames: 4,
		onChunk: () => { emissions += 1; },
	});
	await coalescer.write([Float32Array.of(1, 2, 3)]);
	assert.equal(coalescer.abort('recording discarded'), true);
	assert.equal(coalescer.abort(), false);
	assert.equal(coalescer.pendingFrames, 0);
	assert.equal(coalescer.state, 'aborted');
	await assert.rejects(coalescer.finalize(), (error) => (
		error.name === 'AbortError' && error.message === 'recording discarded'
	));
	await assert.rejects(coalescer.write([Float32Array.of(4)]), { name: 'AbortError' });
	assert.equal(emissions, 0);
});

test('an AbortSignal cancels finalization and a consumer failure poisons the stream', async () => {
	const controller = new AbortController();
	let signalEmissions = 0;
	const signalled = createPlanarPcmChunkCoalescer({
		chunkFrames: 4,
		signal: controller.signal,
		onChunk: () => { signalEmissions += 1; },
	});
	await signalled.write([Float32Array.of(1, 2)]);
	controller.abort();
	await assert.rejects(signalled.finalize(), { name: 'AbortError' });
	assert.equal(signalled.state, 'aborted');
	assert.equal(signalEmissions, 0);

	const sinkError = new Error('disk write failed');
	const failed = createPlanarPcmChunkCoalescer({
		chunkFrames: 2,
		onChunk: async () => { throw sinkError; },
	});
	await assert.rejects(failed.write([Float32Array.of(1, 2)]), sinkError);
	assert.equal(failed.state, 'failed');
	await assert.rejects(failed.finalize(), sinkError);
	await assert.rejects(failed.write([Float32Array.of(3)]), sinkError);
});

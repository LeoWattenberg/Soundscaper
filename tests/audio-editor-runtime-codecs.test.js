import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createAudioEditorEngine,
} from '../src/common/editor/engine.js';
import {
	createStreamingLinearResampler,
	createStreamingWindowedSincResampler,
} from '../src/common/editor/resample.js';
import { createWavStreamEncoder, encodeWav } from '../src/common/editor/wav.js';
import {
	MockAudioContext,
	MockChunkStreamClient,
} from './helpers/mock-audio-context.js';
import {
	concatenateFloat32,
	createProject,
	textAt,
} from './helpers/audio-editor-runtime-harness.js';

test('WAV encoder writes valid PCM and float headers and supports chunk emission', async () => {
	const pcm = encodeWav([Float32Array.from([-1, 0, 1])], {
		sampleRate: 48000,
		bitDepth: 16,
		dither: false,
	});
	const view = new DataView(pcm.buffer);
	assert.equal(textAt(pcm, 0, 4), 'RIFF');
	assert.equal(textAt(pcm, 8, 4), 'WAVE');
	assert.equal(view.getUint16(20, true), 1);
	assert.equal(view.getUint16(22, true), 1);
	assert.equal(view.getUint32(24, true), 48000);
	assert.equal(view.getUint16(34, true), 16);
	assert.equal(view.getUint32(40, true), 6);
	assert.equal(view.getInt16(44, true), -32768);
	assert.equal(view.getInt16(46, true), 0);
	assert.equal(view.getInt16(48, true), 32767);

	const floating = encodeWav([Float32Array.of(0.25, 1.25)], { float: true, dither: false });
	assert.equal(new DataView(floating.buffer).getUint16(20, true), 3);
	assert.equal(new DataView(floating.buffer).getFloat32(44, true), 0.25);
	assert.equal(new DataView(floating.buffer).getFloat32(48, true), 1.25);

});

test('streaming WAV encoder returns metadata without retaining PCM chunks', async () => {
	const emitted = [];
	const encoder = createWavStreamEncoder({
		totalFrames: 3,
		channelCount: 2,
		bitDepth: 24,
		dither: false,
		onChunk: (chunk, info) => emitted.push({ bytes: chunk.byteLength, ...info }),
	});
	encoder.write([Float32Array.of(0, 0), Float32Array.of(0, 0)]);
	encoder.write([Float32Array.of(0), Float32Array.of(0)]);
	const result = encoder.finalize();
	await encoder.settled();
	assert.equal(result.byteLength, 62);
	assert.equal(result.frames, 3);
	assert.deepEqual(emitted.map((entry) => entry.bytes), [44, 12, 6]);
	assert.deepEqual(emitted.map((entry) => entry.frameOffset), [0, 0, 2]);
	assert.throws(() => encoder.write([Float32Array.of(0), Float32Array.of(0)]), /finalized/);
});

test('streaming resampler is chunk-stable and pads requested tails with silence', () => {
	const input = Float32Array.from({ length: 480 }, (_, index) => Math.sin(index / 17));
	const oneShot = createStreamingLinearResampler(48_000, 44_100, 1);
	const oneShotParts = [oneShot.push([input])[0], oneShot.finish(500)[0]];
	const chunked = createStreamingLinearResampler(48_000, 44_100, 1);
	const chunkedParts = [
		chunked.push([input.subarray(0, 137)])[0],
		chunked.push([input.subarray(137, 391)])[0],
		chunked.push([input.subarray(391)])[0],
		chunked.finish(500)[0],
	];
	const expected = concatenateFloat32(oneShotParts);
	const actual = concatenateFloat32(chunkedParts);
	assert.equal(actual.length, 500);
	assert.deepEqual(actual, expected);
	assert.equal(actual.at(-1), 0);
	assert.equal(actual.at(-20), 0);
});

test('windowed-sinc resampler is deterministic across chunk boundaries and rejects alias energy', () => {
	const input = Float32Array.from({ length: 4_800 }, (_, index) => (
		0.6 * Math.sin(2 * Math.PI * 1_000 * index / 48_000)
		+ 0.4 * Math.sin(2 * Math.PI * 20_000 * index / 48_000)
	));
	const oneShot = createStreamingWindowedSincResampler(48_000, 16_000, 1);
	const expected = concatenateFloat32([oneShot.push([input])[0], oneShot.finish()[0]]);
	const chunked = createStreamingWindowedSincResampler(48_000, 16_000, 1);
	const actual = concatenateFloat32([
		chunked.push([input.subarray(0, 777)])[0],
		chunked.push([input.subarray(777, 3_211)])[0],
		chunked.push([input.subarray(3_211)])[0],
		chunked.finish()[0],
	]);
	assert.equal(actual.length, 1_600);
	assert.equal(chunked.inputFrames, 4_800);
	assert.equal(chunked.outputFrames, 1_600);
	for (let index = 0; index < actual.length; index += 1) {
		assert.ok(Math.abs(actual[index] - expected[index]) < 1e-6);
	}
	const rms = Math.sqrt(actual.reduce((sum, sample) => sum + sample * sample, 0) / actual.length);
	assert.ok(rms > 0.35 && rms < 0.5, `unexpected band-limited RMS ${rms}`);

	const padded = createStreamingWindowedSincResampler(48_000, 16_000, 1);
	const paddedOutput = concatenateFloat32([padded.push([input])[0], padded.finish(1_650)[0]]);
	assert.equal(paddedOutput.length, 1_650);
	assert.deepEqual([...paddedOutput.slice(-50)], [...new Float32Array(50)]);
});

test('windowed-sinc equal-rate streams preserve exact chunks and finish padding', () => {
	const first = [
		Float32Array.from({ length: 24 }, (_, index) => index / 24),
		Float32Array.from({ length: 24 }, (_, index) => -index / 24),
	];
	const second = [
		Float32Array.of(-1, -0.5, 0, 0.5, 1),
		Float32Array.of(1, 0.5, 0, -0.5, -1),
	];
	const resampler = createStreamingWindowedSincResampler(48_000, 48_000, 2);
	const firstOutput = resampler.push(first);
	const secondOutput = resampler.push(second);

	assert.equal(resampler.latencyInputFrames, 0);
	assert.strictEqual(firstOutput[0], first[0]);
	assert.strictEqual(firstOutput[1], first[1]);
	assert.strictEqual(secondOutput[0], second[0]);
	assert.strictEqual(secondOutput[1], second[1]);
	assert.equal(resampler.inputFrames, 29);
	assert.equal(resampler.outputFrames, 29);

	const tail = resampler.finish(32);
	assert.deepEqual([...tail[0]], [0, 0, 0]);
	assert.deepEqual([...tail[1]], [0, 0, 0]);
	assert.equal(resampler.outputFrames, 32);
	assert.deepEqual(resampler.finish().map((channel) => channel.length), [0, 0]);
	assert.throws(() => resampler.push([new Float32Array(1), new Float32Array(1)]), /finished/);
});

test('windowed-sinc equal-rate preserves a nonzero initial input position', () => {
	const input = Float32Array.from({ length: 48 }, (_, index) => index % 2 ? -1 : 1);
	const resampler = createStreamingWindowedSincResampler(48_000, 48_000, 1, {
		initialInputPosition: 0.5,
	});
	const head = resampler.push([input]);

	assert.equal(resampler.latencyInputFrames, 24);
	assert.notStrictEqual(head[0], input);
	assert.equal(head[0].length, 24);
	const output = concatenateFloat32([head[0], resampler.finish()[0]]);
	assert.equal(output.length, 48);
	assert.notDeepEqual(output, input);
});

test('engine requests worker-side windowed-sinc conversion for arbitrary long-source rates', async () => {
	const context = new MockAudioContext({ sampleRate: 48_000 });
	const streamClient = new MockChunkStreamClient();
	const project = createProject();
	project.sources = [{ id: 'source-1', frameCount: 44_100, sampleRate: 44_100, channelCount: 1, chunkFrames: 65_536 }];
	project.clips[0].durationFrames = 48_000;
	project.clips[0].sourceDurationFrames = 44_100;
	const provider = {
		channelCount: 1,
		frameCount: 44_100,
		chunkFrames: 65_536,
		sampleRate: 44_100,
		async readStorageChunk() { return [new Float32Array(44_100)]; },
	};
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		chunkStreamClient: streamClient,
		chunkAudioNodeFactory: async (audioContext) => audioContext.make('chunk-stream', {
			port: { postMessage() {}, addEventListener() {}, removeEventListener() {}, start() {} },
		}),
		meterInterval: 1_000,
	});
	engine.loadProject(project, new Map(), { chunkSources: new Map([['source-1', provider]]) });
	engine.seek(1);
	await engine.play();
	assert.equal(streamClient.opens.length, 1);
	assert.deepEqual({
		sourceStartFrame: streamClient.opens[0].sourceStartFrame,
		sourceEndFrame: streamClient.opens[0].sourceEndFrame,
		outputFrameCount: streamClient.opens[0].outputFrameCount,
	}, { sourceStartFrame: 0, sourceEndFrame: 44_100, outputFrameCount: 47_999 });
	assert.ok(Math.abs(streamClient.opens[0].resampleInputFrames - 44_099.08125) < 1e-6);
	assert.ok(Math.abs(streamClient.opens[0].resampleInputOffset - 0.91875) < 1e-6);
	assert.equal(context.bufferSources.length, 0);
	engine.stop();
	await engine.playAtSpeed(2);
	assert.equal(streamClient.opens.length, 2);
	assert.equal(streamClient.opens[1].outputFrameCount, 24_000);
	assert.ok(Math.abs(streamClient.opens[1].resampleInputFrames - 44_100) < 1e-6);
	engine.stop();
	await engine.dispose();
});

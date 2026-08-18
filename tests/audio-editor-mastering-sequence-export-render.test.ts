/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMasteringSequenceV23 } from '../src/common/editor/mastering-sequence.ts';
import { createMasteringSequenceDeliveryPlan } from '../src/common/editor/mastering-sequence-delivery.ts';
import { renderMasteringSequenceExport } from '../src/common/editor/controller/mastering-sequence-export-render.ts';
import { renderAndEncodeAudioExport } from '../src/common/editor/controller/audio-export-render-orchestration.ts';

const REGIONS = [
	{ id: 'a', sequenceId: 'main', name: 'One', startFrame: 0, endFrame: 8 },
	{ id: 'b', sequenceId: 'main', name: 'Two', startFrame: 100, endFrame: 104 },
];

const deliveryPlan = (entries: readonly unknown[]) => createMasteringSequenceDeliveryPlan(
	createMasteringSequenceV23({ id: 'album', sequenceId: 'main', name: 'Album', entries }),
	REGIONS,
);

interface RenderCall { startFrame: number; endFrame: number; outputFrames: number; includeTail: unknown }

function renderRuntime(calls: RenderCall[], sampleRate = 48_000) {
	return {
		audioBufferChannels: (buffer: unknown) => (buffer as { channels: readonly Float32Array[] }).channels,
		copy: { rendering: 'Rendering' },
		renderSnapshot(_snapshot: unknown, range: RenderCall) {
			calls.push(range);
			// Every frame carries the project position it came from, so a misplaced
			// segment is visible in the delivered samples rather than only in a count.
			return {
				sampleRate,
				channels: [Float32Array.from(
					{ length: range.outputFrames },
					(_value, index) => range.startFrame + index,
				)],
			};
		},
		resampleBuffer(
			buffer: { sampleRate: number },
			rate: number,
			_context: undefined,
			_copy: unknown,
			outputFrames: number,
		) {
			const input = buffer as unknown as { channels: readonly Float32Array[] };
			return {
				sampleRate: rate,
				channels: input.channels.map((channel) => Float32Array.from(
					{ length: outputFrames },
					(_value, index) => channel[Math.min(channel.length - 1, index)],
				)),
			};
		},
		throwIfAborted(signal: AbortSignal) { if (signal.aborted) throw new Error('aborted'); },
	};
}

const request = (plan: ReturnType<typeof deliveryPlan>, overrides: Record<string, unknown> = {}) => ({
	channelCount: 1,
	chunkSources: null,
	deliveryPlan: plan,
	outputSampleRate: 48_000,
	prepareTimePitchCaches: false,
	progressRange: { start: 0, end: 1 },
	renderSampleRate: 48_000,
	signal: new AbortController().signal,
	snapshot: { sampleRate: 48_000 },
	sourceMap: new Map(),
	...overrides,
});

test('each entry is rendered over its own region and lands at its delivered position', async () => {
	const calls: RenderCall[] = [];
	const delivered = await renderMasteringSequenceExport(renderRuntime(calls), request(deliveryPlan([
		{ id: 'e1', annotationId: 'a' },
		{ id: 'e2', annotationId: 'b', gapBeforeFrames: 3 },
	])));

	assert.deepEqual(calls.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [[0, 8], [100, 104]]);
	assert.deepEqual(calls.map(({ includeTail }) => includeTail), [false, false],
		'a region ends where it ends; an effect tail past it is audio the sequence did not name');
	assert.equal(delivered.sampleRate, 48_000);
	assert.equal(delivered.length, 15);
	assert.deepEqual([...delivered.channels[0]], [
		0, 1, 2, 3, 4, 5, 6, 7,
		0, 0, 0,
		100, 101, 102, 103,
	]);
});

test('a region named twice is rendered once and delivered twice', async () => {
	// The assembler does not mutate what it copies, so a reprise costs an
	// arrangement rather than a second pass over the same audio.
	const calls: RenderCall[] = [];
	const delivered = await renderMasteringSequenceExport(renderRuntime(calls), request(deliveryPlan([
		{ id: 'e1', annotationId: 'a' },
		{ id: 'e2', annotationId: 'a', fadeOutFrames: 8 },
	])));

	assert.equal(calls.length, 1, 'one render for both entries');
	assert.deepEqual([...delivered.channels[0].subarray(0, 8)], [0, 1, 2, 3, 4, 5, 6, 7]);
	assert.equal(delivered.channels[0][15], 0, 'the second copy fades and the first does not');
	assert.ok(delivered.channels[0][8] === 0 || delivered.channels[0][9] > 0);
});

test('a delivery in another rate resamples each entry to its own delivered extent', async () => {
	const calls: RenderCall[] = [];
	const plan = deliveryPlan([{ id: 'e1', annotationId: 'a' }, { id: 'e2', annotationId: 'b' }]);
	const scaled = {
		...plan,
		segments: plan.segments.map((segment, index) => ({
			...segment,
			outputStartFrame: index === 0 ? 0 : 16,
			outputEndFrame: index === 0 ? 16 : 24,
		})),
		totalFrames: 24,
	};
	const delivered = await renderMasteringSequenceExport(
		renderRuntime(calls, 24_000),
		request(scaled as never, { outputSampleRate: 48_000, renderSampleRate: 24_000 }),
	);

	assert.equal(delivered.length, 24);
	assert.equal(delivered.channels[0].length, 24);
	assert.deepEqual(calls.map(({ outputFrames }) => outputFrames), [8, 4],
		'the render is asked for source frames; the rate conversion happens per entry');
});

test('an aborted delivery stops rendering rather than finishing the sequence', async () => {
	const calls: RenderCall[] = [];
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(() => renderMasteringSequenceExport(
		renderRuntime(calls),
		request(deliveryPlan([{ id: 'e1', annotationId: 'a' }]), { signal: controller.signal }),
	), /aborted/u);
	assert.equal(calls.length, 0);
});

test('the export orchestration renders a sequence and refuses the realtime fallback', async () => {
	const calls: RenderCall[] = [];
	const base = renderRuntime(calls);
	let realtimeAttempts = 0;
	const plan = {
		channelCount: 1,
		channelMapping: { mode: 'preserve' },
		ditherMode: 'none',
		encoding: { floatingPoint: true, sampleFormat: 'float32', bitDepth: 32 },
		format: 'wav',
		masteringSequence: deliveryPlan([
			{ id: 'e1', annotationId: 'a' },
			{ id: 'e2', annotationId: 'b', gapBeforeFrames: 3 },
		]),
		metadata: {},
		mimeType: 'audio/wav',
		outputFrames: 15,
		range: { startFrame: 0, durationFrames: 104, endFrame: 104 },
		render: { strategy: 'offline' },
		sampleRate: 48_000,
		tailFrames: 0,
	};
	let encodedChannels: readonly Float32Array[] = [];

	const output = await renderAndEncodeAudioExport({
		encodingRuntime: {
			...base,
			applyMediaChannelMapping: (channels: readonly Float32Array[]) => channels,
			encodeAiff: () => new Uint8Array(),
			encodeWav: (channels: readonly Float32Array[]) => {
				encodedChannels = channels;
				return new Uint8Array([1]);
			},
			ffmpeg: {} as never,
			setStatus: () => undefined,
		} as never,
		normalizeProjectSampleRate: (rate: number) => rate,
		renderRealtimeEncoded: () => {
			realtimeAttempts += 1;
			return { mimeType: 'audio/wav' };
		},
		renderSnapshot: base.renderSnapshot as never,
	}, {
		plan: plan as never,
		renderSources: { chunkSources: null, prepareTimePitchCaches: false, sourceMap: new Map() },
		settings: {},
		signal: new AbortController().signal,
		snapshot: { sampleRate: 48_000 },
	});

	assert.equal(output.mimeType, 'audio/wav');
	assert.equal(realtimeAttempts, 0, 'a sequence never falls back to the stream');
	assert.deepEqual([...encodedChannels[0]], [
		0, 1, 2, 3, 4, 5, 6, 7,
		0, 0, 0,
		100, 101, 102, 103,
	], 'what is encoded is the assembled sequence, not the project range');
	assert.deepEqual(calls.map(({ startFrame }) => startFrame), [0, 100]);
});

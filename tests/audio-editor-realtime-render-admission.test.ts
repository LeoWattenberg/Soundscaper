/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { validateRealtimeCaptureMessage } from '../src/common/editor/engine/realtime-render-capture.ts';
import {
	AUDIO_EDITOR_PCM_SINK_DEFAULT_MAX_PENDING_CHUNKS,
	AUDIO_EDITOR_PCM_SINK_HARD_MAX_PENDING_CHUNKS,
	AUDIO_EDITOR_PCM_SINK_MAX_CHANNELS,
	AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES,
	AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES,
	AUDIO_EDITOR_PCM_SINK_MAX_PENDING_FRAMES,
	AUDIO_EDITOR_PCM_SINK_MIN_CHUNK_FRAMES,
	planRealtimePcmSinkQueueAdmission,
} from '../src/common/editor/pcm-sink-admission.ts';
import {
	createAsyncPlanarPcmSinkQueue,
} from '../src/common/editor/pcm-sink.js';

test('realtime PCM admission derives exact non-raiseable queue geometry', () => {
	const maximumPacket = planRealtimePcmSinkQueueAdmission({
		channelCount: AUDIO_EDITOR_PCM_SINK_MAX_CHANNELS,
		chunkFrames: AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES,
	});
	assert.deepEqual(maximumPacket, {
		channelCount: 32,
		chunkFrames: 16_384,
		packetBytes: 2 * 1024 ** 2,
		maximumPendingChunks: 16,
		maximumPendingFrames: 262_144,
		maximumPendingBytes: 32 * 1024 ** 2,
		backpressureHighWaterChunks: 8,
	});

	const defaultPacket = planRealtimePcmSinkQueueAdmission({
		channelCount: 32,
		chunkFrames: 4_096,
	});
	assert.equal(defaultPacket.maximumPendingChunks, AUDIO_EDITOR_PCM_SINK_DEFAULT_MAX_PENDING_CHUNKS);
	assert.equal(defaultPacket.maximumPendingBytes, AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES);

	const monoDirect = planRealtimePcmSinkQueueAdmission({
		channelCount: 1,
		chunkFrames: 16_384,
		maximumPendingChunks: 512,
	});
	assert.equal(monoDirect.maximumPendingChunks, AUDIO_EDITOR_PCM_SINK_HARD_MAX_PENDING_CHUNKS);
	assert.equal(monoDirect.maximumPendingFrames, AUDIO_EDITOR_PCM_SINK_MAX_PENDING_FRAMES);
	assert.equal(monoDirect.maximumPendingBytes, AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES);
});

test('realtime PCM admission rejects one packet beyond any configured ceiling', () => {
	const nonDivisibleMaximum = Math.floor(
		AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES
		/ (3 * AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES * Float32Array.BYTES_PER_ELEMENT),
	);
	assert.equal(nonDivisibleMaximum, 170);
	assert.equal(planRealtimePcmSinkQueueAdmission({
		channelCount: 3,
		chunkFrames: AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES,
		maximumPendingChunks: nonDivisibleMaximum,
	}).maximumPendingChunks, nonDivisibleMaximum);
	assert.throws(() => planRealtimePcmSinkQueueAdmission({
		channelCount: 3,
		chunkFrames: AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES,
		maximumPendingChunks: nonDivisibleMaximum + 1,
	}), /32 MiB pending-PCM limit/u);
	assert.throws(() => planRealtimePcmSinkQueueAdmission({
		channelCount: 1,
		chunkFrames: AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES,
		maximumPendingChunks: AUDIO_EDITOR_PCM_SINK_HARD_MAX_PENDING_CHUNKS + 1,
	}), /maximumPendingChunks.*512/u);
});

test('realtime PCM admission keeps hard ceilings and a lower-only backpressure seam', () => {
	const lowered = planRealtimePcmSinkQueueAdmission({
		channelCount: 2,
		chunkFrames: AUDIO_EDITOR_PCM_SINK_MIN_CHUNK_FRAMES,
		maximumPendingChunks: 2,
		maximumPendingBytes: 2_048,
		backpressureHighWaterChunks: 1,
	});
	assert.equal(lowered.maximumPendingBytes, 2_048);
	assert.equal(lowered.backpressureHighWaterChunks, 1);
	assert.throws(() => planRealtimePcmSinkQueueAdmission({
		channelCount: 2,
		chunkFrames: AUDIO_EDITOR_PCM_SINK_MIN_CHUNK_FRAMES,
		maximumPendingChunks: 2,
		maximumPendingBytes: AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES + 1,
	}), /maximumPendingBytes.*33554432/u);
	assert.throws(() => planRealtimePcmSinkQueueAdmission({
		channelCount: 32,
		chunkFrames: AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES,
		backpressureHighWaterChunks: 9,
	}), /backpressureHighWaterChunks.*8/u);
});

test('realtime PCM admission rejects malformed runtime configuration', () => {
	for (const channelCount of [0, -1, 1.5, 33, Number.NaN, Number.POSITIVE_INFINITY, '2', null, {}]) {
		assert.throws(() => planRealtimePcmSinkQueueAdmission({
			channelCount,
			chunkFrames: AUDIO_EDITOR_PCM_SINK_MIN_CHUNK_FRAMES,
		}), /channelCount/u);
	}
	for (const chunkFrames of [0, 127, 128.5, 16_385, Number.NaN, Number.POSITIVE_INFINITY, '128', null, {}]) {
		assert.throws(() => planRealtimePcmSinkQueueAdmission({
			channelCount: 1,
			chunkFrames,
		}), /chunkFrames/u);
	}
	for (const maximumPendingChunks of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null, {}]) {
		assert.throws(() => planRealtimePcmSinkQueueAdmission({
			channelCount: 1,
			chunkFrames: AUDIO_EDITOR_PCM_SINK_MIN_CHUNK_FRAMES,
			maximumPendingChunks,
		}), /maximumPendingChunks/u);
	}
});

test('async PCM sink queue enforces exact pending frame and byte accounting', async () => {
	assert.throws(() => createAsyncPlanarPcmSinkQueue(async () => undefined, {
		maximumPendingChunks: AUDIO_EDITOR_PCM_SINK_HARD_MAX_PENDING_CHUNKS + 1,
	}), /maximumPendingChunks.*512/u);
	assert.throws(() => createAsyncPlanarPcmSinkQueue(async () => undefined, {
		maximumPendingFrames: AUDIO_EDITOR_PCM_SINK_MAX_PENDING_FRAMES + 1,
	}), /maximumPendingFrames.*8388608/u);
	assert.throws(() => createAsyncPlanarPcmSinkQueue(async () => undefined, {
		maximumPendingBytes: AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES + 1,
	}), /maximumPendingBytes.*33554432/u);

	const queue = createAsyncPlanarPcmSinkQueue(async () => undefined, {
		maximumPendingChunks: 4,
		maximumPendingFrames: 4,
		maximumPendingBytes: 16,
	});
	assert.equal(queue.enqueue([Float32Array.of(1, 2), Float32Array.of(-1, -2)]), true);
	assert.deepEqual(
		[queue.pendingChunks, queue.pendingFrames, queue.pendingBytes],
		[1, 2, 16],
	);
	assert.equal(queue.enqueue([Float32Array.of(3)]), false);
	assert.equal(queue.failure?.code, 'PCM_SINK_MEMORY_LIMIT');
	assert.deepEqual(
		[queue.pendingChunks, queue.pendingFrames, queue.pendingBytes],
		[1, 2, 16],
		'a refused packet changes no pending accounting',
	);
	assert.deepEqual(
		[queue.acceptedChunks, queue.acceptedFrames, queue.acceptedBytes],
		[1, 2, 16],
	);
	await assert.rejects(queue.finish(), queue.failure);
	assert.deepEqual([queue.pendingChunks, queue.pendingFrames, queue.pendingBytes], [0, 0, 0]);
});

test('async PCM sink queue rejects packet geometry that can hide retained backing', async () => {
	const shared = Float32Array.of(1);
	const malformedPackets: ReadonlyArray<Readonly<{
		channels: readonly unknown[];
		message: RegExp;
	}>> = [
		{
			channels: Array.from(
				{ length: AUDIO_EDITOR_PCM_SINK_MAX_CHANNELS + 1 },
				() => Float32Array.of(0),
			),
			message: /1 to 32 channels/u,
		},
		{
			channels: [new Float32Array(AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES + 1)],
			message: /at most 16384 frames/u,
		},
		{
			channels: [new Float32Array(new ArrayBuffer(64), 4, 1)],
			message: /tight ArrayBuffer backing/u,
		},
		{ channels: [shared, shared], message: /distinct ArrayBuffer backing/u },
	];
	for (const { channels, message } of malformedPackets) {
		const queue = createAsyncPlanarPcmSinkQueue(async () => undefined);
		assert.equal(queue.enqueue(channels), false);
		await assert.rejects(queue.finish(), message);
		assert.equal(queue.acceptedChunks, 0);
		assert.equal(queue.pendingBytes, 0);
	}
});

test('async PCM sink queue releases accounting without committing an aborted active write', async () => {
	const write = deferred();
	const started = deferred();
	const queue = createAsyncPlanarPcmSinkQueue(async () => {
		started.resolve();
		await write.promise;
	});
	assert.equal(queue.enqueue([Float32Array.of(1, 2, 3)]), true);
	await started.promise;
	const cancellation = new Error('cancelled during write');
	assert.equal(queue.abort(cancellation), true);
	write.resolve();
	await assert.rejects(queue.settled(), cancellation);
	assert.deepEqual(
		[queue.pendingChunks, queue.pendingFrames, queue.pendingBytes],
		[0, 0, 0],
	);
	assert.deepEqual(
		[queue.writtenChunks, queue.writtenFrames, queue.writtenBytes],
		[0, 0, 0],
	);
});

test('realtime engine rejects raiseable queue geometry before creating an AudioContext', async () => {
	const scope = globalThis as typeof globalThis & {
		AudioContext?: typeof AudioContext;
		AudioWorkletNode?: typeof AudioWorkletNode;
	};
	const previousContext = scope.AudioContext;
	const previousNode = scope.AudioWorkletNode;
	let contextConstructions = 0;
	class UnexpectedContext { constructor() { contextConstructions += 1; } }
	class AvailableWorkletNode {}
	scope.AudioContext = UnexpectedContext as unknown as typeof AudioContext;
	scope.AudioWorkletNode = AvailableWorkletNode as unknown as typeof AudioWorkletNode;
	try {
		const engine = createAudioEditorEngine();
		engine.loadProject({
			sampleRate: 48_000,
			masterChannels: 32,
			tracks: [],
			clips: [],
			master: { gain: 1, pan: 0, mute: false, effects: [] },
		});
		await assert.rejects(engine.renderMixToSink({
			sink: async () => undefined,
			outputFrames: 1,
			maximumPendingChunks: 0,
		}), /maximumPendingChunks/u);
		await assert.rejects(engine.renderMixToSink({
			sink: async () => undefined,
			outputFrames: 1,
			chunkFrames: AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES,
			maximumPendingChunks: 17,
		}), /32 MiB pending-PCM limit/u);
		assert.equal(contextConstructions, 0);
	} finally {
		restoreGlobal(scope, 'AudioContext', previousContext);
		restoreGlobal(scope, 'AudioWorkletNode', previousNode);
	}
});

test('realtime capture validation pins packet sequence and exact completion geometry', () => {
	const geometry = Object.freeze({
		channelCount: 2,
		chunkFrames: 128,
		outputFrames: 2,
		renderedFrames: 0,
	});
	assert.deepEqual(validateRealtimeCaptureMessage({
		type: 'audio-chunk',
		frameOffset: 0,
		frames: 2,
		channels: [Float32Array.of(1, 2), Float32Array.of(-1, -2)],
	}, geometry), {
		type: 'audio-chunk',
		frameOffset: 0,
		frames: 2,
		channels: [Float32Array.of(1, 2), Float32Array.of(-1, -2)],
	});
	assert.throws(() => validateRealtimeCaptureMessage({
		type: 'audio-chunk', frameOffset: 0, frames: 1, channels: [[1], [-1]],
	}, geometry), /Float32Array/u);
	assert.throws(() => validateRealtimeCaptureMessage({
		type: 'audio-chunk', frameOffset: 1, frames: 1,
		channels: [Float32Array.of(1), Float32Array.of(-1)],
	}, geometry), /contiguous frame offset/u);
	assert.throws(() => validateRealtimeCaptureMessage({
		type: 'audio-chunk', frameOffset: 0, frames: 2,
		channels: [Float32Array.of(1), Float32Array.of(-1)],
	}, geometry), /declared frame count/u);
	assert.throws(() => validateRealtimeCaptureMessage(
		{ type: 'done', frames: 0 },
		geometry,
	), /completion geometry/u);
	assert.throws(() => validateRealtimeCaptureMessage({
		type: 'capture-error', code: 'REALTIME_CAPTURE_BACKPRESSURE',
	}, geometry), (error: unknown) => (
		error instanceof Error
		&& (error as Error & { code?: string }).code === 'REALTIME_CAPTURE_BACKPRESSURE'
	));
});

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
	let resolve!: () => void;
	const promise = new Promise<void>((settle) => { resolve = settle; });
	return Object.freeze({ promise, resolve });
}

function restoreGlobal<Key extends 'AudioContext' | 'AudioWorkletNode'>(
	scope: typeof globalThis & Partial<Pick<typeof globalThis, Key>>,
	key: Key,
	value: (typeof globalThis)[Key] | undefined,
): void {
	if (value === undefined) delete scope[key];
	else scope[key] = value;
}

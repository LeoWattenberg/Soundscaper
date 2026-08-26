/* SPDX-License-Identifier: AGPL-3.0-only */

/** Operation-owned, bounded-chunk PCM conformance for local inference adapters. */

import { createStreamingWindowedSincResampler } from '../resample.js';
import { createWavStreamEncoder } from '../wav.js';
import {
	localAssistanceAudioWaveGeometry,
	localAssistanceAudioInputProfile,
	type ProfiledAudioOperation,
} from './local-assistance-audio-geometry.ts';

export {
	localAssistanceAudioInputProfile,
	type LocalAssistanceAudioInputProfile,
} from './local-assistance-audio-geometry.ts';

export const LOCAL_ASSISTANCE_PREPARATION_CHUNK_FRAMES = 65_536;

export async function createLocalAssistanceAudioWave(
	operation: ProfiledAudioOperation,
	channelsValue: readonly Float32Array[],
	expectedFrames: number,
	inputSampleRate: number,
	signal?: AbortSignal,
): Promise<Blob> {
	assertChunkGeometry(channelsValue, expectedFrames, channelsValue.length);
	async function* chunks(): AsyncGenerator<readonly Float32Array[]> {
		yield channelsValue;
	}
	return createLocalAssistanceAudioWaveFromChunks(
		operation, chunks(), expectedFrames, inputSampleRate, channelsValue.length, signal,
	);
}

/**
 * Conform a whole fenced selection while retaining only one rendered and one encoded chunk.
 * The resulting Blob remains streamable to desktop custody without another whole-body copy.
 */
export async function createLocalAssistanceAudioWaveFromChunks(
	operation: ProfiledAudioOperation,
	inputChunks: AsyncIterable<readonly Float32Array[]>,
	expectedFrames: number,
	inputSampleRate: number,
	inputChannelCount: number,
	signal?: AbortSignal,
): Promise<Blob> {
	if (!inputChunks || typeof inputChunks[Symbol.asyncIterator] !== 'function') {
		throw new TypeError('Assistance audio preparation requires a bounded chunk stream.');
	}
	const geometry = localAssistanceAudioWaveGeometry(
		operation, expectedFrames, inputSampleRate, inputChannelCount,
	);
	const selected = localAssistanceAudioInputProfile(operation);
	const parts: ArrayBuffer[] = [];
	const encoder = createWavStreamEncoder({
		sampleRate: geometry.sampleRate,
		channelCount: geometry.channelCount,
		totalFrames: geometry.frameCount,
		bitDepth: 32,
		float: true,
		dither: false,
		collect: false,
		onChunk: (chunk: Uint8Array) => { parts.push(chunk.slice().buffer as ArrayBuffer); },
	});
	const resampler = inputSampleRate === geometry.sampleRate ? null
		: createStreamingWindowedSincResampler(
			inputSampleRate, geometry.sampleRate, geometry.channelCount,
		) as unknown as Readonly<{
			push(channels: Float32Array[]): Float32Array[];
			finish(outputFrames: number): Float32Array[];
		}>;
	let receivedFrames = 0;
	for await (const chunk of inputChunks) {
		signal?.throwIfAborted();
		const frameCount = chunk[0]?.length ?? 0;
		assertChunkGeometry(chunk, frameCount, inputChannelCount);
		if (frameCount < 1 || receivedFrames + frameCount > expectedFrames) {
			throw new Error('The selected audio chunk stream exceeded its exact geometry.');
		}
		receivedFrames += frameCount;
		const conformed = selected.channels === 'mono' ? [downmixChunk(chunk)] : [...chunk];
		const output = resampler ? resampler.push(conformed) : conformed;
		if ((output[0]?.length ?? 0) > 0) encoder.write(output);
		await yieldForCancellation(signal);
	}
	if (receivedFrames !== expectedFrames) {
		throw new Error('The selected audio chunk stream returned inexact geometry.');
	}
	if (resampler) {
		const tail = resampler.finish(geometry.frameCount);
		if ((tail[0]?.length ?? 0) > 0) encoder.write(tail);
	}
	signal?.throwIfAborted();
	const finalized = encoder.finalize() as Readonly<{ byteLength: number; frames: number }>;
	await encoder.settled();
	signal?.throwIfAborted();
	if (finalized.byteLength !== geometry.byteLength || finalized.frames !== geometry.frameCount) {
		throw new Error('The selected audio encoder returned inexact geometry.');
	}
	const body = new Blob(parts, { type: 'audio/wav' });
	if (body.size !== geometry.byteLength) {
		throw new Error('The selected audio Blob returned inexact geometry.');
	}
	return body;
}

function downmixChunk(channels: readonly Float32Array[]): Float32Array {
	const frameCount = channels[0]!.length;
	const mono = new Float32Array(frameCount);
	const scale = 1 / channels.length;
	for (let frame = 0; frame < frameCount; frame += 1) {
		let sample = 0;
		for (const channel of channels) sample += channel[frame]!;
		mono[frame] = sample * scale;
	}
	return mono;
}

function assertChunkGeometry(
	channels: readonly Float32Array[],
	expectedFrames: number,
	expectedChannels: number,
): void {
	if (!Array.isArray(channels) || channels.length !== expectedChannels
		|| expectedChannels < 1 || expectedChannels > 64
		|| !Number.isSafeInteger(expectedFrames) || expectedFrames < 0
		|| channels.some((channel) => !(channel instanceof Float32Array)
			|| channel.length !== expectedFrames)) {
		throw new Error('The selected audio render returned inexact channel geometry.');
	}
}

async function yieldForCancellation(signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	signal?.throwIfAborted();
}

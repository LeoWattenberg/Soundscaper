/* SPDX-License-Identifier: AGPL-3.0-only */

/** Operation-owned PCM conformance for local inference adapters. */

import type { AssistanceOperation } from '../assistance/operation.ts';
import { createStreamingWindowedSincResampler } from '../resample.js';
import { scaleSampleFrame } from '../timeline-time.ts';
import { encodeWav } from '../wav.js';

const PREPARATION_CHUNK_FRAMES = 65_536;
const MAXIMUM_PREPARED_AUDIO_BYTES = 512 * 1024 * 1024;

export interface LocalAssistanceAudioInputProfile {
	readonly sampleRate: number;
	readonly channels: 'mono' | 'preserve';
}

const PROFILES = Object.freeze({
	'voice-activity-detection': profile(16_000, 'mono'),
	'speech-recognition': profile(16_000, 'mono'),
	'word-alignment': profile(16_000, 'mono'),
	'speaker-diarization': profile(16_000, 'mono'),
	'speech-enhancement': profile(48_000, 'preserve'),
	'source-separation': profile(44_100, 'preserve'),
	'audio-tagging': profile(32_000, 'mono'),
	'beat-tracking': profile(22_050, 'mono'),
} satisfies Partial<Record<AssistanceOperation, LocalAssistanceAudioInputProfile>>);

type ProfiledAudioOperation = keyof typeof PROFILES;

export function localAssistanceAudioInputProfile(
	operation: AssistanceOperation,
): LocalAssistanceAudioInputProfile {
	const selected = (PROFILES as Partial<Record<AssistanceOperation,
		LocalAssistanceAudioInputProfile>>)[operation];
	if (!selected) throw new RangeError('This assistance operation has no audio input profile.');
	return selected;
}

export async function createLocalAssistanceAudioWave(
	operation: ProfiledAudioOperation,
	channelsValue: readonly Float32Array[],
	expectedFrames: number,
	inputSampleRate: number,
	signal?: AbortSignal,
): Promise<Blob> {
	assertInputGeometry(channelsValue, expectedFrames, inputSampleRate);
	const selected = localAssistanceAudioInputProfile(operation);
	const prepared = selected.channels === 'mono'
		? [await downmix(channelsValue, expectedFrames, signal)]
		: [...channelsValue];
	const outputFrames = Number(scaleSampleFrame(
		expectedFrames, inputSampleRate, selected.sampleRate, 'point',
	));
	preflight(outputFrames, prepared.length);
	const conformed = inputSampleRate === selected.sampleRate
		? prepared
		: await resample(prepared, inputSampleRate, selected.sampleRate, outputFrames, signal);
	signal?.throwIfAborted();
	const bytes = encodeWav(conformed, {
		sampleRate: selected.sampleRate, bitDepth: 32, float: true, dither: false,
	});
	signal?.throwIfAborted();
	return new Blob([bytes.slice().buffer], { type: 'audio/wav' });
}

async function downmix(
	channels: readonly Float32Array[],
	frameCount: number,
	signal?: AbortSignal,
): Promise<Float32Array> {
	const mono = new Float32Array(frameCount);
	const scale = 1 / channels.length;
	for (let start = 0; start < frameCount; start += PREPARATION_CHUNK_FRAMES) {
		signal?.throwIfAborted();
		const end = Math.min(frameCount, start + PREPARATION_CHUNK_FRAMES);
		for (let frame = start; frame < end; frame += 1) {
			let sample = 0;
			for (const channel of channels) sample += channel[frame]!;
			mono[frame] = sample * scale;
		}
		if (end < frameCount) await yieldForCancellation(signal);
	}
	return mono;
}

async function resample(
	channels: readonly Float32Array[],
	inputSampleRate: number,
	outputSampleRate: number,
	outputFrames: number,
	signal?: AbortSignal,
): Promise<Float32Array[]> {
	const resampler = createStreamingWindowedSincResampler(
		inputSampleRate, outputSampleRate, channels.length,
	) as unknown as Readonly<{
		push(channels: Float32Array[]): Float32Array[];
		finish(outputFrames: number): Float32Array[];
	}>;
	const output = Array.from({ length: channels.length }, () => new Float32Array(outputFrames));
	let written = 0;
	for (let start = 0; start < channels[0]!.length; start += PREPARATION_CHUNK_FRAMES) {
		signal?.throwIfAborted();
		const end = Math.min(channels[0]!.length, start + PREPARATION_CHUNK_FRAMES);
		written = appendResampled(output, written,
			resampler.push(channels.map((channel) => channel.subarray(start, end))));
		if (end < channels[0]!.length) await yieldForCancellation(signal);
	}
	written = appendResampled(output, written, resampler.finish(outputFrames));
	if (written !== outputFrames) {
		throw new Error('The selected audio resampler returned inexact geometry.');
	}
	return output;
}

function appendResampled(
	target: readonly Float32Array[],
	offset: number,
	parts: readonly Float32Array[],
): number {
	if (parts.length !== target.length || parts.some((part) => !(part instanceof Float32Array))
		|| new Set(parts.map((part) => part.length)).size !== 1) {
		throw new Error('The selected audio resampler returned inexact channel geometry.');
	}
	const length = parts[0]?.length ?? 0;
	if (offset + length > target[0]!.length) {
		throw new Error('The selected audio resampler exceeded its exact geometry.');
	}
	for (let channel = 0; channel < target.length; channel += 1) {
		target[channel]!.set(parts[channel]!, offset);
	}
	return offset + length;
}

function assertInputGeometry(
	channels: readonly Float32Array[],
	expectedFrames: number,
	inputSampleRate: number,
): void {
	if (!Array.isArray(channels) || channels.length < 1 || channels.length > 64
		|| !Number.isSafeInteger(expectedFrames) || expectedFrames < 1
		|| !Number.isSafeInteger(inputSampleRate) || inputSampleRate < 1
		|| channels.some((channel) => !(channel instanceof Float32Array)
			|| channel.length !== expectedFrames)) {
		throw new Error('The selected audio render returned inexact channel geometry.');
	}
}

function preflight(frameCount: number, channelCount: number): void {
	const byteLength = 44 + frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1
		|| !Number.isSafeInteger(byteLength) || byteLength > MAXIMUM_PREPARED_AUDIO_BYTES) {
		throw new RangeError('The conformed assistance audio exceeds its bounded capacity.');
	}
}

function profile(
	sampleRate: number,
	channels: LocalAssistanceAudioInputProfile['channels'],
): LocalAssistanceAudioInputProfile {
	return Object.freeze({ sampleRate, channels });
}

async function yieldForCancellation(signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	signal?.throwIfAborted();
}

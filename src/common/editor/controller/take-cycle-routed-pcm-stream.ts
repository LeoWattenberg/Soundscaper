/* SPDX-License-Identifier: AGPL-3.0-only */

import { TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS } from '../take-cycle-capture-domain.ts';
import { createStreamingWindowedSincResampler } from '../resample.js';
import {
	TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES,
	type TakeCycleCapturePcmSpan,
} from './take-cycle-capture-spool.ts';

export interface TakeCycleRoutedStreamingResampler {
	push(channels: readonly Float32Array[]): readonly Float32Array[];
	finish(): readonly Float32Array[];
}

export type TakeCycleRoutedResamplerFactory = (
	inputSampleRate: number,
	outputSampleRate: number,
	channelCount: number,
) => TakeCycleRoutedStreamingResampler;

export interface TakeCycleRoutedPcmStream {
	readonly frameCount: number;
	push(channels: readonly Float32Array[]): Promise<void>;
	finish(): Promise<void>;
}

export interface TakeCycleRoutedPcmStreamOptions {
	readonly inputSampleRate: number;
	readonly projectSampleRate: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly loopStartSample: number;
	readonly loopEndSample: number;
	readonly append: (span: TakeCycleCapturePcmSpan) => Promise<void>;
	readonly createResampler?: TakeCycleRoutedResamplerFactory;
}

const DEFAULT_RESAMPLER_FACTORY = createStreamingWindowedSincResampler as TakeCycleRoutedResamplerFactory;

/** Convert one routed lane to project-rate, unwrapped, loop-grid-fenced durable spans. */
export function createTakeCycleRoutedPcmStream(
	optionsValue: TakeCycleRoutedPcmStreamOptions,
): Readonly<TakeCycleRoutedPcmStream> {
	const options = normalizeOptions(optionsValue);
	const resampler = (options.createResampler ?? DEFAULT_RESAMPLER_FACTORY)(
		options.inputSampleRate,
		options.projectSampleRate,
		options.channelCount,
	);
	if (!resampler || typeof resampler.push !== 'function' || typeof resampler.finish !== 'function') {
		throw new TypeError('Take cycle routed capture requires a streaming resampler.');
	}
	let cursor = options.loopStartSample;
	let spanCount = 0;
	let busy = false;
	let finished = false;
	return Object.freeze({
		get frameCount() { return cursor - options.loopStartSample; },
		async push(channels: readonly Float32Array[]) {
			if (finished) throw new Error('Take cycle routed PCM stream is finished.');
			if (busy) throw new Error('Take cycle routed PCM operations must be awaited serially.');
			const input = validateChannels(channels, options.channelCount, 'input');
			preflightResamplerOutput(input[0]!.length, options);
			busy = true;
			try {
				await appendOutput(resampler.push(input));
			} finally {
				busy = false;
			}
		},
		async finish() {
			if (finished) return;
			if (busy) throw new Error('Take cycle routed PCM operations must be awaited serially.');
			finished = true;
			busy = true;
			try {
				await appendOutput(resampler.finish());
			} finally {
				busy = false;
			}
		},
	});

	async function appendOutput(channelsValue: readonly Float32Array[]): Promise<void> {
		const channels = validateChannels(channelsValue, options.channelCount, 'resampler output');
		const frames = channels[0]!.length;
		if (!frames) return;
		if (frames * options.channelCount * Float32Array.BYTES_PER_ELEMENT
			> TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES) {
			throw new RangeError('Take cycle routed resampler output exceeds its strict memory bound.');
		}
		let offset = 0;
		while (offset < frames) {
			if (spanCount >= TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS) {
				throw new RangeError(`Cycle capture exceeds ${String(TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS)} spans.`);
			}
			const gridEnd = nextGridBoundary(cursor, options.loopStartSample, options.loopEndSample);
			const length = Math.min(frames - offset, options.chunkFrames, gridEnd - cursor);
			const endSample = exactSum(cursor, length, 'take cycle routed span end');
			await options.append(Object.freeze({
				startSample: cursor,
				endSample,
				channels: Object.freeze(channels.map((channel) => channel.subarray(offset, offset + length))),
			}));
			cursor = endSample;
			offset += length;
			spanCount += 1;
		}
	}
}

function normalizeOptions(value: TakeCycleRoutedPcmStreamOptions): TakeCycleRoutedPcmStreamOptions {
	const inputSampleRate = positiveInteger(value.inputSampleRate, 768_000, 'input sample rate');
	const projectSampleRate = positiveInteger(value.projectSampleRate, 768_000, 'project sample rate');
	const channelCount = positiveInteger(value.channelCount, 64, 'channel count');
	const maximumChunkFrames = Math.floor(
		TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES / channelCount / Float32Array.BYTES_PER_ELEMENT,
	);
	const chunkFrames = positiveInteger(value.chunkFrames, maximumChunkFrames, 'chunk frames');
	const loopStartSample = nonNegativeInteger(value.loopStartSample, 'loop start');
	const loopEndSample = nonNegativeInteger(value.loopEndSample, 'loop end');
	if (loopEndSample <= loopStartSample) throw new RangeError('Take cycle routed loop extent must be positive.');
	if (typeof value.append !== 'function') throw new TypeError('Take cycle routed append port is required.');
	return Object.freeze({
		inputSampleRate, projectSampleRate, channelCount, chunkFrames,
		loopStartSample, loopEndSample, append: value.append,
		...(value.createResampler ? { createResampler: value.createResampler } : {}),
	});
}

function validateChannels(
	value: readonly Float32Array[],
	channelCount: number,
	name: string,
): readonly Float32Array[] {
	if (!Array.isArray(value) || value.length !== channelCount || !(value[0] instanceof Float32Array)) {
		throw new RangeError(`Take cycle routed ${name} channel count changed.`);
	}
	const frames = value[0].length;
	if (value.some((channel) => !(channel instanceof Float32Array) || channel.length !== frames)) {
		throw new RangeError(`Take cycle routed ${name} has noncanonical channel geometry.`);
	}
	return value;
}

function preflightResamplerOutput(frames: number, options: TakeCycleRoutedPcmStreamOptions): void {
	const projectedFrames = Math.ceil(frames * options.projectSampleRate / options.inputSampleRate) + 2;
	if (projectedFrames * options.channelCount * Float32Array.BYTES_PER_ELEMENT
		> TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES) {
		throw new RangeError('Take cycle routed input could exceed the resampler memory bound.');
	}
}

function nextGridBoundary(cursor: number, loopStart: number, loopEnd: number): number {
	const loopFrames = loopEnd - loopStart;
	const pass = BigInt(Math.floor((cursor - loopStart) / loopFrames) + 1);
	const boundary = BigInt(loopStart) + pass * BigInt(loopFrames);
	if (boundary > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Take cycle routed grid exceeds safe time.');
	return Number(boundary);
}

function exactSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds safe time.`);
	return result;
}

function positiveInteger(value: unknown, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`Take cycle routed ${name} is invalid.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`Take cycle routed ${name} is invalid.`);
	return Number(value);
}

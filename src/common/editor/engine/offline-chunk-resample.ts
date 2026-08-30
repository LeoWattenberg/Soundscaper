/* SPDX-License-Identifier: AGPL-3.0-only */

import { createStreamingWindowedSincResampler } from '../resample.js';
import { throwIfAborted } from './async-utils.ts';
import { chunkChannels } from './clip-scheduler-chunk-sources.ts';
import type { EngineChunkSource } from './types.ts';

const INPUT_FEED_FRAMES = 4_096;
const RESAMPLE_RADIUS = 24;

interface StreamingResampler {
	push(channels: readonly Float32Array[]): readonly Float32Array[];
	finish(outputFrameCount: number): readonly Float32Array[];
}

export async function createOfflineChunkResampleBuffer(options: Readonly<{
	context: BaseAudioContext;
	source: EngineChunkSource;
	inputOffsetFrame: number;
	inputFrameCount: number;
	outputFrameCount: number;
	signal?: AbortSignal | null;
	onInputFrames?: (frames: number) => void;
}>): Promise<AudioBuffer> {
	const { context, source, inputOffsetFrame, inputFrameCount, outputFrameCount } = options;
	if (!Number.isFinite(inputOffsetFrame) || inputOffsetFrame < 0
		|| !Number.isFinite(inputFrameCount) || inputFrameCount <= 0
		|| !Number.isSafeInteger(outputFrameCount) || outputFrameCount <= 0) {
		throw new RangeError('The offline long-source resample range is invalid.');
	}
	if (inputOffsetFrame >= source.frameCount) {
		throw new RangeError('The offline long-source resample range is empty.');
	}
	const sourceStartFrame = Math.max(0, Math.floor(inputOffsetFrame) - RESAMPLE_RADIUS);
	const sourceEndFrame = Math.min(
		source.frameCount,
		Math.ceil(inputOffsetFrame + inputFrameCount) + RESAMPLE_RADIUS,
	);
	if (sourceEndFrame <= sourceStartFrame) {
		throw new RangeError('The offline long-source resample range is empty.');
	}
	const resampler = createStreamingWindowedSincResampler(
		inputFrameCount,
		outputFrameCount,
		source.channelCount,
		{ initialInputPosition: inputOffsetFrame - sourceStartFrame },
	) as unknown as StreamingResampler;
	const output = context.createBuffer(source.channelCount, outputFrameCount, context.sampleRate);
	const outputChannels = Array.from(
		{ length: source.channelCount },
		(_, channel) => output.getChannelData(channel),
	);
	const requestedEndFrame = inputOffsetFrame + inputFrameCount;
	let inputNextFrame = sourceStartFrame;
	let outputOffset = 0;
	let storageChunkIndex = -1;
	let storageChannels: readonly Float32Array[] | null = null;
	while (inputNextFrame < sourceEndFrame) {
		throwIfAborted(options.signal);
		const chunkIndex = Math.floor(inputNextFrame / source.chunkFrames);
		if (storageChunkIndex !== chunkIndex || !storageChannels) {
			storageChannels = chunkChannels(await source.readStorageChunk(chunkIndex, { signal: options.signal }));
			storageChunkIndex = chunkIndex;
		}
		const channels = storageChannels;
		const chunkStartFrame = chunkIndex * source.chunkFrames;
		const chunkOffset = inputNextFrame - chunkStartFrame;
		const available = (channels[0]?.length ?? 0) - chunkOffset;
		const frames = Math.min(INPUT_FEED_FRAMES, sourceEndFrame - inputNextFrame, available);
		if (frames <= 0) throw new Error('A long-source storage chunk did not cover the resampler input.');
		const input = Array.from({ length: source.channelCount }, (_, channel) => {
			const values = channels[channel];
			if (!values) throw new Error('A long-source storage chunk has missing channels.');
			return values.slice(chunkOffset, chunkOffset + frames);
		});
		outputOffset = copyOutput(outputChannels, outputOffset, resampler.push(input), outputFrameCount);
		const admittedStart = Math.max(inputNextFrame, inputOffsetFrame);
		const admittedEnd = Math.min(inputNextFrame + frames, requestedEndFrame);
		if (admittedEnd > admittedStart) options.onInputFrames?.(admittedEnd - admittedStart);
		inputNextFrame += frames;
		if (Math.floor(inputNextFrame / source.chunkFrames) !== chunkIndex) storageChannels = null;
	}
	outputOffset = copyOutput(outputChannels, outputOffset, resampler.finish(outputFrameCount), outputFrameCount);
	if (outputOffset !== outputFrameCount) throw new Error('The offline long-source resample was incomplete.');
	return output;
}

function copyOutput(
	target: readonly Float32Array[],
	offset: number,
	values: readonly Float32Array[],
	targetFrames: number,
): number {
	if (values.length !== target.length) throw new Error('The offline long-source resample changed channel count.');
	const frames = values[0]?.length ?? 0;
	if (values.some((channel) => channel.length !== frames) || offset + frames > targetFrames) {
		throw new Error('The offline long-source resample returned invalid channel geometry.');
	}
	for (let channel = 0; channel < target.length; channel += 1) target[channel]!.set(values[channel]!, offset);
	return offset + frames;
}

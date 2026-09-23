/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS,
	MAXIMUM_WAVEFORM_PEAK_WINDOW_CHANNEL_BUCKETS,
} from '../../../waveform-peak-contract.ts';
import { throwIfAborted } from '../../shared/app-helpers.ts';
import type {
	WaveformPcmProvider,
	WaveformPcmRange,
	WaveformPeakWindow,
	WaveformPeakWindowOptions,
} from '../waveform-analysis.ts';

/** Stream one viewport-sized peak level without retaining its complete PCM range. */
export async function readWaveformPeakWindow(
	provider: WaveformPcmProvider,
	range: WaveformPcmRange,
	options: WaveformPeakWindowOptions,
): Promise<WaveformPeakWindow> {
	validateRequest(provider, range, options);
	throwIfAborted(options.signal);
	const frameCount = range.endFrame - range.startFrame;
	const blockSize = Math.min(
		Math.floor(frameCount / options.pixelWidth),
		options.maximumBlockSize ?? Number.MAX_SAFE_INTEGER,
	);
	if (blockSize < 1) throw new RangeError('This waveform scale requires individual PCM samples.');
	const bucketCount = Math.ceil(frameCount / blockSize);
	if (!Number.isSafeInteger(bucketCount)) throw new RangeError('The waveform peak window is too large.');
	if (bucketCount > MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS) {
		throw new RangeError('The waveform peak window exceeds its bucket budget.');
	}
	const retainedChannelCount = Math.min(options.maximumChannels ?? provider.channelCount, provider.channelCount);
	if (bucketCount * retainedChannelCount > MAXIMUM_WAVEFORM_PEAK_WINDOW_CHANNEL_BUCKETS) {
		throw new RangeError('The waveform peak window exceeds its memory budget.');
	}
	const minimums = Array.from({ length: retainedChannelCount }, () => (
		new Float32Array(bucketCount).fill(Number.POSITIVE_INFINITY)
	));
	const maximums = Array.from({ length: retainedChannelCount }, () => (
		new Float32Array(bucketCount).fill(Number.NEGATIVE_INFINITY)
	));
	const squareSums = Array.from({ length: retainedChannelCount }, () => new Float64Array(bucketCount));
	const counts = new Uint32Array(bucketCount);
	const firstChunk = Math.floor(range.startFrame / provider.chunkFrames);
	const lastChunk = Math.ceil(range.endFrame / provider.chunkFrames) - 1;
	let framesRead = 0;
	for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
		throwIfAborted(options.signal);
		const value = await provider.readStorageChunk(chunkIndex);
		throwIfAborted(options.signal);
		const channels = Array.isArray(value) ? value : value.channels;
		if (channels.length !== provider.channelCount || channels.some((channel) => !(channel instanceof Float32Array))
			|| channels.some((channel) => channel.length !== channels[0]?.length)) {
			throw new Error('The waveform peak window received invalid PCM channels.');
		}
		const chunkStart = chunkIndex * provider.chunkFrames;
		const from = Math.max(range.startFrame, chunkStart) - chunkStart;
		const to = Math.min(range.endFrame, chunkStart + (channels[0]?.length || 0)) - chunkStart;
		for (let frame = from; frame < to; frame += 1) {
			const bucket = Math.floor(framesRead / blockSize);
			counts[bucket]! += 1;
			for (let channel = 0; channel < retainedChannelCount; channel += 1) {
				const sample = channels[channel]![frame]!;
				minimums[channel]![bucket] = Math.min(minimums[channel]![bucket]!, sample);
				maximums[channel]![bucket] = Math.max(maximums[channel]![bucket]!, sample);
				squareSums[channel]![bucket] += sample * sample;
			}
			framesRead += 1;
		}
	}
	if (framesRead !== frameCount) throw new Error('The waveform peak window is incomplete.');
	return {
		...range,
		blockSize,
		pixelsPerSample: options.pixelWidth / frameCount,
		channels: minimums.map((minimum, channel) => ({
			minimums: minimum,
			maximums: maximums[channel]!,
			rms: Float32Array.from(squareSums[channel]!, (sum, bucket) => Math.sqrt(sum / counts[bucket]!)),
		})),
	};
}

function validateRequest(
	provider: WaveformPcmProvider,
	range: WaveformPcmRange,
	options: WaveformPeakWindowOptions,
): void {
	if (!Number.isSafeInteger(provider.channelCount) || provider.channelCount < 1 || provider.channelCount > 1_024
		|| !Number.isSafeInteger(provider.chunkFrames) || provider.chunkFrames < 1) {
		throw new RangeError('A waveform peak window requires valid provider geometry.');
	}
	if (!Number.isSafeInteger(range.startFrame) || range.startFrame < 0
		|| !Number.isSafeInteger(range.endFrame) || range.endFrame <= range.startFrame) {
		throw new RangeError('A waveform peak window requires a positive safe frame range.');
	}
	if (!Number.isFinite(options.pixelWidth) || options.pixelWidth <= 0) {
		throw new RangeError('A waveform peak window requires a positive finite pixel width.');
	}
	if (options.maximumBlockSize !== undefined
		&& (!Number.isSafeInteger(options.maximumBlockSize) || options.maximumBlockSize < 1)) {
		throw new RangeError('A waveform peak window requires a positive safe maximum block size.');
	}
	if (options.maximumChannels !== undefined
		&& (!Number.isSafeInteger(options.maximumChannels) || options.maximumChannels < 1)) {
		throw new RangeError('A waveform peak window requires a positive safe channel limit.');
	}
}

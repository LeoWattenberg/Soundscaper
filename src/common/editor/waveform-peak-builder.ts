/* SPDX-License-Identifier: AGPL-3.0-only */

import { waveformPeakBlockSizes, WAVEFORM_PEAKS_VERSION } from './waveform-peak-contract.ts';

interface PeakChannel {
	readonly minimums: Float32Array;
	readonly maximums: Float32Array;
	readonly rms: Float32Array;
}

interface PeakLevel {
	readonly blockSize: number;
	readonly channels: readonly PeakChannel[];
}

export interface WaveformPeakPyramid {
	readonly version: number;
	readonly channelCount: number;
	readonly levels: PeakLevel[];
}

interface ChannelAccumulator extends PeakChannel {
	count: number;
	minimum: number;
	maximum: number;
	squareSum: number;
	bucket: number;
}

export interface WaveformPeakBuilder {
	/** Consume borrowed PCM synchronously; no samples are retained. */
	append(channels: readonly Float32Array[]): void;
	finish(): WaveformPeakPyramid;
}

/** Scan PCM once at the finest scale, then combine unrounded bucket statistics. */
export function createWaveformPeakBuilder(
	{ frameCount, channelCount }: Readonly<{ frameCount: number; channelCount: number }>,
): WaveformPeakBuilder {
	const levels = waveformPeakBlockSizes(frameCount, channelCount).map((blockSize) => ({
		blockSize,
		channels: Array.from({ length: channelCount }, (): ChannelAccumulator => ({
			minimums: new Float32Array(Math.ceil(frameCount / blockSize)),
			maximums: new Float32Array(Math.ceil(frameCount / blockSize)),
			rms: new Float32Array(Math.ceil(frameCount / blockSize)),
			count: 0, minimum: Infinity, maximum: -Infinity, squareSum: 0, bucket: 0,
		})),
	}));
	let frames = 0;
	let result: WaveformPeakPyramid | undefined;

	function flush(levelIndex: number, channelIndex: number): void {
		const channel = levels[levelIndex]!.channels[channelIndex]!;
		if (!channel.count) return;
		channel.minimums[channel.bucket] = channel.minimum;
		channel.maximums[channel.bucket] = channel.maximum;
		channel.rms[channel.bucket] = Math.sqrt(channel.squareSum / channel.count);
		channel.bucket++;
		const parent = levels[levelIndex + 1];
		if (parent) {
			const accumulator = parent.channels[channelIndex]!;
			accumulator.minimum = Math.min(accumulator.minimum, channel.minimum);
			accumulator.maximum = Math.max(accumulator.maximum, channel.maximum);
			accumulator.squareSum += channel.squareSum;
			accumulator.count += channel.count;
			if (accumulator.count === parent.blockSize) flush(levelIndex + 1, channelIndex);
		}
		channel.count = 0;
		channel.minimum = Infinity;
		channel.maximum = -Infinity;
		channel.squareSum = 0;
	}

	return {
		append(channels) {
			if (result) throw new Error('The waveform peak builder is finished.');
			if (channels.length !== channelCount) throw new Error('Peak channel count changed.');
			const chunkFrames = channels[0]!.length;
			if (channels.some((channel) => channel.length !== chunkFrames)) throw new Error('Peak channel lengths differ.');
			if (frames + chunkFrames > frameCount) throw new Error('The waveform source frame count does not match its metadata.');
			const finest = levels[0]!;
			for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
				const samples = channels[channelIndex]!;
				const accumulator = finest.channels[channelIndex]!;
				let offset = 0;
				while (offset < chunkFrames) {
					const end = Math.min(chunkFrames, offset + finest.blockSize - accumulator.count);
					let minimum = accumulator.minimum;
					let maximum = accumulator.maximum;
					let squareSum = accumulator.squareSum;
					accumulator.count += end - offset;
					for (; offset < end; offset++) {
						const sample = samples[offset]!;
						minimum = Math.min(minimum, sample);
						maximum = Math.max(maximum, sample);
						squareSum += sample * sample;
					}
					accumulator.minimum = minimum;
					accumulator.maximum = maximum;
					accumulator.squareSum = squareSum;
					if (accumulator.count === finest.blockSize) flush(0, channelIndex);
				}
			}
			frames += chunkFrames;
		},
		finish() {
			if (result) return result;
			if (frames !== frameCount) throw new Error('The waveform source frame count does not match its metadata.');
			for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
				for (let channel = 0; channel < channelCount; channel++) flush(levelIndex, channel);
			}
			result = {
				version: WAVEFORM_PEAKS_VERSION,
				channelCount,
				levels: levels.map(({ blockSize, channels }) => ({
					blockSize,
					channels: channels.map(({ minimums, maximums, rms }) => ({ minimums, maximums, rms })),
				})),
			};
			return result;
		},
	};
}

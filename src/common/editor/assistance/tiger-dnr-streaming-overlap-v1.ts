/* SPDX-License-Identifier: AGPL-3.0-only */

/** Fixed-memory equivalent of TIGER-DnR's owned ordered overlap-add merge. */

import {
	ASSISTANCE_TIGER_DNR_CHUNK_FRAMES,
	type TigerDnrChunkPlanV1,
} from './tiger-dnr-signal-v1.ts';

const STEM_COUNT = 3;
const MAXIMUM_CHANNELS = 64;
const MAXIMUM_ACCUMULATOR_BYTES = 512 * 1024 ** 2;

export interface TigerDnrStreamingOverlapV1 {
	readonly paddedPosition: number;
	readonly safePaddedEnd: number;
	beginChunk(chunkIndex: number): void;
	addChannelBatch(
		channelStart: number,
		stems: readonly (readonly Float32Array[])[],
		signal?: AbortSignal,
	): void;
	finishChunk(): number;
	drain(
		frameCount: number,
		emit: boolean,
		signal?: AbortSignal,
	): readonly (readonly Float32Array[])[] | null;
	finish(): void;
}

export function createTigerDnrStreamingOverlapV1(
	plan: TigerDnrChunkPlanV1,
	channelCount: number,
): TigerDnrStreamingOverlapV1 {
	if (!Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > MAXIMUM_CHANNELS
		|| plan.schemaVersion !== 1 || plan.chunks.length < 1) {
		throw new RangeError('The streaming TIGER overlap-add geometry is invalid.');
	}
	const floatCount = STEM_COUNT * channelCount * ASSISTANCE_TIGER_DNR_CHUNK_FRAMES;
	if (!Number.isSafeInteger(floatCount)
		|| floatCount * Float32Array.BYTES_PER_ELEMENT > MAXIMUM_ACCUMULATOR_BYTES) {
		throw new RangeError('The streaming TIGER overlap-add exceeds its memory admission.');
	}
	const rings = Array.from({ length: STEM_COUNT }, () =>
		Array.from({ length: channelCount }, () =>
			new Float32Array(ASSISTANCE_TIGER_DNR_CHUNK_FRAMES)));
	let paddedPosition = 0;
	let safePaddedEnd = 0;
	let nextChunkIndex = 0;
	let activeChunkIndex: number | null = null;
	let nextChannel = 0;

	const api: TigerDnrStreamingOverlapV1 = {
		get paddedPosition() { return paddedPosition; },
		get safePaddedEnd() { return safePaddedEnd; },
		beginChunk(chunkIndex) {
			if (activeChunkIndex !== null || chunkIndex !== nextChunkIndex
				|| paddedPosition !== plan.chunks[chunkIndex]?.paddedStartFrame) {
				throw new TypeError('Streaming TIGER chunks must be complete, drained, and ordered.');
			}
			activeChunkIndex = chunkIndex;
			nextChannel = 0;
		},
		addChannelBatch(channelStart, stems, signal) {
			const chunk = activeChunkIndex === null ? undefined : plan.chunks[activeChunkIndex];
			if (!chunk || channelStart !== nextChannel || !Array.isArray(stems)
				|| stems.length !== STEM_COUNT || !Array.isArray(stems[0])) {
				throw new TypeError('A streaming TIGER channel batch is invalid or out of order.');
			}
			const batchChannels = stems[0]!.length;
			if (batchChannels < 1 || channelStart + batchChannels > channelCount
				|| stems.some((stem) => !Array.isArray(stem) || stem.length !== batchChannels
					|| stem.some((channel) => !(channel instanceof Float32Array)
						|| channel.length !== ASSISTANCE_TIGER_DNR_CHUNK_FRAMES))) {
				throw new RangeError('A streaming TIGER channel batch changed its exact geometry.');
			}
			for (let stem = 0; stem < STEM_COUNT; stem += 1) {
				for (let localChannel = 0; localChannel < batchChannels; localChannel += 1) {
					const source = stems[stem]![localChannel]!;
					const destination = rings[stem]![channelStart + localChannel]!;
					for (let frame = 0; frame < chunk.availableFrameCount; frame += 1) {
						if ((frame & 65_535) === 0) signal?.throwIfAborted();
						const sample = source[frame]!;
						if (!Number.isFinite(sample)) {
							throw new RangeError('A streaming TIGER stem sample is not finite.');
						}
						const offset = (chunk.paddedStartFrame + frame)
							% ASSISTANCE_TIGER_DNR_CHUNK_FRAMES;
						destination[offset] = Math.fround(destination[offset]! + sample);
					}
				}
			}
			nextChannel += batchChannels;
		},
		finishChunk() {
			if (activeChunkIndex === null || nextChannel !== channelCount) {
				throw new TypeError('A streaming TIGER chunk is missing channel results.');
			}
			const chunkIndex = activeChunkIndex;
			activeChunkIndex = null;
			nextChunkIndex += 1;
			safePaddedEnd = chunkIndex === plan.chunks.length - 1
				? plan.paddedFrameCount : plan.chunks[chunkIndex + 1]!.paddedStartFrame;
			return safePaddedEnd;
		},
		drain(frameCount, emit, signal) {
			if (activeChunkIndex !== null || !Number.isSafeInteger(frameCount) || frameCount < 1
				|| paddedPosition + frameCount > safePaddedEnd) {
				throw new RangeError('The streaming TIGER drain exceeds its completed overlap authority.');
			}
			const output = emit ? Array.from({ length: STEM_COUNT }, () =>
				Array.from({ length: channelCount }, () => new Float32Array(frameCount))) : null;
			for (let frame = 0; frame < frameCount; frame += 1) {
				if ((frame & 16_383) === 0) signal?.throwIfAborted();
				const offset = (paddedPosition + frame) % ASSISTANCE_TIGER_DNR_CHUNK_FRAMES;
				for (let stem = 0; stem < STEM_COUNT; stem += 1) {
					for (let channel = 0; channel < channelCount; channel += 1) {
						const ring = rings[stem]![channel]!;
						if (output) output[stem]![channel]![frame] = ring[offset]! / plan.overlapDivisor;
						ring[offset] = 0;
					}
				}
			}
			paddedPosition += frameCount;
			return output ? Object.freeze(output.map((stem) => Object.freeze(stem))) : null;
		},
		finish() {
			if (activeChunkIndex !== null || nextChunkIndex !== plan.chunks.length
				|| paddedPosition !== plan.paddedFrameCount) {
				throw new TypeError('The streaming TIGER overlap-add did not consume its exact plan.');
			}
		},
	};
	return Object.freeze(api);
}

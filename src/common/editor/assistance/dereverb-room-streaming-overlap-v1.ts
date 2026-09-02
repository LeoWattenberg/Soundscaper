/* SPDX-License-Identifier: AGPL-3.0-only */

/** Fixed-memory equivalent of the dereverb-room owned fade overlap merge. */

import {
	ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES,
	dereverbRoomFadeWeightV1,
	type DereverbRoomChunkPlanV1,
} from './dereverb-room-signal-v1.ts';

const MAXIMUM_ACCUMULATOR_BYTES = 512 * 1024 ** 2;
const RING_FRAMES = ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES;

export interface DereverbRoomStreamingOverlapV1 {
	readonly paddedPosition: number;
	readonly safePaddedEnd: number;
	addChunk(chunkIndex: number, channel: Float32Array, signal?: AbortSignal): number;
	drain(frameCount: number, emit: boolean, signal?: AbortSignal): Float32Array | null;
	finish(): void;
}

/**
 * Streams the exact result of `mergeDereverbRoomChunksV1` for one mono plane:
 * chunks arrive in order, and completed padded frames drain as
 * accumulated-sample / accumulated-weight (zero where no weight landed, the
 * reference's NaN-to-zero guard). The caller crops `plan.borderFrames` from
 * both ends of the drained stream to recover source frames.
 */
export function createDereverbRoomStreamingOverlapV1(
	plan: DereverbRoomChunkPlanV1,
): DereverbRoomStreamingOverlapV1 {
	if (plan.schemaVersion !== 1 || plan.chunks.length < 1) {
		throw new RangeError('The streaming dereverb-room overlap geometry is invalid.');
	}
	if (2 * RING_FRAMES * Float64Array.BYTES_PER_ELEMENT > MAXIMUM_ACCUMULATOR_BYTES) {
		throw new RangeError('The streaming dereverb-room overlap exceeds its memory admission.');
	}
	const samples = new Float64Array(RING_FRAMES);
	const weights = new Float64Array(RING_FRAMES);
	let paddedPosition = 0;
	let safePaddedEnd = 0;
	let nextChunkIndex = 0;

	const api: DereverbRoomStreamingOverlapV1 = {
		get paddedPosition() { return paddedPosition; },
		get safePaddedEnd() { return safePaddedEnd; },
		addChunk(chunkIndex, channel, signal) {
			const chunk = plan.chunks[chunkIndex];
			if (!chunk || chunkIndex !== nextChunkIndex
				|| paddedPosition !== chunk.paddedStartFrame) {
				throw new TypeError('Streaming dereverb-room chunks must be complete, drained, and ordered.');
			}
			if (!(channel instanceof Float32Array) || channel.length !== RING_FRAMES) {
				throw new RangeError('A streaming dereverb-room chunk changed its exact geometry.');
			}
			for (let frame = 0; frame < chunk.availableFrameCount; frame += 1) {
				if ((frame & 65_535) === 0) signal?.throwIfAborted();
				const sample = channel[frame]!;
				if (!Number.isFinite(sample)) {
					throw new RangeError('A streaming dereverb-room sample is not finite.');
				}
				const weight = dereverbRoomFadeWeightV1(frame, chunk.fadeIn, chunk.fadeOut);
				const offset = (chunk.paddedStartFrame + frame) % RING_FRAMES;
				samples[offset]! += sample * weight;
				weights[offset]! += weight;
			}
			nextChunkIndex += 1;
			safePaddedEnd = chunkIndex === plan.chunks.length - 1
				? plan.paddedFrameCount : plan.chunks[chunkIndex + 1]!.paddedStartFrame;
			return safePaddedEnd;
		},
		drain(frameCount, emit, signal) {
			if (!Number.isSafeInteger(frameCount) || frameCount < 1
				|| paddedPosition + frameCount > safePaddedEnd) {
				throw new RangeError('The streaming dereverb-room drain exceeds its completed overlap authority.');
			}
			const output = emit ? new Float32Array(frameCount) : null;
			for (let frame = 0; frame < frameCount; frame += 1) {
				if ((frame & 16_383) === 0) signal?.throwIfAborted();
				const offset = (paddedPosition + frame) % RING_FRAMES;
				if (output) {
					const weight = weights[offset]!;
					output[frame] = weight > 0 ? samples[offset]! / weight : 0;
				}
				samples[offset] = 0;
				weights[offset] = 0;
			}
			paddedPosition += frameCount;
			return output;
		},
		finish() {
			if (nextChunkIndex !== plan.chunks.length
				|| paddedPosition !== plan.paddedFrameCount) {
				throw new TypeError('The streaming dereverb-room overlap did not consume its exact plan.');
			}
		},
	};
	return Object.freeze(api);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Sequence validation and backpressure for the native media data plane.
 *
 * The bounded-transfer contract already bounds one chunk. This bounds a
 * *stream* of them: chunks arrive in order, exactly once, and never after the
 * final one. A replayed chunk is refused rather than applied twice, because a
 * decoder that silently accepts a repeat produces a longer output than its plan
 * describes and nothing downstream can tell that happened.
 *
 * Backpressure is a byte window rather than a chunk count. Media chunk sizes
 * vary by orders of magnitude between a compressed packet and a raw UHD frame,
 * so a count-based window either stalls on small chunks or lets raw frames
 * accumulate until the helper's RSS budget is gone. The window is denominated
 * in bytes and defaults to four media chunks' worth, and the producer may not
 * exceed it until the consumer acknowledges what it has taken.
 */

import {
	PLATFORM_TRANSFER_HARD_LIMITS,
	type BoundedAudioChunk,
	type BoundedByteChunk,
} from './platform/bounded-transfer.ts';

/** Four media chunks in flight: enough to hide latency, bounded by design. */
export const NATIVE_MEDIA_TRANSFER_WINDOW_BYTES = 4 * PLATFORM_TRANSFER_HARD_LIMITS.mediaChunkBytes;

export const NATIVE_MEDIA_TRANSFER_VIOLATIONS = Object.freeze([
	'out-of-order',
	'replayed',
	'after-final',
	'window-exceeded',
	'over-acknowledged',
	'aborted',
] as const);

export type NativeMediaTransferViolation = (typeof NATIVE_MEDIA_TRANSFER_VIOLATIONS)[number];

export class NativeMediaTransferError extends Error {
	readonly violation: NativeMediaTransferViolation;

	constructor(violation: NativeMediaTransferViolation, message: string) {
		super(message);
		this.name = 'NativeMediaTransferError';
		this.violation = violation;
	}
}

export interface NativeMediaTransferStreamV1 {
	readonly windowBytes: number;
	readonly nextSequence: number;
	readonly inFlightBytes: number;
	readonly acknowledgedBytes: number;
	readonly admittedBytes: number;
	readonly finished: boolean;
}

type TransferChunk = BoundedByteChunk | BoundedAudioChunk;

export function createNativeMediaTransferStream(
	windowBytes: number = NATIVE_MEDIA_TRANSFER_WINDOW_BYTES,
): NativeMediaTransferStreamV1 {
	if (!Number.isSafeInteger(windowBytes) || windowBytes < 1
		|| windowBytes > NATIVE_MEDIA_TRANSFER_WINDOW_BYTES) {
		throw new RangeError('A native media transfer window is a lower-only byte bound.');
	}
	return Object.freeze({
		windowBytes,
		nextSequence: 0,
		inFlightBytes: 0,
		acknowledgedBytes: 0,
		admittedBytes: 0,
		finished: false,
	});
}

/**
 * Admit the next chunk of a stream.
 *
 * The sequence must be exactly the one expected — a gap means a chunk was lost
 * and the output would be wrong in a way the byte counts alone would not show.
 */
export function admitNativeMediaTransferChunk(
	stream: NativeMediaTransferStreamV1,
	chunk: TransferChunk,
	signal?: AbortSignal,
): NativeMediaTransferStreamV1 {
	if (signal?.aborted) {
		throw new NativeMediaTransferError('aborted', 'The native media transfer was aborted.');
	}
	if (stream.finished) {
		throw new NativeMediaTransferError(
			'after-final',
			'A native media transfer chunk arrived after the final chunk.',
		);
	}
	if (chunk.sequence < stream.nextSequence) {
		throw new NativeMediaTransferError(
			'replayed',
			'A native media transfer chunk was replayed; a repeat is refused, never applied twice.',
		);
	}
	if (chunk.sequence > stream.nextSequence) {
		throw new NativeMediaTransferError(
			'out-of-order',
			'A native media transfer chunk skipped a sequence; the stream has a gap.',
		);
	}
	const inFlightBytes = stream.inFlightBytes + chunk.byteLength;
	if (inFlightBytes > stream.windowBytes) {
		throw new NativeMediaTransferError(
			'window-exceeded',
			'A native media producer exceeded its backpressure window.',
		);
	}
	return Object.freeze({
		windowBytes: stream.windowBytes,
		nextSequence: stream.nextSequence + 1,
		inFlightBytes,
		acknowledgedBytes: stream.acknowledgedBytes,
		admittedBytes: stream.admittedBytes + chunk.byteLength,
		finished: chunk.kind === 'bytes' && chunk.final,
	});
}

/** How many more bytes the producer may send before the consumer acknowledges. */
export function nativeMediaTransferCredit(stream: NativeMediaTransferStreamV1): number {
	return Math.max(0, stream.windowBytes - stream.inFlightBytes);
}

/** The consumer took these bytes; the window reopens by exactly that much. */
export function acknowledgeNativeMediaTransferBytes(
	stream: NativeMediaTransferStreamV1,
	byteLength: number,
): NativeMediaTransferStreamV1 {
	if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
		throw new RangeError('A native media transfer acknowledgement must be a non-negative byte count.');
	}
	if (byteLength > stream.inFlightBytes) {
		throw new NativeMediaTransferError(
			'over-acknowledged',
			'A native media consumer acknowledged more bytes than were in flight.',
		);
	}
	return Object.freeze({
		windowBytes: stream.windowBytes,
		nextSequence: stream.nextSequence,
		inFlightBytes: stream.inFlightBytes - byteLength,
		acknowledgedBytes: stream.acknowledgedBytes + byteLength,
		admittedBytes: stream.admittedBytes,
		finished: stream.finished,
	});
}

/**
 * A stream is complete only when its final chunk arrived *and* everything it
 * carried was acknowledged. Treating an unacknowledged tail as complete is how
 * a cancelled job's last frames get published.
 */
export function nativeMediaTransferIsComplete(stream: NativeMediaTransferStreamV1): boolean {
	return stream.finished && stream.inFlightBytes === 0
		&& stream.acknowledgedBytes === stream.admittedBytes;
}

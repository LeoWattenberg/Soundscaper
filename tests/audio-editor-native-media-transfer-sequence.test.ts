/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	acknowledgeNativeMediaTransferBytes,
	admitNativeMediaTransferChunk,
	createNativeMediaTransferStream,
	nativeMediaTransferCredit,
	nativeMediaTransferIsComplete,
	NATIVE_MEDIA_TRANSFER_WINDOW_BYTES,
	NativeMediaTransferError,
} from '../src/common/editor/native-media-transfer-sequence.ts';
import {
	createBoundedAudioChunk,
	createBoundedByteChunk,
} from '../src/common/editor/platform/bounded-transfer.ts';

test('the window is denominated in bytes, not chunks', () => {
	const stream = createNativeMediaTransferStream();

	assert.equal(stream.windowBytes, NATIVE_MEDIA_TRANSFER_WINDOW_BYTES);
	assert.equal(NATIVE_MEDIA_TRANSFER_WINDOW_BYTES, 4 * 16 * 1024 * 1024);
	assert.equal(nativeMediaTransferCredit(stream), stream.windowBytes);
	assert.throws(() => createNativeMediaTransferStream(0), RangeError);
	assert.throws(
		() => createNativeMediaTransferStream(NATIVE_MEDIA_TRANSFER_WINDOW_BYTES + 1),
		RangeError,
	);
	// Lower-only: a caller may narrow the window but never widen it.
	assert.equal(createNativeMediaTransferStream(1_024).windowBytes, 1_024);
});

test('chunks are admitted in order, exactly once', () => {
	let stream = createNativeMediaTransferStream(4_096);
	stream = admitNativeMediaTransferChunk(stream, bytes(0, 100));
	stream = admitNativeMediaTransferChunk(stream, bytes(1, 100));

	assert.equal(stream.nextSequence, 2);
	assert.equal(stream.inFlightBytes, 200);
	assert.equal(stream.admittedBytes, 200);
});

test('a replayed chunk is refused rather than applied twice', () => {
	let stream = createNativeMediaTransferStream(4_096);
	stream = admitNativeMediaTransferChunk(stream, bytes(0, 100));
	stream = admitNativeMediaTransferChunk(stream, bytes(1, 100));

	assert.throws(
		() => admitNativeMediaTransferChunk(stream, bytes(1, 100)),
		violates('replayed'),
	);
	assert.throws(
		() => admitNativeMediaTransferChunk(stream, bytes(0, 100)),
		violates('replayed'),
	);
	assert.equal(stream.admittedBytes, 200, 'the refused replay changed nothing');
});

test('a gap in the sequence is refused, because byte counts would not show it', () => {
	const stream = admitNativeMediaTransferChunk(createNativeMediaTransferStream(4_096), bytes(0, 10));

	assert.throws(() => admitNativeMediaTransferChunk(stream, bytes(2, 10)), violates('out-of-order'));
});

test('nothing arrives after the final chunk', () => {
	let stream = createNativeMediaTransferStream(4_096);
	stream = admitNativeMediaTransferChunk(stream, bytes(0, 10, true));

	assert.equal(stream.finished, true);
	assert.throws(() => admitNativeMediaTransferChunk(stream, bytes(1, 10)), violates('after-final'));
});

test('a producer cannot exceed its backpressure window', () => {
	let stream = createNativeMediaTransferStream(256);
	stream = admitNativeMediaTransferChunk(stream, bytes(0, 200));

	assert.equal(nativeMediaTransferCredit(stream), 56);
	assert.throws(() => admitNativeMediaTransferChunk(stream, bytes(1, 100)), violates('window-exceeded'));
	assert.doesNotThrow(() => admitNativeMediaTransferChunk(stream, bytes(1, 56)));
});

test('acknowledging reopens the window by exactly what the consumer took', () => {
	let stream = createNativeMediaTransferStream(256);
	stream = admitNativeMediaTransferChunk(stream, bytes(0, 200));
	stream = acknowledgeNativeMediaTransferBytes(stream, 200);

	assert.equal(stream.inFlightBytes, 0);
	assert.equal(stream.acknowledgedBytes, 200);
	assert.equal(nativeMediaTransferCredit(stream), 256);
	assert.doesNotThrow(() => admitNativeMediaTransferChunk(stream, bytes(1, 250)));
});

test('a consumer cannot acknowledge more than is in flight', () => {
	const stream = admitNativeMediaTransferChunk(createNativeMediaTransferStream(256), bytes(0, 100));

	assert.throws(() => acknowledgeNativeMediaTransferBytes(stream, 101), violates('over-acknowledged'));
	assert.throws(() => acknowledgeNativeMediaTransferBytes(stream, -1), RangeError);
	assert.throws(() => acknowledgeNativeMediaTransferBytes(stream, 1.5), RangeError);
});

test('an aborted transfer admits nothing further', () => {
	const controller = new AbortController();
	const stream = createNativeMediaTransferStream(4_096);
	controller.abort();

	assert.throws(
		() => admitNativeMediaTransferChunk(stream, bytes(0, 10), controller.signal),
		violates('aborted'),
	);
});

test('a stream is complete only when its tail has been acknowledged too', () => {
	let stream = createNativeMediaTransferStream(4_096);
	stream = admitNativeMediaTransferChunk(stream, bytes(0, 100));
	stream = admitNativeMediaTransferChunk(stream, bytes(1, 50, true));

	assert.equal(stream.finished, true);
	assert.equal(nativeMediaTransferIsComplete(stream), false, 'the tail is still in flight');

	stream = acknowledgeNativeMediaTransferBytes(stream, 100);
	assert.equal(nativeMediaTransferIsComplete(stream), false);

	stream = acknowledgeNativeMediaTransferBytes(stream, 50);
	assert.equal(nativeMediaTransferIsComplete(stream), true);
});

test('audio chunks share the same sequencing and byte accounting', () => {
	let stream = createNativeMediaTransferStream(4_096);
	const chunk = createBoundedAudioChunk(
		[new Float32Array(64), new Float32Array(64)],
		{ sequence: 0, maximumFrameCount: 128 },
	);
	stream = admitNativeMediaTransferChunk(stream, chunk);

	assert.equal(stream.nextSequence, 1);
	assert.equal(stream.inFlightBytes, chunk.byteLength);
	// Audio chunks carry no final flag, so the stream stays open.
	assert.equal(stream.finished, false);
});

function bytes(sequence: number, byteLength: number, final = false) {
	return createBoundedByteChunk(new Uint8Array(byteLength), {
		sequence,
		maximumByteLength: 16 * 1024 * 1024,
		final,
	});
}

function violates(violation: string) {
	return (error: unknown): boolean => {
		assert.ok(error instanceof NativeMediaTransferError);
		assert.equal(error.violation, violation);
		return true;
	};
}

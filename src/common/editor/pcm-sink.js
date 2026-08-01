/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_PCM_SINK_DEFAULT_MAX_PENDING_CHUNKS,
	AUDIO_EDITOR_PCM_SINK_HARD_MAX_PENDING_CHUNKS,
	AUDIO_EDITOR_PCM_SINK_MAX_CHANNELS,
	AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES,
	AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES,
	AUDIO_EDITOR_PCM_SINK_MAX_PENDING_FRAMES,
	inspectPlanarPcmSinkPacket,
	normalizePcmSinkMaximumPendingBytes,
	normalizePcmSinkMaximumPendingChunks,
	normalizePcmSinkMaximumPendingFrames,
} from './pcm-sink-admission.ts';

export {
	AUDIO_EDITOR_PCM_SINK_HARD_MAX_PENDING_CHUNKS,
	AUDIO_EDITOR_PCM_SINK_MAX_CHANNELS,
	AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES,
	AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES,
	AUDIO_EDITOR_PCM_SINK_MAX_PENDING_FRAMES,
};

export const AUDIO_EDITOR_PCM_SINK_MAX_PENDING_CHUNKS = AUDIO_EDITOR_PCM_SINK_DEFAULT_MAX_PENDING_CHUNKS;

/**
 * Serialize planar PCM writes while retaining a fixed maximum number of
 * packets. The queue takes ownership of accepted packets until the sink write
 * settles; callers must not mutate their channel arrays after enqueueing them.
 */
export function createAsyncPlanarPcmSinkQueue(sink, options = {}) {
	const write = normalizeSink(sink);
	const maximumPendingChunks = normalizePcmSinkMaximumPendingChunks(options.maximumPendingChunks);
	const maximumPendingFrames = normalizePcmSinkMaximumPendingFrames(options.maximumPendingFrames);
	const maximumPendingBytes = normalizePcmSinkMaximumPendingBytes(options.maximumPendingBytes);
	const onError = typeof options.onError === 'function' ? options.onError : null;
	const onWriteSettled = typeof options.onWriteSettled === 'function' ? options.onWriteSettled : null;
	let state = 'open';
	let failure = null;
	let pendingChunks = 0;
	let pendingFrames = 0;
	let pendingBytes = 0;
	let acceptedChunks = 0;
	let acceptedFrames = 0;
	let acceptedBytes = 0;
	let writtenChunks = 0;
	let writtenFrames = 0;
	let writtenBytes = 0;
	let tail = Promise.resolve();
	let result = null;

	function fail(reason) {
		if (failure) return false;
		failure = normalizeError(reason, 'The PCM sink failed.');
		state = 'failed';
		try { onError?.(failure); } catch { /* Error notification must not mask the sink failure. */ }
		return false;
	}

	function closedError() {
		if (failure) return failure;
		return new Error('The PCM sink queue is closed.');
	}

	const queue = {
		get state() { return state; },
		get failure() { return failure; },
		get maximumPendingChunks() { return maximumPendingChunks; },
		get maximumPendingFrames() { return maximumPendingFrames; },
		get maximumPendingBytes() { return maximumPendingBytes; },
		get pendingChunks() { return pendingChunks; },
		get pendingFrames() { return pendingFrames; },
		get pendingBytes() { return pendingBytes; },
		get acceptedChunks() { return acceptedChunks; },
		get acceptedFrames() { return acceptedFrames; },
		get acceptedBytes() { return acceptedBytes; },
		get writtenChunks() { return writtenChunks; },
		get writtenFrames() { return writtenFrames; },
		get writtenBytes() { return writtenBytes; },
		enqueue(inputChannels, metadata = {}) {
			if (state !== 'open') throw closedError();
			let packet;
			let details;
			try {
				packet = inspectPlanarPcmSinkPacket(inputChannels);
				details = Object.freeze({ ...metadata, frames: packet.frames });
			} catch (error) {
				return fail(error);
			}
			if (pendingChunks >= maximumPendingChunks) {
				const error = new Error(`The PCM sink exceeded its ${maximumPendingChunks}-chunk pending-write limit.`);
				error.code = 'PCM_SINK_BACKPRESSURE';
				return fail(error);
			}
			if (
				packet.frames > maximumPendingFrames - pendingFrames
				|| packet.byteLength > maximumPendingBytes - pendingBytes
			) {
				const error = new RangeError(
					`The PCM sink exceeded its ${maximumPendingFrames}-frame or ${maximumPendingBytes}-byte pending-write limit.`,
				);
				error.code = 'PCM_SINK_MEMORY_LIMIT';
				return fail(error);
			}
			pendingChunks += 1;
			pendingFrames += packet.frames;
			pendingBytes += packet.byteLength;
			acceptedChunks += 1;
			acceptedFrames += packet.frames;
			acceptedBytes += packet.byteLength;
			const frames = packet.frames;
			const byteLength = packet.byteLength;
			let channels = packet.channels;
			tail = tail.then(async () => {
				let committed = false;
				try {
					if (failure) return;
					await write(channels, details);
					if (failure) return;
					writtenChunks += 1;
					writtenFrames += frames;
					writtenBytes += byteLength;
					committed = true;
				} catch (error) {
					fail(error);
				} finally {
					pendingChunks -= 1;
					pendingFrames -= frames;
					pendingBytes -= byteLength;
					channels = null;
				}
				if (committed && !failure && onWriteSettled) {
					try { await onWriteSettled(details); } catch (error) { fail(error); }
				}
			});
			return true;
		},
		async finish() {
			if (state === 'finished') return result;
			if (state === 'open') state = 'closing';
			await tail;
			if (failure) throw failure;
			result = Object.freeze({
				chunkCount: writtenChunks,
				frameCount: writtenFrames,
			});
			state = 'finished';
			return result;
		},
		abort(reason) {
			if (state === 'finished' || failure) return false;
			fail(reason || new Error('The PCM sink queue was aborted.'));
			return true;
		},
		async settled() {
			await tail;
			if (failure) throw failure;
		},
	};
	return Object.freeze(queue);
}

function normalizeSink(sink) {
	if (typeof sink === 'function') return sink;
	if (sink && typeof sink.write === 'function') return sink.write.bind(sink);
	throw new TypeError('A planar PCM sink function or object with write() is required.');
}

function normalizeError(reason, fallbackMessage) {
	if (reason instanceof Error) return reason;
	return new Error(typeof reason === 'string' && reason ? reason : fallbackMessage);
}

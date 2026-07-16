export const AUDIO_EDITOR_PCM_SINK_MAX_PENDING_CHUNKS = 64;

/**
 * Serialize planar PCM writes while retaining a fixed maximum number of
 * packets. The queue takes ownership of accepted packets until the sink write
 * settles; callers must not mutate their channel arrays after enqueueing them.
 */
export function createAsyncPlanarPcmSinkQueue(sink, options = {}) {
	const write = normalizeSink(sink);
	const maximumPendingChunks = positiveInteger(
		options.maximumPendingChunks ?? AUDIO_EDITOR_PCM_SINK_MAX_PENDING_CHUNKS,
		'maximumPendingChunks',
	);
	const onError = typeof options.onError === 'function' ? options.onError : null;
	let state = 'open';
	let failure = null;
	let pendingChunks = 0;
	let acceptedChunks = 0;
	let acceptedFrames = 0;
	let writtenChunks = 0;
	let writtenFrames = 0;
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
		get pendingChunks() { return pendingChunks; },
		get acceptedChunks() { return acceptedChunks; },
		get acceptedFrames() { return acceptedFrames; },
		get writtenChunks() { return writtenChunks; },
		get writtenFrames() { return writtenFrames; },
		enqueue(inputChannels, metadata = {}) {
			if (state !== 'open') throw closedError();
			let channels;
			try {
				channels = validatePlanarPcmPacket(inputChannels);
			} catch (error) {
				return fail(error);
			}
			if (pendingChunks >= maximumPendingChunks) {
				const error = new Error(`The PCM sink exceeded its ${maximumPendingChunks}-chunk pending-write limit.`);
				error.code = 'PCM_SINK_BACKPRESSURE';
				return fail(error);
			}
			const frames = channels[0].length;
			const details = Object.freeze({ ...metadata, frames });
			pendingChunks += 1;
			acceptedChunks += 1;
			acceptedFrames += frames;
			tail = tail.then(async () => {
				try {
					if (failure) return;
					await write(channels, details);
					writtenChunks += 1;
					writtenFrames += frames;
				} catch (error) {
					fail(error);
				} finally {
					pendingChunks -= 1;
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

function validatePlanarPcmPacket(channels) {
	if (!Array.isArray(channels) || !channels.length || channels.length > 64) {
		throw new TypeError('A planar PCM packet with 1 to 64 channels is required.');
	}
	const frames = channels[0] instanceof Float32Array ? channels[0].length : -1;
	if (frames <= 0 || channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frames)) {
		throw new TypeError('Planar PCM sink channels must be non-empty, equally sized Float32Array values.');
	}
	return channels;
}

function positiveInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function normalizeError(reason, fallbackMessage) {
	if (reason instanceof Error) return reason;
	return new Error(typeof reason === 'string' && reason ? reason : fallbackMessage);
}

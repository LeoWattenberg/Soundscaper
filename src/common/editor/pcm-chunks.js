export const AUDIO_EDITOR_PCM_CHUNK_FRAMES = 65_536;

/**
 * Normalize arbitrary planar PCM packets into fixed-size storage chunks.
 * Each emitted chunk is owned by the consumer, and awaiting `write` applies
 * backpressure so the coalescer retains at most one chunk of working PCM.
 */
export function createPlanarPcmChunkCoalescer(options = {}) {
	const chunkFrames = positiveInteger(options.chunkFrames ?? AUDIO_EDITOR_PCM_CHUNK_FRAMES, 'chunkFrames');
	if (typeof options.onChunk !== 'function') throw new TypeError('onChunk must be a function.');
	const onChunk = options.onChunk;
	const signal = options.signal;
	let state = 'open';
	let failure = null;
	let abortReason = null;
	let channelCount = null;
	let pendingChannels = null;
	let pendingFrames = 0;
	let framesWritten = 0;
	let emittedFrames = 0;
	let emittedChunks = 0;
	let writeActive = false;
	let finalizePromise = null;
	let finalizedResult = null;

	function discardPending() {
		pendingChannels = null;
		pendingFrames = 0;
	}

	function abort(error) {
		if (state === 'finalized' || state === 'failed' || state === 'aborted') return false;
		abortReason = createPcmCoalescerAbortError(error);
		state = 'aborted';
		discardPending();
		return true;
	}

	function throwIfAborted() {
		if (state === 'aborted') throw abortReason;
		if (!signal?.aborted) return;
		abort(signal.reason);
		throw abortReason;
	}

	function closedError() {
		if (state === 'aborted') return abortReason;
		if (state === 'failed') return failure;
		return new Error('The PCM chunk coalescer is closed.');
	}

	function fail(error) {
		failure = error;
		state = 'failed';
		discardPending();
	}

	async function emit(channels, final) {
		throwIfAborted();
		const frames = channels[0].length;
		await onChunk(channels, Object.freeze({
			index: emittedChunks,
			frames,
			final,
			signal,
		}));
		emittedChunks += 1;
		emittedFrames += frames;
		throwIfAborted();
	}

	const coalescer = {
		get chunkFrames() { return chunkFrames; },
		get channelCount() { return channelCount; },
		get framesWritten() { return framesWritten; },
		get framesEmitted() { return emittedFrames; },
		get pendingFrames() { return pendingFrames; },
		get closed() { return state !== 'open'; },
		get state() { return state; },
		async write(inputChannels) {
			if (state !== 'open') throw closedError();
			if (writeActive) throw new Error('A PCM packet write is already in progress; await it before writing again.');
			throwIfAborted();
			const channels = validatePlanarPcmPacket(inputChannels, channelCount);
			if (channelCount === null) channelCount = channels.length;
			const inputFrames = channels[0].length;
			if (!inputFrames) return;
			writeActive = true;
			try {
				let inputOffset = 0;
				while (inputOffset < inputFrames) {
					throwIfAborted();
					if (!pendingChannels) {
						pendingChannels = Array.from({ length: channelCount }, () => new Float32Array(chunkFrames));
					}
					const copiedFrames = Math.min(inputFrames - inputOffset, chunkFrames - pendingFrames);
					for (let channel = 0; channel < channelCount; channel += 1) {
						pendingChannels[channel].set(
							channels[channel].subarray(inputOffset, inputOffset + copiedFrames),
							pendingFrames,
						);
					}
					inputOffset += copiedFrames;
					pendingFrames += copiedFrames;
					framesWritten += copiedFrames;
					if (pendingFrames !== chunkFrames) continue;
					const output = pendingChannels;
					pendingChannels = null;
					pendingFrames = 0;
					await emit(output, false);
				}
			} catch (error) {
				if (state === 'open') fail(error);
				throw error;
			} finally {
				writeActive = false;
			}
		},
		finalize() {
			if (state === 'finalized') return Promise.resolve(finalizedResult);
			if (finalizePromise) return finalizePromise;
			if (state !== 'open') return Promise.reject(closedError());
			if (writeActive) {
				return Promise.reject(new Error('A PCM packet write is still in progress; await it before finalizing.'));
			}
			try {
				throwIfAborted();
			} catch (error) {
				return Promise.reject(error);
			}
			state = 'finalizing';
			finalizePromise = (async () => {
				try {
					throwIfAborted();
					if (pendingFrames) {
						const output = pendingChannels.map((channel) => channel.slice(0, pendingFrames));
						discardPending();
						await emit(output, true);
					}
					finalizedResult = Object.freeze({
						channelCount: channelCount ?? 0,
						frameCount: framesWritten,
						chunkFrames,
						chunkCount: emittedChunks,
					});
					state = 'finalized';
					return finalizedResult;
				} catch (error) {
					if (state !== 'aborted') fail(error);
					throw error;
				}
			})();
			return finalizePromise;
		},
		abort,
	};
	return Object.freeze(coalescer);
}

/**
 * Immutable planar PCM split into fixed storage chunks. Accessors always
 * return copies so copy-on-write edits cannot mutate history-owned samples.
 */
export function createImmutablePcmChunks(channels, options = {}) {
	const normalized = normalizeChannels(channels);
	const chunkFrames = positiveInteger(options.chunkFrames ?? AUDIO_EDITOR_PCM_CHUNK_FRAMES, 'chunkFrames');
	const frameCount = normalized[0].length;
	const chunks = [];
	for (let startFrame = 0; startFrame < frameCount; startFrame += chunkFrames) {
		const endFrame = Math.min(frameCount, startFrame + chunkFrames);
		chunks.push(Object.freeze(normalized.map((channel) => channel.slice(startFrame, endFrame))));
	}
	return freezePcm({
		schemaVersion: 1,
		channelCount: normalized.length,
		frameCount,
		chunkFrames,
		chunks: Object.freeze(chunks),
		revision: positiveInteger(options.revision ?? 1, 'revision'),
	});
}

export function readImmutablePcmRange(pcm, startFrame = 0, endFrame = pcm?.frameCount) {
	validatePcm(pcm);
	const range = normalizeRange(startFrame, endFrame, pcm.frameCount);
	const output = Array.from({ length: pcm.channelCount }, () => new Float32Array(range.endFrame - range.startFrame));
	let outputOffset = 0;
	forEachChunkRange(pcm, range, ({ chunk, chunkOffset, frames }) => {
		for (let channel = 0; channel < pcm.channelCount; channel += 1) {
			output[channel].set(chunk[channel].subarray(chunkOffset, chunkOffset + frames), outputOffset);
		}
		outputOffset += frames;
	});
	return output;
}

/**
 * Apply sparse pencil samples. Only chunks containing an edited sample are
 * cloned; untouched chunk identities are retained for cheap history.
 */
export function editImmutablePcmSamples(pcm, edits, options = {}) {
	validatePcm(pcm);
	if (!Array.isArray(edits) || !edits.length) throw new TypeError('At least one sample edit is required.');
	const nextChunks = [...pcm.chunks];
	const changedChunkIndices = new Set();
	for (const [index, edit] of edits.entries()) {
		const frame = nonNegativeInteger(edit?.frame, `edits[${index}].frame`);
		const channel = nonNegativeInteger(edit?.channel, `edits[${index}].channel`);
		const value = Number(edit?.value);
		if (frame >= pcm.frameCount) throw new RangeError(`edits[${index}].frame is outside the source.`);
		if (channel >= pcm.channelCount) throw new RangeError(`edits[${index}].channel is outside the source.`);
		if (!Number.isFinite(value) || value < -1 || value > 1) throw new RangeError(`edits[${index}].value must be between -1 and 1.`);
		const chunkIndex = Math.floor(frame / pcm.chunkFrames);
		if (!changedChunkIndices.has(chunkIndex)) {
			nextChunks[chunkIndex] = Object.freeze(nextChunks[chunkIndex].map((values) => values.slice()));
			changedChunkIndices.add(chunkIndex);
		}
		nextChunks[chunkIndex][channel][frame % pcm.chunkFrames] = value;
	}
	return Object.freeze({
		pcm: freezePcm({
			...pcm,
			chunks: Object.freeze(nextChunks),
			revision: positiveInteger(options.revision ?? pcm.revision + 1, 'revision'),
		}),
		changedChunkIndices: Object.freeze([...changedChunkIndices].sort((left, right) => left - right)),
	});
}

/** Smooth selected samples with an Audacity-style short triangular kernel. */
export function smoothImmutablePcmRange(pcm, options = {}) {
	validatePcm(pcm);
	const range = normalizeRange(options.startFrame, options.endFrame, pcm.frameCount);
	const channelIds = options.channel == null
		? Array.from({ length: pcm.channelCount }, (_, channel) => channel)
		: [nonNegativeInteger(options.channel, 'channel')];
	if (channelIds.some((channel) => channel >= pcm.channelCount)) throw new RangeError('Smooth channel is outside the source.');
	const radius = Math.max(1, Math.min(32, positiveInteger(options.radius ?? 2, 'radius')));
	const source = readImmutablePcmRange(pcm, Math.max(0, range.startFrame - radius), Math.min(pcm.frameCount, range.endFrame + radius));
	const sourceStart = Math.max(0, range.startFrame - radius);
	const edits = [];
	for (const channel of channelIds) {
		for (let frame = range.startFrame; frame < range.endFrame; frame += 1) {
			let sum = 0;
			let weights = 0;
			for (let offset = -radius; offset <= radius; offset += 1) {
				const sourceFrame = frame + offset;
				if (sourceFrame < 0 || sourceFrame >= pcm.frameCount) continue;
				const weight = radius + 1 - Math.abs(offset);
				sum += source[channel][sourceFrame - sourceStart] * weight;
				weights += weight;
			}
			edits.push({ channel, frame, value: weights ? sum / weights : 0 });
		}
	}
	return editImmutablePcmSamples(pcm, edits, options);
}

function freezePcm(pcm) {
	return Object.freeze(pcm);
}

function validatePcm(pcm) {
	if (!pcm || pcm.schemaVersion !== 1) throw new TypeError('Immutable PCM chunks are required.');
	positiveInteger(pcm.channelCount, 'pcm.channelCount');
	positiveInteger(pcm.frameCount, 'pcm.frameCount');
	positiveInteger(pcm.chunkFrames, 'pcm.chunkFrames');
	positiveInteger(pcm.revision, 'pcm.revision');
	if (!Array.isArray(pcm.chunks) || !pcm.chunks.length) throw new TypeError('pcm.chunks must be a non-empty array.');
	return true;
}

function normalizeChannels(channels) {
	if (!Array.isArray(channels) || !channels.length || channels.length > 64) throw new TypeError('Planar PCM channels are required.');
	const frameCount = channels[0]?.length;
	if (!Number.isSafeInteger(frameCount) || frameCount <= 0) throw new RangeError('PCM must contain at least one frame.');
	return channels.map((channel, index) => {
		if (!(channel instanceof Float32Array) || channel.length !== frameCount) {
			throw new TypeError(`channels[${index}] must be an equally sized Float32Array.`);
		}
		return channel.slice();
	});
}

function validatePlanarPcmPacket(channels, expectedChannelCount) {
	if (!Array.isArray(channels) || !channels.length || channels.length > 64) {
		throw new TypeError('A planar PCM packet with 1 to 64 channels is required.');
	}
	if (expectedChannelCount !== null && channels.length !== expectedChannelCount) {
		throw new Error('Planar PCM channel count changed between packets.');
	}
	const frameCount = channels[0] instanceof Float32Array ? channels[0].length : null;
	for (let channel = 0; channel < channels.length; channel += 1) {
		if (!(channels[channel] instanceof Float32Array) || channels[channel].length !== frameCount) {
			throw new TypeError(`channels[${channel}] must be an equally sized Float32Array.`);
		}
	}
	return channels;
}

function createPcmCoalescerAbortError(reason) {
	if (reason?.name === 'AbortError') return reason;
	const message = typeof reason === 'string' && reason ? reason : 'PCM chunk coalescing was aborted.';
	const error = new Error(message);
	error.name = 'AbortError';
	if (reason !== undefined) error.cause = reason;
	return error;
}

function normalizeRange(startValue, endValue, frameCount) {
	const startFrame = nonNegativeInteger(startValue ?? 0, 'startFrame');
	const endFrame = nonNegativeInteger(endValue ?? frameCount, 'endFrame');
	if (endFrame <= startFrame || endFrame > frameCount) throw new RangeError('PCM range must be positive and within the source.');
	return { startFrame, endFrame };
}

function forEachChunkRange(pcm, range, callback) {
	let frame = range.startFrame;
	while (frame < range.endFrame) {
		const chunkIndex = Math.floor(frame / pcm.chunkFrames);
		const chunkOffset = frame % pcm.chunkFrames;
		const chunk = pcm.chunks[chunkIndex];
		const frames = Math.min(range.endFrame - frame, chunk[0].length - chunkOffset);
		callback({ chunk, chunkIndex, chunkOffset, frames, frame });
		frame += frames;
	}
}

function positiveInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function nonNegativeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return number;
}

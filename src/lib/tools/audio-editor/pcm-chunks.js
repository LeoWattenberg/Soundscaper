export const AUDIO_EDITOR_PCM_CHUNK_FRAMES = 65_536;

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

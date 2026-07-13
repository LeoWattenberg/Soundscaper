import { createStableId } from './project.js';
import { AUDIO_EDITOR_SOURCE_CHUNK_FRAMES } from './project-v2.js';
import {
	createImmutablePcmChunks,
	editImmutablePcmSamples,
	readImmutablePcmRange,
	smoothImmutablePcmRange,
} from './pcm-chunks.js';

export const AUDIO_EDITOR_SAMPLE_EDIT_MIN_PIXELS_PER_SAMPLE = 1;
export const AUDIO_EDITOR_SAMPLE_EDIT_MAX_FRAMES = 262_144;

/** Sample editing is intentionally unavailable until one source sample spans a pixel. */
export function canEditAudioSamplesAtZoom(pixelsPerSecond, sampleRate, options = {}) {
	const pixels = Number(pixelsPerSecond);
	const rate = Number(sampleRate);
	const minimum = Number(options.minimumPixelsPerSample ?? AUDIO_EDITOR_SAMPLE_EDIT_MIN_PIXELS_PER_SAMPLE);
	return Number.isFinite(pixels)
		&& Number.isFinite(rate)
		&& Number.isFinite(minimum)
		&& rate > 0
		&& minimum > 0
		&& pixels / rate >= minimum;
}

/** Convert a visible project frame to the immutable source frame under a clip. */
export function timelineFrameToSourceFrame(clip, source, timelineFrame) {
	validateClipAndSource(clip, source);
	const frame = safeInteger(timelineFrame, 'timelineFrame');
	const clipEnd = clip.timelineStartFrame + clip.durationFrames;
	if (frame < clip.timelineStartFrame || frame >= clipEnd) {
		throw new RangeError('The sample-edit frame must be inside the selected clip.');
	}
	const relativeTimelineFrame = frame - clip.timelineStartFrame;
	const relativeSourceFrame = Math.min(
		clip.sourceDurationFrames - 1,
		Math.floor(relativeTimelineFrame * clip.sourceDurationFrames / clip.durationFrames),
	);
	return clip.reversed
		? clip.sourceStartFrame + clip.sourceDurationFrames - 1 - relativeSourceFrame
		: clip.sourceStartFrame + relativeSourceFrame;
}

/**
 * Turn pointer samples into a continuous, frame-addressed pencil stroke.
 * Later points win when a stroke crosses the same frame more than once.
 */
export function createPencilSampleEdits({ clip, source, channel = 0, points, maximumFrames = AUDIO_EDITOR_SAMPLE_EDIT_MAX_FRAMES } = {}) {
	validateClipAndSource(clip, source);
	const channelIndex = boundedInteger(channel, 0, source.channelCount - 1, 'channel');
	if (!Array.isArray(points) || points.length < 1) throw new TypeError('A pencil stroke requires at least one point.');
	const maximum = positiveInteger(maximumFrames, 'maximumFrames');
	const normalized = points.map((point, index) => ({
		frame: timelineFrameToSourceFrame(clip, source, point?.timelineFrame),
		value: sampleValue(point?.value, `points[${index}].value`),
	}));
	const edits = new Map();
	const add = (frame, value) => {
		edits.set(frame, { channel: channelIndex, frame, value: sampleValue(value, 'interpolated sample') });
		if (edits.size > maximum) throw new RangeError(`A sample pencil stroke cannot exceed ${maximum} source frames.`);
	};
	add(normalized[0].frame, normalized[0].value);
	for (let index = 1; index < normalized.length; index += 1) {
		const previous = normalized[index - 1];
		const current = normalized[index];
		const distance = Math.abs(current.frame - previous.frame);
		if (!distance) {
			add(current.frame, current.value);
			continue;
		}
		const direction = Math.sign(current.frame - previous.frame);
		for (let step = 1; step <= distance; step += 1) {
			const amount = step / distance;
			add(previous.frame + direction * step, previous.value + (current.value - previous.value) * amount);
		}
	}
	return Object.freeze([...edits.values()].sort((left, right) => left.frame - right.frame || left.channel - right.channel));
}

/** Map a project selection to the selected clip's source interval. */
export function createSmoothSampleRange({ clip, source, startFrame, endFrame, channel = null, maximumFrames = AUDIO_EDITOR_SAMPLE_EDIT_MAX_FRAMES } = {}) {
	validateClipAndSource(clip, source);
	const start = safeInteger(startFrame, 'startFrame');
	const end = safeInteger(endFrame, 'endFrame');
	if (end <= start) throw new RangeError('Sample smoothing requires a non-empty selection.');
	const intersectionStart = Math.max(start, clip.timelineStartFrame);
	const intersectionEnd = Math.min(end, clip.timelineStartFrame + clip.durationFrames);
	if (intersectionEnd <= intersectionStart) throw new RangeError('The smoothing selection must overlap the selected clip.');
	const first = timelineFrameToSourceFrame(clip, source, intersectionStart);
	const last = timelineFrameToSourceFrame(clip, source, intersectionEnd - 1);
	const sourceStartFrame = Math.min(first, last);
	const sourceEndFrame = Math.max(first, last) + 1;
	const length = sourceEndFrame - sourceStartFrame;
	const maximum = positiveInteger(maximumFrames, 'maximumFrames');
	if (length > maximum) throw new RangeError(`A sample smoothing selection cannot exceed ${maximum} source frames.`);
	return Object.freeze({
		startFrame: sourceStartFrame,
		endFrame: sourceEndFrame,
		channel: channel == null ? null : boundedInteger(channel, 0, source.channelCount - 1, 'channel'),
	});
}

/**
 * Persist a derived immutable source without ever publishing partial PCM.
 * The caller publishes the returned source descriptor in one editor command;
 * `rollback()` removes the committed source if that command cannot be applied.
 */
export async function persistImmutableSampleEdit({
	store,
	source,
	edits = null,
	smooth = null,
	sourceId = createStableId('sample-edit'),
	radius = 2,
	signal = null,
} = {}) {
	validateStore(store);
	validateSource(source);
	if (source.chunkFrames !== AUDIO_EDITOR_SOURCE_CHUNK_FRAMES) {
		throw new RangeError(`Sample editing requires ${AUDIO_EDITOR_SOURCE_CHUNK_FRAMES}-frame immutable sources.`);
	}
	if ((edits == null) === (smooth == null)) throw new TypeError('Choose either pencil edits or a smoothing range.');
	const stableSourceId = nonEmptyString(sourceId, 'sourceId');
	let normalizedEdits = edits == null ? null : normalizeSourceEdits(edits, source);
	if (smooth != null) normalizedEdits = await createSmoothingEdits(store, source, smooth, radius, signal);
	const editsByChunk = groupEditsByChunk(normalizedEdits, source.chunkFrames);
	const revision = Number(source.opaqueExtensions?.sampleEditRevision || 0) + 1;
	if (typeof store.writeDerivedSource === 'function') {
		const replacementChunks = [];
		const pendingChunkIndices = new Set(editsByChunk.keys());
		let frameOffset = 0;
		let chunkCount = 0;
		for await (const storedChunk of store.readSourceChunks(source.id)) {
			throwIfAborted(signal);
			const channels = validateStoredChunk(storedChunk, source, chunkCount, frameOffset);
			const localEdits = editsByChunk.get(chunkCount);
			if (localEdits?.length) {
				replacementChunks.push({
					index: chunkCount,
					channels: editStoredChunk(channels, localEdits, frameOffset, source.chunkFrames),
				});
				pendingChunkIndices.delete(chunkCount);
			}
			frameOffset += channels[0].length;
			chunkCount += 1;
			if (!pendingChunkIndices.size) break;
		}
		if (pendingChunkIndices.size) throw new Error('The stored source ended before an edited chunk could be read.');
		throwIfAborted(signal);
		const metadata = await store.writeDerivedSource(stableSourceId, source.id, replacementChunks, {
			name: source.name,
			mimeType: source.mimeType,
			sampleRate: source.sampleRate,
			channelCount: source.channelCount,
			chunkFrames: source.chunkFrames,
			sampleEditRevision: revision,
		});
		return createPersistedSampleEditResult(store, source, stableSourceId, metadata, editsByChunk, revision);
	}
	const writer = await store.beginSourceWrite(stableSourceId, {
		name: source.name,
		mimeType: source.mimeType,
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		derivedFromSourceId: source.id,
	});
	let committed = false;
	try {
		let frameOffset = 0;
		let chunkCount = 0;
		for await (const storedChunk of store.readSourceChunks(source.id)) {
			throwIfAborted(signal);
			const channels = validateStoredChunk(storedChunk, source, chunkCount, frameOffset);
			const localEdits = editsByChunk.get(chunkCount) || [];
			let outputChannels = channels;
			if (localEdits.length) outputChannels = editStoredChunk(channels, localEdits, frameOffset, source.chunkFrames);
			await writer.write(outputChannels);
			frameOffset += channels[0].length;
			chunkCount += 1;
		}
		if (frameOffset !== source.frameCount) throw new Error('The stored source ended before its declared frame count.');
		throwIfAborted(signal);
		const metadata = await writer.commit({
			sampleRate: source.sampleRate,
			channelCount: source.channelCount,
			sampleEditRevision: revision,
		});
		committed = true;
		return createPersistedSampleEditResult(store, source, stableSourceId, metadata, editsByChunk, revision);
	} catch (error) {
		if (!committed) await writer.abort().catch(() => undefined);
		throw error;
	}
}

function editStoredChunk(channels, edits, frameOffset, chunkFrames) {
	const pcm = createImmutablePcmChunks(channels, { chunkFrames });
	return readImmutablePcmRange(
		editImmutablePcmSamples(pcm, edits.map((edit) => ({ ...edit, frame: edit.frame - frameOffset }))).pcm,
	);
}

function createPersistedSampleEditResult(store, source, sourceId, metadata, editsByChunk, revision) {
	const descriptor = Object.freeze({
		...source,
		id: sourceId,
		storageKey: sourceId,
		sampleFormat: 'float32',
		opaqueExtensions: {
			...(source.opaqueExtensions || {}),
			sampleEditRevision: revision,
		},
	});
	let rolledBack = false;
	return Object.freeze({
		source: descriptor,
		metadata: Object.freeze({ ...metadata }),
		changedChunkIndices: Object.freeze([...editsByChunk.keys()].sort((left, right) => left - right)),
		async rollback() {
			if (rolledBack) return;
			rolledBack = true;
			await store.deleteSource(sourceId);
		},
	});
}

async function createSmoothingEdits(store, source, options, requestedRadius, signal) {
	const startFrame = boundedInteger(options?.startFrame, 0, source.frameCount - 1, 'smooth.startFrame');
	const endFrame = boundedInteger(options?.endFrame, startFrame + 1, source.frameCount, 'smooth.endFrame');
	if (endFrame - startFrame > AUDIO_EDITOR_SAMPLE_EDIT_MAX_FRAMES) {
		throw new RangeError(`A sample smoothing selection cannot exceed ${AUDIO_EDITOR_SAMPLE_EDIT_MAX_FRAMES} source frames.`);
	}
	const channel = options?.channel == null ? null : boundedInteger(options.channel, 0, source.channelCount - 1, 'smooth.channel');
	const radius = boundedInteger(requestedRadius, 1, 32, 'radius');
	const readStart = Math.max(0, startFrame - radius);
	const readEnd = Math.min(source.frameCount, endFrame + radius);
	const channels = await readStoredSourceRange(store, source, readStart, readEnd, signal);
	const pcm = createImmutablePcmChunks(channels, { chunkFrames: source.chunkFrames });
	const smoothed = smoothImmutablePcmRange(pcm, {
		startFrame: startFrame - readStart,
		endFrame: endFrame - readStart,
		channel,
		radius,
	}).pcm;
	const output = readImmutablePcmRange(smoothed, startFrame - readStart, endFrame - readStart);
	const edits = [];
	const channelIds = channel == null ? Array.from({ length: source.channelCount }, (_, index) => index) : [channel];
	for (const channelIndex of channelIds) {
		for (let frame = startFrame; frame < endFrame; frame += 1) {
			edits.push({ channel: channelIndex, frame, value: output[channelIndex][frame - startFrame] });
		}
	}
	return edits;
}

async function readStoredSourceRange(store, source, startFrame, endFrame, signal) {
	const output = Array.from({ length: source.channelCount }, () => new Float32Array(endFrame - startFrame));
	let sourceOffset = 0;
	let outputFrames = 0;
	let chunkIndex = 0;
	for await (const storedChunk of store.readSourceChunks(source.id)) {
		throwIfAborted(signal);
		const channels = validateStoredChunk(storedChunk, source, chunkIndex, sourceOffset);
		const chunkEnd = sourceOffset + channels[0].length;
		const copyStart = Math.max(startFrame, sourceOffset);
		const copyEnd = Math.min(endFrame, chunkEnd);
		if (copyEnd > copyStart) {
			for (let channel = 0; channel < source.channelCount; channel += 1) {
				output[channel].set(
					channels[channel].subarray(copyStart - sourceOffset, copyEnd - sourceOffset),
					copyStart - startFrame,
				);
			}
			outputFrames += copyEnd - copyStart;
		}
		sourceOffset = chunkEnd;
		chunkIndex += 1;
		if (sourceOffset >= endFrame) break;
	}
	if (outputFrames !== endFrame - startFrame) throw new Error('The stored source does not cover the requested sample range.');
	return output;
}

function normalizeSourceEdits(edits, source) {
	if (!Array.isArray(edits) || !edits.length) throw new TypeError('At least one sample edit is required.');
	if (edits.length > AUDIO_EDITOR_SAMPLE_EDIT_MAX_FRAMES * source.channelCount) {
		throw new RangeError('The sample edit contains too many source frames.');
	}
	const unique = new Map();
	for (const [index, edit] of edits.entries()) {
		const frame = boundedInteger(edit?.frame, 0, source.frameCount - 1, `edits[${index}].frame`);
		const channel = boundedInteger(edit?.channel, 0, source.channelCount - 1, `edits[${index}].channel`);
		unique.set(`${channel}:${frame}`, { frame, channel, value: sampleValue(edit?.value, `edits[${index}].value`) });
	}
	return [...unique.values()].sort((left, right) => left.frame - right.frame || left.channel - right.channel);
}

function groupEditsByChunk(edits, chunkFrames) {
	const grouped = new Map();
	for (const edit of edits) {
		const index = Math.floor(edit.frame / chunkFrames);
		if (!grouped.has(index)) grouped.set(index, []);
		grouped.get(index).push(edit);
	}
	return grouped;
}

function validateClipAndSource(clip, source) {
	validateSource(source);
	if (!clip || typeof clip !== 'object') throw new TypeError('An audio clip is required.');
	for (const key of ['timelineStartFrame', 'sourceStartFrame']) safeInteger(clip[key], `clip.${key}`);
	for (const key of ['durationFrames', 'sourceDurationFrames']) positiveInteger(clip[key], `clip.${key}`);
	if (clip.sourceId !== source.id) throw new RangeError('The clip does not reference the supplied source.');
	if (clip.sourceStartFrame + clip.sourceDurationFrames > source.frameCount) throw new RangeError('The clip exceeds its source bounds.');
}

function validateSource(source) {
	if (!source || typeof source !== 'object') throw new TypeError('An immutable audio source is required.');
	nonEmptyString(source.id, 'source.id');
	positiveInteger(source.frameCount, 'source.frameCount');
	positiveInteger(source.channelCount, 'source.channelCount');
	positiveInteger(source.sampleRate, 'source.sampleRate');
	positiveInteger(source.chunkFrames, 'source.chunkFrames');
}

function validateStore(store) {
	for (const method of ['readSourceChunks', 'deleteSource']) {
		if (typeof store?.[method] !== 'function') throw new TypeError(`The project store must implement ${method}().`);
	}
	if (typeof store?.writeDerivedSource !== 'function' && typeof store?.beginSourceWrite !== 'function') {
		throw new TypeError('The project store must implement writeDerivedSource() or beginSourceWrite().');
	}
}

function validateStoredChunk(chunk, source, expectedIndex, frameOffset) {
	if (Number(chunk?.index) !== expectedIndex) throw new Error('Stored source chunks must be contiguous and ordered.');
	if (!Array.isArray(chunk.channels) || chunk.channels.length !== source.channelCount) {
		throw new Error('A stored source chunk has the wrong channel count.');
	}
	const channels = chunk.channels.map((channel) => {
		if (!(channel instanceof Float32Array)) throw new Error('Stored source chunks must contain Float32 PCM.');
		return channel;
	});
	const frames = Number(chunk.frames);
	if (!Number.isSafeInteger(frames) || frames < 1 || frames > source.chunkFrames) throw new Error('A stored source chunk has an invalid frame count.');
	if (channels.some((channel) => channel.length !== frames)) throw new Error('Stored source channel lengths do not match.');
	if (expectedIndex < Math.ceil(source.frameCount / source.chunkFrames) - 1 && frames !== source.chunkFrames) {
		throw new Error('Only the final immutable source chunk may be short.');
	}
	if (frameOffset + frames > source.frameCount) throw new Error('Stored source chunks exceed the declared frame count.');
	return channels;
}

function throwIfAborted(signal) {
	if (!signal?.aborted) return;
	if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
	const error = new Error('Sample editing was cancelled.');
	error.name = 'AbortError';
	throw error;
}

function sampleValue(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < -1 || number > 1) throw new RangeError(`${name} must be between -1 and 1.`);
	return number;
}

function positiveInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function safeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return number;
}

function boundedInteger(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}

function nonEmptyString(value, name) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

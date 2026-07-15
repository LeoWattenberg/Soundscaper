import { createStreamingWindowedSincResampler } from './resample.js';

/**
 * Materialize the fixed-rate, fixed-layout tracks required by AUP4 without
 * changing the browser project. The returned project and PCM are export-only.
 */
export function normalizeAup4ExportSnapshot(project, sourceAudio = []) {
	if (!project || !Array.isArray(project.tracks) || !Array.isArray(project.clips) || !Array.isArray(project.sources)) {
		throw exportError('An audio editor project is required.', 'INVALID_SNAPSHOT');
	}
	if (!Array.isArray(sourceAudio)) throw exportError('AUP4 source audio must be an array.', 'INVALID_SNAPSHOT');
	const projectRate = positiveRate(project.sampleRate, 'project.sampleRate');
	const sourceById = new Map(project.sources.map((source) => [source.id, source]));
	const audioById = new Map(sourceAudio.map((source) => [source.sourceId, source]));
	const clipById = new Map(project.clips.map((clip) => [clip.id, clip]));
	const normalizedProject = clone(project);
	const normalizedClipById = new Map(normalizedProject.clips.map((clip) => [clip.id, clip]));
	const normalizedSources = [];
	const normalizedSourceMetadata = [];
	const variants = new Map();
	const variantIds = new Set(sourceById.keys());

	for (const track of project.tracks) {
		if ((track.type || track.kind || 'audio') === 'label') continue;
		const clips = (track.clipIds || []).map((clipId) => {
			const clip = clipById.get(clipId);
			if (!clip) throw exportError(`AUP4 track ${track.id} references missing clip ${clipId}.`, 'INVALID_SNAPSHOT');
			return clip;
		});
		const referencedSources = clips.map((clip) => {
			const source = sourceById.get(clip.sourceId);
			if (!source) throw exportError(`AUP4 clip ${clip.id} references missing source ${clip.sourceId}.`, 'MISSING_SOURCE');
			return source;
		});
		const targetChannels = referencedSources.some((source) => positiveChannelCount(source.channelCount) > 1) ? 2 : 1;
		const rates = new Set(referencedSources.map((source) => positiveRate(source.sampleRate, `source ${source.id} sampleRate`)));
		const targetRate = rates.size === 1 ? rates.values().next().value : projectRate;

		for (const clip of clips) {
			const source = sourceById.get(clip.sourceId);
			const ratio = targetRate / positiveRate(source.sampleRate, `source ${source.id} sampleRate`);
			const sourceFrameCount = positiveFrame(source.frameCount, `source ${source.id} frameCount`);
			const sourceStartFrame = nonNegativeFrame(clip.sourceStartFrame, `clip ${clip.id} sourceStartFrame`);
			const sourceDurationFrames = positiveFrame(
				clip.sourceDurationFrames ?? clip.durationFrames,
				`clip ${clip.id} sourceDurationFrames`,
			);
			const sourceEndFrame = sourceStartFrame + sourceDurationFrames;
			const trimStartFrames = nonNegativeFrame(clip.trimStartFrames ?? 0, `clip ${clip.id} trimStartFrames`);
			const trimEndFrames = nonNegativeFrame(clip.trimEndFrames ?? 0, `clip ${clip.id} trimEndFrames`);
			if (
				sourceEndFrame > sourceFrameCount
				|| trimStartFrames > sourceStartFrame
				|| sourceEndFrame + trimEndFrames > sourceFrameCount
			) {
				throw exportError(`AUP4 clip ${clip.id} exceeds source ${source.id}.`, 'INVALID_SNAPSHOT');
			}
			const variant = materializeVariant(source, targetRate, targetChannels);
			const normalizedClip = normalizedClipById.get(clip.id);
			const scaledSourceStart = Math.min(variant.source.frameCount - 1, scaleBoundary(sourceStartFrame, ratio));
			const scaledSourceEnd = Math.min(
				variant.source.frameCount,
				Math.max(scaledSourceStart + 1, scaleBoundary(sourceEndFrame, ratio)),
			);
			normalizedClip.sourceId = variant.source.id;
			normalizedClip.sourceStartFrame = scaledSourceStart;
			normalizedClip.sourceDurationFrames = Math.max(1, scaledSourceEnd - scaledSourceStart);
			normalizedClip.trimStartFrames = Math.min(scaledSourceStart, scaledRangeLength(
				Math.max(0, sourceStartFrame - trimStartFrames),
				sourceStartFrame,
				ratio,
			));
			normalizedClip.trimEndFrames = Math.min(variant.source.frameCount - scaledSourceEnd, scaledRangeLength(
				sourceEndFrame,
				sourceEndFrame + trimEndFrames,
				ratio,
			));
		}

		function materializeVariant(source, targetRate, targetChannels) {
			const key = JSON.stringify([source.id, targetRate, targetChannels]);
			const existing = variants.get(key);
			if (existing) return existing;
			const audio = audioById.get(source.id);
			if (!audio) throw exportError(`PCM for project source ${source.id} is missing.`, 'MISSING_SOURCE');
			const inputChannels = normalizeInputChannels(audio.channels, source);
			const mappedChannels = mapChannels(inputChannels, targetChannels);
			const sourceRate = positiveRate(source.sampleRate ?? audio.sampleRate, `source ${source.id} sampleRate`);
			const channels = sourceRate === targetRate
				? mappedChannels.map((channel) => channel.slice())
				: resampleChannels(mappedChannels, sourceRate, targetRate);
			const variantId = uniqueVariantId(source.id, targetRate, targetChannels, variantIds);
			const normalizedSource = {
				...clone(source),
				id: variantId,
				storageKey: variantId,
				frameCount: channels[0].length,
				channelCount: targetChannels,
				sampleRate: targetRate,
				sampleFormat: 'float32',
			};
			const result = {
				source: normalizedSource,
				audio: { sourceId: variantId, sampleRate: targetRate, channels },
			};
			variants.set(key, result);
			normalizedSourceMetadata.push(normalizedSource);
			normalizedSources.push(result.audio);
			return result;
		}
	}

	normalizedProject.sources = normalizedSourceMetadata;
	return { project: normalizedProject, sources: normalizedSources };
}

function normalizeInputChannels(values, source) {
	if (!Array.isArray(values) || !values.length) {
		throw exportError(`PCM for project source ${source.id} has no channels.`, 'INVALID_SOURCE_AUDIO');
	}
	const channels = values.map((channel) => {
		if (channel instanceof Float32Array) return channel;
		if (ArrayBuffer.isView(channel) || Array.isArray(channel)) return Float32Array.from(channel);
		throw exportError(`PCM for project source ${source.id} must contain Float32 samples.`, 'INVALID_SOURCE_AUDIO');
	});
	const frameCount = channels[0].length;
	if (!frameCount || channels.some((channel) => channel.length !== frameCount)) {
		throw exportError(`PCM channels for project source ${source.id} must have the same positive length.`, 'INVALID_SOURCE_AUDIO');
	}
	if (frameCount !== positiveFrame(source.frameCount, `source ${source.id} frameCount`)) {
		throw exportError(`PCM frame count for project source ${source.id} does not match its metadata.`, 'INVALID_SOURCE_AUDIO');
	}
	const declaredChannels = positiveChannelCount(source.channelCount);
	if (channels.length !== declaredChannels) {
		throw exportError(`PCM channel count for project source ${source.id} does not match its metadata.`, 'INVALID_SOURCE_AUDIO');
	}
	return channels;
}

function mapChannels(channels, targetChannels) {
	if (targetChannels === 1) return [channels[0]];
	if (channels.length === 1) return [channels[0], channels[0]];
	if (channels.length === 2) return channels;
	const frameCount = channels[0].length;
	const left = channels[0].slice();
	const right = channels[1].slice();
	if (channels.length === 3) {
		mixInto(left, channels[2], Math.SQRT1_2);
		mixInto(right, channels[2], Math.SQRT1_2);
	} else if (channels.length === 4) {
		mixInto(left, channels[2], Math.SQRT1_2);
		mixInto(right, channels[3], Math.SQRT1_2);
	} else if (channels.length === 5) {
		mixInto(left, channels[2], Math.SQRT1_2);
		mixInto(right, channels[2], Math.SQRT1_2);
		mixInto(left, channels[3], Math.SQRT1_2);
		mixInto(right, channels[4], Math.SQRT1_2);
	} else {
		mixInto(left, channels[2], Math.SQRT1_2);
		mixInto(right, channels[2], Math.SQRT1_2);
		mixInto(left, channels[3], 0.5);
		mixInto(right, channels[3], 0.5);
		mixInto(left, channels[4], Math.SQRT1_2);
		mixInto(right, channels[5], Math.SQRT1_2);
		for (let channel = 6; channel < channels.length; channel += 1) {
			mixInto(channel % 2 ? right : left, channels[channel], 0.5);
		}
	}
	if (left.length !== frameCount || right.length !== frameCount) throw exportError('AUP4 channel downmix failed.', 'INVALID_SOURCE_AUDIO');
	return [left, right];
}

function mixInto(output, input, gain) {
	for (let frame = 0; frame < output.length; frame += 1) output[frame] += input[frame] * gain;
}

function resampleChannels(channels, inputRate, outputRate) {
	const outputFrames = Math.max(1, Math.round(channels[0].length * outputRate / inputRate));
	const resampler = createStreamingWindowedSincResampler(inputRate, outputRate, channels.length);
	const head = resampler.push(channels);
	const tail = resampler.finish(outputFrames);
	return head.map((values, channel) => {
		const output = new Float32Array(values.length + tail[channel].length);
		output.set(values);
		output.set(tail[channel], values.length);
		return output.length === outputFrames ? output : output.slice(0, outputFrames);
	});
}

function uniqueVariantId(sourceId, sampleRate, channelCount, usedIds) {
	const base = `${sourceId}-aup4-${sampleRate}-${channelCount}ch`;
	let id = base;
	let suffix = 1;
	while (usedIds.has(id)) id = `${base}-${++suffix}`;
	usedIds.add(id);
	return id;
}

function scaleBoundary(frame, ratio) {
	return Math.max(0, Math.round(frame * ratio));
}

function scaledRangeLength(startFrame, endFrame, ratio) {
	return Math.max(0, scaleBoundary(endFrame, ratio) - scaleBoundary(startFrame, ratio));
}

function positiveRate(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0 || number > 768_000) throw exportError(`${name} is invalid.`, 'INVALID_SAMPLE_RATE');
	return Math.round(number);
}

function positiveChannelCount(value) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0 || number > 64) throw exportError('AUP4 source channelCount is invalid.', 'INVALID_SOURCE_AUDIO');
	return number;
}

function nonNegativeFrame(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw exportError(`${name} is invalid.`, 'INVALID_SNAPSHOT');
	return number;
}

function positiveFrame(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw exportError(`${name} is invalid.`, 'INVALID_SNAPSHOT');
	return number;
}

function clone(value) {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function exportError(message, code) {
	const error = new Error(message);
	error.name = 'Aup4ExportError';
	error.code = code;
	return error;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * PCM material for an AUP4 export. Audacity stores no clip-level reverse,
 * polarity or excess gain, so a clip carrying any of them is exported against
 * an isolated source variant whose samples already have them applied. These
 * helpers describe that variant, render it, and validate the PCM handed in for
 * one project source.
 */

import {
	finiteNonNegative,
	exportError,
	nonNegativeFrame,
	positiveChannelCount,
	positiveFrame,
	scaleBoundary,
} from './aup4-export-values.js';

/** Describe the variant a clip needs, or null when its source serves as-is. */
export function normalizeMaterialTransform(transform, inputFrameCount) {
	const reversed = Boolean(transform?.reversed);
	const inverted = Boolean(transform?.inverted);
	const pcmGain = finiteNonNegative(transform?.pcmGain, 1);
	const sliceStartFrame = nonNegativeFrame(transform?.sliceStartFrame ?? 0, 'AUP4 material transform sliceStartFrame');
	const sliceEndFrame = nonNegativeFrame(
		transform?.sliceEndFrame ?? inputFrameCount,
		'AUP4 material transform sliceEndFrame',
	);
	if (sliceEndFrame <= sliceStartFrame || sliceEndFrame > inputFrameCount) {
		throw exportError('AUP4 material transform range is invalid.', 'INVALID_SNAPSHOT');
	}
	if (!reversed && !inverted && pcmGain === 1
		&& sliceStartFrame === 0 && sliceEndFrame === inputFrameCount) return null;
	return {
		sliceStartFrame,
		sliceEndFrame,
		reversed,
		inverted,
		pcmGain,
	};
}

/** Render one described variant from a source's channels. */
export function applyMaterialTransform(channels, transform, inputRate, outputRate) {
	if (!transform) return channels;
	const ratio = outputRate / inputRate;
	const start = Math.min(channels[0].length - 1, scaleBoundary(transform.sliceStartFrame, ratio));
	const end = Math.min(channels[0].length, Math.max(start + 1, scaleBoundary(transform.sliceEndFrame, ratio)));
	return channels.map((input) => {
		const channel = input.slice(start, end);
		if (transform.reversed) {
			for (let left = 0, right = channel.length - 1; left < right; left += 1, right -= 1) {
				const value = channel[left];
				channel[left] = channel[right];
				channel[right] = value;
			}
		}
		const scale = transform.inverted ? -transform.pcmGain : transform.pcmGain;
		if (scale !== 1) {
			for (let frame = 0; frame < channel.length; frame += 1) channel[frame] *= scale;
		}
		return channel;
	});
}

/** Accept only PCM that matches the metadata of the source it belongs to. */
export function normalizeInputChannels(values, source) {
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

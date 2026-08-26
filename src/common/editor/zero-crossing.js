/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Find the nearest linked-channel zero crossing. Exact zero samples and sign
 * changes are preferred by distance, then by the lowest summed amplitude.
 * If a window has no crossing, its quietest frame is returned.
 */
export function findNearestAudioZeroCrossing(channels, targetFrame, options = {}) {
	validateChannels(channels);
	if (!channels[0].length) return 0;
	const target = Math.max(0, Math.min(channels[0].length - 1, Math.round(Number(targetFrame) || 0)));
	const maximumDistance = Math.max(0, Math.min(
		channels[0].length - 1,
		Number.isSafeInteger(Number(options.maximumDistance))
			? Number(options.maximumDistance)
			: channels[0].length - 1,
	));
	let quietestFrame = target;
	let quietestScore = linkedAmplitude(channels, target);
	for (let distance = 0; distance <= maximumDistance; distance += 1) {
		const candidates = distance === 0 ? [target] : [target - distance, target + distance];
		let crossing = null;
		let crossingScore = Infinity;
		for (const frame of candidates) {
			if (frame < 0 || frame >= channels[0].length) continue;
			const score = linkedAmplitude(channels, frame);
			if (score < quietestScore) {
				quietestFrame = frame;
				quietestScore = score;
			}
			if (isLinkedZeroCrossing(channels, frame) && score < crossingScore) {
				crossing = frame;
				crossingScore = score;
			}
		}
		if (crossing != null) return crossing;
	}
	return quietestFrame;
}

function validateChannels(channels) {
	if (!Array.isArray(channels) || !channels.length
		|| channels.some((channel) => !(channel instanceof Float32Array))) {
		throw new TypeError('Planar Float32 audio channels are required.');
	}
	if (channels.some((channel) => channel.length !== channels[0].length)) {
		throw new RangeError('Audio channels must have equal lengths.');
	}
}

function isLinkedZeroCrossing(channels, frame) {
	for (const channel of channels) {
		const current = Number(channel[frame]) || 0;
		if (current === 0) return true;
		if (frame > 0) {
			const previous = Number(channel[frame - 1]) || 0;
			if (previous === 0 || (previous < 0 && current > 0) || (previous > 0 && current < 0)) return true;
		}
	}
	return false;
}

function linkedAmplitude(channels, frame) {
	let amplitude = 0;
	for (const channel of channels) amplitude += Math.abs(Number(channel[frame]) || 0);
	return amplitude;
}

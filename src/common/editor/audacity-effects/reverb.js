/*
 * Browser-native Schroeder/Freeverb-style reverb for the Audacity-compatible
 * effect registry. This implementation deliberately has no SoX dependency.
 * SPDX-License-Identifier: GPL-3.0-only
 */

import { ReverbLiveProcessor } from './reverb-live-processor.ts';

export { normalizeReverbParams } from './reverb-parameters.ts';

export function applyAudacityBrowserReverb(channels, sampleRate = 48_000, params = {}) {
	validateAudio(channels, sampleRate);
	const processor = new ReverbLiveProcessor(sampleRate, params);
	const output = channels.map((channel) => new Float32Array(channel.length));
	processor.process(channels, output);
	return output;
}

function validateAudio(channels, sampleRate) {
	if (!Array.isArray(channels) || !channels.length || channels.some((channel) => !(channel instanceof Float32Array))) {
		throw new TypeError('Reverb requires planar Float32 audio.');
	}
	if (channels.some((channel) => channel.length !== channels[0].length)) throw new RangeError('Reverb channels must have equal lengths.');
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive.');
}

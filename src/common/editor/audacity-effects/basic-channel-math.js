/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Whole-selection channel arithmetic shared by the one-shot Audacity 3.7.7
 * effect adaptations: gain application, peak and RMS measurement, and the
 * decibel and frame conversions those effects state their parameters in. Split
 * out of basic.js; no behaviour changes here.
 */

export function cloneChannels(channels) {
	return channels.map((channel) => new Float32Array(channel));
}

export function validateAudacityAudioInput(channels, sampleRate) {
	if (!Array.isArray(channels) || channels.length === 0) {
		throw new TypeError('channels must be a non-empty array of Float32Array values.');
	}
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
		throw new RangeError('sampleRate must be a positive finite number.');
	}
	const length = channels[0] instanceof Float32Array ? channels[0].length : -1;
	for (const channel of channels) {
		if (!(channel instanceof Float32Array)) throw new TypeError('Every channel must be a Float32Array.');
		if (channel.length !== length) throw new RangeError('All channels must have the same length.');
	}
}

export function multiplyChannels(channels, gain) {
	return channels.map((channel) => multiplyChannel(channel, gain));
}

export function multiplyChannel(channel, gain) {
	return Float32Array.from(channel, (sample) => sample * gain);
}

export function channelPeak(channels) {
	let peak = 0;
	for (const channel of channels) {
		for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
	}
	return peak;
}

export function channelRms(channel) {
	if (channel.length === 0) return 0;
	let sum = 0;
	for (const sample of channel) sum += sample * sample;
	return Math.sqrt(sum / channel.length);
}

export function dbToLinear(db) {
	return 10 ** (db / 20);
}

export function timeToFrames(seconds, sampleRate) {
	return Math.round(seconds * sampleRate);
}

export function sampleOrZero(channel, index) {
	return index >= 0 && index < channel.length ? channel[index] : 0;
}

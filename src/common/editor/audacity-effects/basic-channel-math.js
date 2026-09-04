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

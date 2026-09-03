/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The example recordings, synthesised from the recipes in `fixtures.mjs`.
 *
 * The same bytes serve two readers: the browser suite feeds them to the editor
 * when it replays a guide, and `scripts/publish-guide-examples.mjs` puts them
 * in the assets bucket so a tutorial can hand its reader the file it is about
 * to walk through. Keeping the synthesis here, next to the recipe names, is
 * what makes those two files the same file.
 */

import { GUIDE_FIXTURES } from './fixtures.mjs';

export const EXAMPLE_SAMPLE_RATE = 48_000;

/** A small deterministic generator, so a "noisy" example is the same bytes every run. */
function seededRandom(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296 * 2 - 1;
	};
}

const tone = (frequency, amplitude, phase = 0) => (time) => Math.sin(2 * Math.PI * frequency * time + phase) * amplitude;

const RECIPES = Object.freeze({
	'noise-then-tone': ({ channel }) => {
		const random = seededRandom(11 + channel);
		const voice = tone(220, 0.4, channel * Math.PI / 3);
		return (time) => random() * 0.04 + (time >= 0.5 ? voice(time) : 0);
	},
	'quiet-tone': ({ channel }) => tone(330, 0.05, channel * Math.PI / 3),
	tone: ({ channel }) => tone(261.6, 0.35, channel * Math.PI / 3),
	'tone-high': ({ channel }) => tone(392, 0.3, channel * Math.PI / 3),
	'tone-with-gaps': () => {
		const phrase = tone(196, 0.35);
		// Phrases of 0.6 s separated by 0.7 s of silence, which is longer than
		// Truncate Silence's default minimum, so the guide has pauses to shorten.
		return (time) => (time % 1.3 < 0.6 ? phrase(time) : 0);
	},
	'tone-with-clicks': ({ sampleRate }) => {
		const music = tone(261.6, 0.3);
		const clickFrames = new Set([0.3, 0.8, 1.1, 1.6].map((seconds) => Math.round(seconds * sampleRate)));
		return (time, frame) => (clickFrames.has(frame) ? 0.9 : music(time));
	},
});

function writeWav(channels, sampleRate) {
	const channelCount = channels.length;
	const frameCount = channels[0].length;
	const bytesPerSample = 2;
	const dataLength = frameCount * channelCount * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataLength);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + dataLength, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(channelCount, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
	buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
	buffer.writeUInt16LE(bytesPerSample * 8, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(dataLength, 40);
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
			buffer.writeInt16LE(Math.round(sample * 32_767), 44 + (frame * channelCount + channel) * bytesPerSample);
		}
	}
	return buffer;
}

const cache = new Map();

/** The WAV bytes of an example recording, by fixture id. */
export function exampleAudio(id) {
	const fixture = GUIDE_FIXTURES[id];
	if (!fixture) throw new RangeError(`Unknown guide fixture ${String(id)}.`);
	if (!cache.has(id)) {
		const recipe = RECIPES[fixture.recipe];
		if (!recipe) throw new RangeError(`Guide fixture ${id} uses unknown recipe ${fixture.recipe}.`);
		const frameCount = Math.round(fixture.seconds * EXAMPLE_SAMPLE_RATE);
		const channels = Array.from({ length: fixture.channels }, (_, channel) => {
			const sampleAt = recipe({ channel, sampleRate: EXAMPLE_SAMPLE_RATE });
			return Float32Array.from({ length: frameCount }, (__, frame) => sampleAt(frame / EXAMPLE_SAMPLE_RATE, frame));
		});
		cache.set(id, writeWav(channels, EXAMPLE_SAMPLE_RATE));
	}
	return cache.get(id);
}

/**
 * Where readers download the examples from. They are published to the assets
 * bucket by `scripts/publish-guide-examples.mjs` rather than kept in the
 * repository or the site bundle; the bytes are deterministic, so the copy a
 * reader downloads is the copy the browser suite replays.
 */
export const GUIDE_EXAMPLE_BASE_URL = 'https://assets.soundscaper.org/guides/examples';

export function exampleUrl(id) {
	const fixture = GUIDE_FIXTURES[id];
	if (!fixture) throw new RangeError(`Unknown guide fixture ${String(id)}.`);
	return `${GUIDE_EXAMPLE_BASE_URL}/${fixture.file}`;
}

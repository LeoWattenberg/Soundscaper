/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The example recordings the guides import.
 *
 * Each entry describes a short synthetic WAV file well enough for a reader to
 * know what the guide is working on and for the browser suite to synthesise
 * the same file on demand (`tests/browser/helpers/guide-fixtures.js`). Keeping
 * the recipe here, next to the name the prose uses, means a guide cannot
 * promise a noisy lead-in that the replayed file does not have.
 */

export const GUIDE_FIXTURES = Object.freeze({
	'noisy-take': Object.freeze({
		file: 'guide-noisy-take.wav',
		seconds: 3,
		channels: 2,
		recipe: 'noise-then-tone',
		description: 'a short take whose first half second is room noise before the voice starts',
	}),
	'quiet-take': Object.freeze({
		file: 'guide-quiet-take.wav',
		seconds: 2,
		channels: 1,
		recipe: 'quiet-tone',
		description: 'a take recorded far too quietly',
	}),
	'music-loop': Object.freeze({
		file: 'guide-music-loop.wav',
		seconds: 2,
		channels: 2,
		recipe: 'tone',
		description: 'a two-second stereo loop',
	}),
	'second-loop': Object.freeze({
		file: 'guide-second-loop.wav',
		seconds: 2,
		channels: 2,
		recipe: 'tone-high',
		description: 'a second two-second loop to layer on top',
	}),
	'gapped-take': Object.freeze({
		file: 'guide-gapped-take.wav',
		seconds: 4,
		channels: 1,
		recipe: 'tone-with-gaps',
		description: 'a four-second take with long silent pauses between phrases',
	}),
	'clicky-take': Object.freeze({
		file: 'guide-clicky-take.wav',
		seconds: 2,
		channels: 1,
		recipe: 'tone-with-clicks',
		description: 'a take with a few sharp clicks in it',
	}),
});

export function guideFixtureFile(id) {
	const fixture = GUIDE_FIXTURES[id];
	if (!fixture) throw new RangeError(`Unknown guide fixture ${String(id)}.`);
	return fixture.file;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { findClipSilenceRegions } from '../src/common/editor/clip-silence-regions.ts';

const CLIP = {
	timelineStartFrame: 100,
	durationFrames: 1_000,
	sourceStartFrame: 0,
	sourceDurationFrames: 1_000,
};

/** One mono second at 1 kHz, so ten frames is the shortest detachable silence. */
function buffer(silences: readonly (readonly [number, number])[]) {
	const data = new Float32Array(1_000).fill(0.5);
	for (const [start, end] of silences) data.fill(0, start, end);
	return { sampleRate: 1_000, numberOfChannels: 1, getChannelData: () => data };
}

test('every silent run inside the clip becomes a timeline region', () => {
	const regions = findClipSilenceRegions(CLIP, buffer([[200, 300], [600, 700]]));
	assert.deepEqual(regions.map((region) => [...region]), [[300, 400], [700, 800]]);
});

test('bounds restrict the scan to the part of the clip a label covers', () => {
	const scanned = buffer([[200, 300], [600, 700]]);
	assert.deepEqual(
		findClipSilenceRegions(CLIP, scanned, { startFrame: 100, endFrame: 500 }).map((region) => [...region]),
		[[300, 400]],
	);
	assert.deepEqual(
		findClipSilenceRegions(CLIP, scanned, { startFrame: 500, endFrame: 1_100 }).map((region) => [...region]),
		[[700, 800]],
	);
	assert.deepEqual(findClipSilenceRegions(CLIP, scanned, { startFrame: 0, endFrame: 100 }), []);
});

test('runs shorter than ten milliseconds and runs touching a clip edge are ignored', () => {
	assert.deepEqual(findClipSilenceRegions(CLIP, buffer([[200, 205]])), []);
	assert.deepEqual(findClipSilenceRegions(CLIP, buffer([[0, 100]])), []);
	assert.deepEqual(findClipSilenceRegions(CLIP, buffer([[900, 1_000]])), []);
});

test('a reversed clip reads its source backwards', () => {
	const regions = findClipSilenceRegions({ ...CLIP, reversed: true }, buffer([[200, 300]]));
	assert.deepEqual(regions.map((region) => [...region]), [[800, 900]]);
});

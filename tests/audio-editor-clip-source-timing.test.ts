/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipSourceDisplayRange, clipSourceFrameToDisplay, clipDisplayFrameToSource, clipSourcePreviewWarpMap } from '../src/common/editor/clip-source-timing.ts';

const project = { sampleRate: 48_000, tempoMap: { mode: 'musical' as const, events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } };
const source = { sampleRate: 24_000, frameCount: 240_000 };
const clip = { kind: 'audio', anchor: 'sample', timelineStartFrame: 96_000, sourceStartFrame: 24_000, sourceDurationFrames: 48_000, durationFrames: 192_000, warpMap: null };

test('the source timeline retains full media around the retimed active span', () => {
	assert.deepEqual(clipSourceDisplayRange(clip, source, project.sampleRate), { startFrame: 48_000, endFrame: 240_000, totalFrames: 576_000 });
	for (const [media, display] of [[0, 0], [12_000, 24_000], [24_000, 48_000], [48_000, 144_000], [72_000, 240_000], [240_000, 576_000]]) {
		assert.equal(clipSourceFrameToDisplay(project, clip, source, media!), display);
		assert.equal(clipDisplayFrameToSource(project, clip, source, display!), media);
	}
});

test('source and display mappings follow fixed sample markers in both directions', () => {
	const warped = { ...clip, warpMap: { feature: 'audio-warp', points: [
		{ outer: 0, source: 24_000, mode: 'forward' },
		{ outer: 144_000, source: 48_000, mode: 'forward' },
		{ outer: 192_000, source: 72_000, mode: 'forward' },
	] } };
	assert.equal(clipSourceFrameToDisplay(project, warped, source, 48_000), 192_000);
	assert.equal(clipDisplayFrameToSource(project, warped, source, 192_000), 48_000);
	assert.equal(clipDisplayFrameToSource(project, warped, source, 216_000), 60_000);
});

test('musical source markers map into project frames and preview sample authority', () => {
	const musical = { ...clip, anchor: 'musical', musicalExtent: 'beat', musicalStartBeat: { num: 4, den: 1 }, musicalDurationBeats: { num: 8, den: 1 }, warpMap: { feature: 'audio-warp', points: [
		{ outer: 0, source: 24_000, mode: 'forward' },
		{ outer: 6, source: 48_000, mode: 'forward' },
		{ outer: 8, source: 72_000, mode: 'forward' },
	] } };
	assert.equal(clipSourceFrameToDisplay(project, musical, source, 48_000), 192_000);
	assert.equal(clipDisplayFrameToSource(project, musical, source, 192_000), 48_000);
	assert.deepEqual(clipSourcePreviewWarpMap(project, musical, source)?.points[1]?.outer, { num: 144_000, den: 1 });
});

test('reverse clip mapping changes only its active source span', () => {
	const reversed = { ...clip, reversed: true };
	assert.equal(clipSourceFrameToDisplay(project, reversed, source, 36_000), 192_000);
	assert.equal(clipDisplayFrameToSource(project, reversed, source, 192_000), 36_000);
	assert.equal(clipDisplayFrameToSource(project, reversed, source, 24_000), 12_000);
});

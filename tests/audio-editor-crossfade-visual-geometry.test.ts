/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { automaticClipCrossfadeRanges } from '../src/common/editor/audio-clip-overlap.ts';
import { clipCrossfadeCurvePath } from '../src/common/editor/ui/timeline/crossfade-visual-geometry.ts';

const clips = [
	{ id: 'out', timelineStartFrame: 0, durationFrames: 1_000, fadeInFrames: 0, fadeOutFrames: 0 },
	{ id: 'in', timelineStartFrame: 500, durationFrames: 1_000, fadeInFrames: 0, fadeOutFrames: 0 },
];
const rangesFor = (items: typeof clips) => automaticClipCrossfadeRanges(items, {
	id: clip => clip.id,
	startFrame: clip => clip.timelineStartFrame,
	durationFrames: clip => clip.durationFrames,
});

test('crossfade curves meet at the actual linear half-gain point', () => {
	const ranges = rangesFor(clips);
	const outgoing = clipCrossfadeCurvePath(clips[0]!, ranges.get('out')!, 500, 1_000);
	const incoming = clipCrossfadeCurvePath(clips[1]!, ranges.get('in')!, 500, 1_000);
	assert.match(outgoing, /50\.00,50\.00/u);
	assert.match(incoming, /50\.00,50\.00/u);
	assert.match(outgoing, /^M 0\.00,0\.00/u);
	assert.match(incoming, /^M 0\.00,100\.00/u);
});

test('authored fades lower the displayed crossfade curves as they do the audio', () => {
	const authored = [
		{ ...clips[0]!, fadeOutFrames: 1_000 },
		{ ...clips[1]!, fadeInFrames: 1_000 },
	];
	const ranges = rangesFor(authored);
	assert.match(clipCrossfadeCurvePath(authored[0]!, ranges.get('out')!, 500, 1_000), /50\.00,75\.00/u);
	assert.match(clipCrossfadeCurvePath(authored[1]!, ranges.get('in')!, 500, 1_000), /50\.00,75\.00/u);
});

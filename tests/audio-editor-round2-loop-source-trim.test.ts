/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { clipSourceTrim } from '../src/common/editor/ui/inspector/clip-source-view.ts';

for (const reversed of [false, true]) test(`source trim retains a loop period's playback rate (${reversed ? 'reversed' : 'forward'})`, () => {
	const base = { id: 'clip', sourceId: 'source', kind: 'audio', timelineStartFrame: 48_000,
		durationFrames: 38_400, sourceStartFrame: 0, sourceDurationFrames: 38_400, reversed };
	const clip = { ...base, ...clipLoopUpdateFields(base, { periodFrames: 38_400, durationFrames: 76_800 }) };
	const source = { frameCount: 38_400, sampleRate: 48_000 };
	assert.deepEqual(clipSourceTrim(clip, source, 48_000, 'start', 4800),
		{ sourceStartFrame: 4800, sourceDurationFrames: 33_600, durationFrames: 33_600 });
	assert.deepEqual(clipSourceTrim(clip, source, 48_000, 'end', 33_600),
		{ sourceStartFrame: 0, sourceDurationFrames: 33_600, durationFrames: 33_600 });
});

test('source trim keeps the native ratio for a stretched split loop at another source rate', () => {
	const base = { id: 'clip', sourceId: 'source', kind: 'audio', timelineStartFrame: 0,
		durationFrames: 96_000, sourceStartFrame: 12_000, sourceDurationFrames: 24_000 };
	const clip = { ...base, ...clipLoopUpdateFields(base,
		{ periodFrames: 96_000, offsetFrames: 24_000, durationFrames: 240_000 }) };
	assert.deepEqual(clipSourceTrim(clip, { frameCount: 48_000, sampleRate: 24_000 }, 48_000, 'start', 18_000),
		{ sourceStartFrame: 18_000, sourceDurationFrames: 18_000, durationFrames: 72_000 });
});

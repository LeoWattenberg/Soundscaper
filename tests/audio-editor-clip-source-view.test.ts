/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipSourceSegments, clipSourceTrim, sourceRulerTicks } from '../src/common/editor/ui/inspector/clip-source-view.ts';

const source = { id: 'source', sampleRate: 24_000, frameCount: 240_000 };
const clip = { id: 'clip', sourceId: 'source', timelineStartFrame: 960_000, sourceStartFrame: 48_000, sourceDurationFrames: 96_000, durationFrames: 384_000, reversed: false };

test('source view includes both unused sides and projects the active stretched clip at its source in', () => {
	const segments = clipSourceSegments(clip, source, 48_000);
	assert.deepEqual(segments.map(s => [s.timelineStartFrame, s.durationFrames, s.sourceStartFrame, s.sourceDurationFrames]), [
		[0, 96_000, 0, 48_000], [96_000, 384_000, 48_000, 96_000], [480_000, 192_000, 144_000, 96_000],
	]);
	assert.equal(segments[1]?.active, true);
	assert.equal(segments[0]?.active, false);
});

test('source trims retain the project anchor and account for source and project rates plus speed', () => {
	assert.deepEqual(clipSourceTrim(clip, source, 48_000, 'start', 72_000), { sourceStartFrame: 72_000, sourceDurationFrames: 72_000, durationFrames: 288_000 });
	assert.deepEqual(clipSourceTrim(clip, source, 48_000, 'end', 192_000), { sourceStartFrame: 48_000, sourceDurationFrames: 144_000, durationFrames: 576_000 });
	assert.equal(clipSourceTrim(clip, source, 48_000, 'start', 999_999).sourceDurationFrames, 1);
});

test('ruler time origins place local zero and project time at the clip start, including unused source', () => {
	const local = sourceRulerTicks({ startFrame: 0, endFrame: 672_000, width: 700, sampleRate: 48_000, originFrame: -96_000 });
	assert.ok(local.some(tick => tick.frame === 96_000 && tick.label === '0:00'));
	assert.equal(local[0]?.label, '−0:02');
	const global = sourceRulerTicks({ startFrame: 0, endFrame: 672_000, width: 700, sampleRate: 48_000, originFrame: 864_000 });
	assert.ok(global.some(tick => tick.frame === 96_000 && tick.label === '0:20'));
});

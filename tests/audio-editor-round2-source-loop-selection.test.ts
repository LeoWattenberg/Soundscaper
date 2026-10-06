/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { clipSourceSelection } from '../src/common/editor/ui/inspector/clip-source-selection.ts';
import type { ClipSourceTimingClip, ClipSourceTimingProject } from '../src/common/editor/clip-source-timing.ts';

const base = { kind: 'audio', timelineStartFrame: 0, durationFrames: 96, sourceStartFrame: 0,
	sourceDurationFrames: 96, reversed: false } as const;
const clip: ClipSourceTimingClip = { ...base, ...clipLoopUpdateFields(base, { periodFrames: 96, durationFrames: 192 }) };
const project = { sampleRate: 48_000 } as ClipSourceTimingProject;
const source = { sampleRate: 48_000, frameCount: 96 };

test('source-effect selection addresses the displayed repeat phase in either direction', () => {
	assert.deepEqual(clipSourceSelection(project, clip, source, { startFrame: 128, endFrame: 144 }),
		{ display: { startFrame: 128, endFrame: 144 }, source: { startFrame: 32, endFrame: 48 } });
	assert.deepEqual(clipSourceSelection(project, { ...clip, reversed: true }, source,
		{ startFrame: 128, endFrame: 144 }).source, { startFrame: 48, endFrame: 64 });
});

test('a disjoint repeated seam expands the visible highlight to match the contiguous effect range', () => {
	assert.deepEqual(clipSourceSelection(project, clip, source, { startFrame: 80, endFrame: 112 }),
		{ display: { startFrame: 0, endFrame: 192 }, source: { startFrame: 0, endFrame: 96 } });
});

test('unused source boundaries remain native while a split loop preserves its period and offset', () => {
	const trimmed = { ...clip,
		...clipLoopUpdateFields({ ...base, sourceStartFrame: 24, sourceDurationFrames: 48 },
			{ durationFrames: 192, periodFrames: 96, offsetFrames: 24 }) };
	const entireSource = { sampleRate: 48_000, frameCount: 144 };
	assert.deepEqual(clipSourceSelection(project, trimmed, entireSource,
		{ startFrame: 24, endFrame: 48 }).source, { startFrame: 36, endFrame: 48 });
	assert.deepEqual(clipSourceSelection(project, trimmed, entireSource,
		{ startFrame: 0, endFrame: 12 }).source, { startFrame: 0, endFrame: 12 });
});

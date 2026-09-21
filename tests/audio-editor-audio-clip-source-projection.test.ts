/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { projectUnwarpedClipSourceRange } from '../src/common/editor/audio-clip-source-projection.ts';

const stretchedClip = {
	durationFrames: 100,
	sourceStartFrame: 30,
	sourceDurationFrames: 200,
	reversed: false,
};

test('unwarped clip source projection owns stretch, source offset and fractional boundaries', () => {
	assert.deepEqual(projectUnwarpedClipSourceRange(stretchedClip, 10.25, 20.75), {
		startFrame: 50.5,
		endFrame: 71.5,
	});
});

test('unwarped clip source projection returns an ordered range for reversed clips', () => {
	assert.deepEqual(projectUnwarpedClipSourceRange({
		...stretchedClip,
		reversed: true,
	}, 10.25, 20.75), {
		startFrame: 188.5,
		endFrame: 209.5,
	});
});

test('unwarped clip source projection orders caller-supplied boundaries without rounding them', () => {
	assert.deepEqual(projectUnwarpedClipSourceRange(stretchedClip, 20.75, 10.25), {
		startFrame: 50.5,
		endFrame: 71.5,
	});
	assert.deepEqual(projectUnwarpedClipSourceRange(stretchedClip, 12.5, 12.5), {
		startFrame: 55,
		endFrame: 55,
	});
});

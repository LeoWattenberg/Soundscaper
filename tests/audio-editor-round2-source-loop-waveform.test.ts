/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipLoopUpdateFields, readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { projectUnwarpedClipSourceRange } from '../src/common/editor/audio-clip-source-projection.ts';
import { clipSourceSegments } from '../src/common/editor/ui/inspector/clip-source-view.ts';

test('unused source waveform spans are native while the active source span retains its loop', () => {
	const base = { id: 'clip', sourceId: 'source', kind: 'audio', timelineStartFrame: 0,
		durationFrames: 48, sourceStartFrame: 24, sourceDurationFrames: 48, reversed: false,
		opaqueExtensions: { artist: 'Piano' } } as const;
	const clip = { ...base, ...clipLoopUpdateFields(base, { periodFrames: 48, durationFrames: 96 }) };
	const segments = clipSourceSegments(clip, { sampleRate: 48_000, frameCount: 144 }, 48_000);
	assert.equal(segments.length, 3);
	const before = segments[0]!;
	const active = segments[1]!;
	const after = segments[2]!;
	assert.equal(readClipLoop(before), null);
	assert.equal(readClipLoop(after), null);
	assert.deepEqual(readClipLoop(active), { periodFrames: 48, offsetFrames: 0 });
	assert.deepEqual(projectUnwarpedClipSourceRange(before, 0, before.durationFrames),
		{ startFrame: 0, endFrame: 24 });
	assert.deepEqual(projectUnwarpedClipSourceRange(after, 0, after.durationFrames),
		{ startFrame: 72, endFrame: 144 });
	assert.equal(before.opaqueExtensions.artist, 'Piano');
	assert.equal(after.opaqueExtensions.artist, 'Piano');
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipFadeLengthChange, clipFadePointerEdit, nearestClipEdge } from '../src/common/editor/ui/timeline/clip-fade-edit.ts';
import { shapesForNewClipFades } from '../src/common/editor/audio-clip-transition-gain.ts';
import { crossfadeDepthShapesAtPointer, crossfadeDepthDragResult, crossfadeIntersection } from '../src/common/editor/ui/timeline/crossfade-visual-geometry.ts';

const clip = { id: 'one', kind: 'audio', timelineStartFrame: 48_000, durationFrames: 96_000, fadeInFrames: 24_000, fadeOutFrames: 48_000 };

test('new fades use the S-curve while existing unshaped fades retain their legacy law', () => {
	assert.deepEqual(shapesForNewClipFades({ fadeInFrames: 0 }, { fadeInFrames: 100 }), { fadeInShape: 2 });
	assert.deepEqual(shapesForNewClipFades({ fadeInFrames: 100 }, { fadeInFrames: 200 }), {});
});

test('moving a fade into its opposite pushes the opposite without crossing or losing frame precision', () => {
	assert.deepEqual(clipFadeLengthChange(clip, 'in', 72_001), { fadeInFrames: 72_001, fadeOutFrames: 23_999 });
	assert.deepEqual(clipFadeLengthChange(clip, 'out', 24_000), { fadeOutFrames: 24_000 });
	assert.deepEqual(clipFadeLengthChange(clip, 'in', 479, 48_000), { fadeInFrames: 0 });
});

test('fade dragging snaps to the playhead and Shift inverts time-grid snapping', () => {
	const request = { clip, edge: 'in' as const, rawDurationFrames: 47_000, sampleRate: 48_000, pixelsPerSecond: 100,
		playheadFrame: 96_000, gridEnabled: false, gridFrame: 90_000, shiftKey: false, boundaryFrames: [] };
	assert.equal(clipFadePointerEdit(request).fadeInFrames, 48_000);
	assert.equal(clipFadePointerEdit({ ...request, playheadFrame: 500_000, shiftKey: true }).fadeInFrames, 42_000);
	assert.equal(clipFadePointerEdit({ ...request, playheadFrame: 500_000, gridEnabled: true, shiftKey: true }).fadeInFrames, 47_000);
});

test('fade boundaries snap across tracks but never to edges outside the current clip', () => {
	const change = clipFadePointerEdit({ clip, edge: 'out', rawDurationFrames: 23_100, sampleRate: 48_000, pixelsPerSecond: 100,
		playheadFrame: 0, gridEnabled: false, gridFrame: 0, shiftKey: false, boundaryFrames: [120_000, 500_000] });
	assert.equal(change.fadeOutFrames, 24_000);
	assert.equal(nearestClipEdge(clip, 72_000), 'left');
	assert.equal(nearestClipEdge(clip, 120_000), 'right');
});

test('crossfade depth ignores sideways travel and clamps both curves without moving their crossing', () => {
	const initial = crossfadeIntersection(3, 0.5);
	const input = { initialPosition: initial.position, initialGain: initial.gain, startX: 0, startY: 0,
		clientX: 100, clientY: -500, width: 100, height: 100, initialOutShape: 3, initialInShape: 0.5 };
	const shapes = crossfadeDepthShapesAtPointer(input);
	const crossing = crossfadeIntersection(shapes.outShape, shapes.inShape);
	assert.ok(Math.abs(crossing.position - initial.position) < 1e-8);
	assert.ok(shapes.outShape <= 6 && shapes.outShape >= 0.15 && shapes.inShape >= 0.15 && shapes.inShape <= 6);
	assert.equal(crossfadeDepthDragResult({ ...input, clientY: 0 }), null);
});

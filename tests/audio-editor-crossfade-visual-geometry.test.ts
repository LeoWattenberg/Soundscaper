/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { automaticClipCrossfadeRanges } from '../src/common/editor/audio-clip-overlap.ts';
import {
	clipCrossfadeCurvePath,
	crossfadeIntersection,
	crossfadeShapeDragResult,
	crossfadeShapesAtKey,
	crossfadeShapesAtPointer,
} from '../src/common/editor/ui/timeline/crossfade-visual-geometry.ts';

const clips = [
	{ id: 'out', timelineStartFrame: 0, durationFrames: 1_000, fadeInFrames: 0, fadeOutFrames: 0 },
	{ id: 'in', timelineStartFrame: 500, durationFrames: 1_000, fadeInFrames: 0, fadeOutFrames: 0 },
];
const rangesFor = (items: typeof clips) => automaticClipCrossfadeRanges(items, {
	id: clip => clip.id,
	startFrame: clip => clip.timelineStartFrame,
	durationFrames: clip => clip.durationFrames,
});

test('crossfade curves use the design-system equal-power interpolation', () => {
	const ranges = rangesFor(clips);
	const outgoing = clipCrossfadeCurvePath(clips[0]!, ranges.get('out')!, 500, 1_000);
	const incoming = clipCrossfadeCurvePath(clips[1]!, ranges.get('in')!, 500, 1_000);
	assert.match(outgoing, /50\.00,29\.29/u);
	assert.match(incoming, /50\.00,29\.29/u);
	assert.match(outgoing, /^M 0\.00,0\.00/u);
	assert.match(incoming, /^M 0\.00,100\.00/u);
});

test('crossfades consume authored edge extents while retaining their shape exponents', () => {
	const authored = [
		{ ...clips[0]!, fadeOutFrames: 1_000 },
		{ ...clips[1]!, fadeInFrames: 1_000 },
	];
	const ranges = rangesFor(authored);
	assert.match(clipCrossfadeCurvePath(authored[0]!, ranges.get('out')!, 500, 1_000), /50\.00,29\.29/u);
	assert.match(clipCrossfadeCurvePath(authored[1]!, ranges.get('in')!, 500, 1_000), /50\.00,29\.29/u);
	const shaped = authored.map(clip => ({ ...clip, fadeInShape: 2, fadeOutShape: 2 }));
	assert.match(clipCrossfadeCurvePath(shaped[0]!, ranges.get('out')!, 500, 1_000), /50\.00,50\.00/u);
});

test('the design-system crossfade handle follows the curve intersection and solves both shapes', () => {
	assert.deepEqual(crossfadeIntersection(1, 1), { position: 0.5, gain: Math.SQRT1_2 });
	const shapes = crossfadeShapesAtPointer({
		initialPosition: 0.5,
		initialGain: Math.SQRT1_2,
		startX: 100,
		startY: 100,
		clientX: 125,
		clientY: 105,
		width: 100,
		height: 100,
	});
	assert.ok(shapes.outShape < shapes.inShape, 'moving right solves complementary exponents');
	assert.ok(shapes.outShape >= 0.15 && shapes.outShape <= 6);
	assert.ok(shapes.inShape >= 0.15 && shapes.inShape <= 6);
	const intersection = crossfadeIntersection(shapes.outShape, shapes.inShape);
	assert.ok(Math.abs(intersection.position - 0.75) < 1e-10);
	assert.ok(Math.abs(intersection.gain - (Math.SQRT1_2 - 0.05)) < 1e-10);
});

test('a click or subpixel tremor cannot rewrite unequal authored crossfade shapes', () => {
	const initialOutShape = 0.37;
	const initialInShape = 3.41;
	const intersection = crossfadeIntersection(initialOutShape, initialInShape);
	const gesture = {
		initialPosition: intersection.position,
		initialGain: intersection.gain,
		initialOutShape,
		initialInShape,
		startX: 100,
		startY: 100,
		width: 240,
		height: 120,
	};
	assert.equal(crossfadeShapeDragResult({ ...gesture, clientX: 100, clientY: 100 }), null);
	assert.equal(crossfadeShapeDragResult({ ...gesture, clientX: 100.5, clientY: 100.5 }), null);
	assert.ok(crossfadeShapeDragResult({ ...gesture, clientX: 102, clientY: 100 }));
});

test('keyboard crossfade edits move the advertised horizontal intersection through the same solver', () => {
	const input = {
		initialPosition: 0.5,
		initialGain: Math.SQRT1_2,
		width: 100,
		height: 100,
	};
	const right = crossfadeShapesAtKey({ ...input, key: 'ArrowRight', shiftKey: false });
	const fineRight = crossfadeShapesAtKey({ ...input, key: 'ArrowRight', shiftKey: true });
	assert.ok(right && fineRight);
	assert.ok(crossfadeIntersection(right.outShape, right.inShape).position > 0.5);
	assert.ok(crossfadeIntersection(fineRight.outShape, fineRight.inShape).position > 0.5);
	assert.ok(crossfadeIntersection(fineRight.outShape, fineRight.inShape).position
		< crossfadeIntersection(right.outShape, right.inShape).position);
	assert.deepEqual(crossfadeShapesAtKey({ ...input, key: 'Home', shiftKey: false }), {
		outShape: 6, inShape: 0.15,
	});
	assert.deepEqual(crossfadeShapesAtKey({ ...input, key: 'End', shiftKey: false }), {
		outShape: 0.15, inShape: 6,
	});
	assert.equal(crossfadeShapesAtKey({ ...input, key: 'Enter', shiftKey: false }), null);
});

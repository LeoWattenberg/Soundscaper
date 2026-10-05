/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fadeDurationAtPointer, fadeDurationAtKey, fadeShapeAtPointer, fadeShapeAtKey, clipFadeGain, fadeOverlayGeometry, placeFadeShapeHandles } from '../src/common/editor/ui/timeline/clip-fade-geometry.ts';

test('fade drags use timeline frames, preserve the grab offset, and clamp independently', () => {
	assert.equal(fadeDurationAtPointer('in', 2400, 100, 130, 100, 48000, 48000), 16800);
	assert.equal(fadeDurationAtPointer('out', 2400, 100, 70, 100, 48000, 48000), 16800);
	assert.equal(fadeDurationAtPointer('in', 2400, 100, -100, 100, 48000, 48000), 0);
	assert.equal(fadeDurationAtPointer('out', 2400, 100, -1000, 100, 48000, 48000), 48000);
	assert.equal(fadeDurationAtPointer('in', 0, 0, 1, 7, 44100, 44100), 6300);
});

test('keyboard editing offers coarse/fine steps and exact endpoints', () => {
	assert.equal(fadeDurationAtKey('ArrowRight', false, 0, 48000, 48000), 480);
	assert.equal(fadeDurationAtKey('ArrowLeft', true, 9600, 48000, 48000), 4800);
	assert.equal(fadeDurationAtKey('Home', false, 9600, 48000, 48000), 0);
	assert.equal(fadeDurationAtKey('End', false, 0, 48000, 48000), 48000);
	assert.equal(fadeDurationAtKey('Enter', false, 0, 48000, 48000), null);
});

test('the fade envelope follows the shaped equal-power curve', () => {
	assert.ok(Math.abs(clipFadeGain(25, 100, 50, 50, 1, 1) - Math.SQRT1_2) < 1e-10);
	assert.ok(Math.abs(clipFadeGain(50, 100, 100, 100, 1, 1) - 0.5) < 1e-10);
	assert.equal(clipFadeGain(25, 100, 50, 50), 0.5, 'saved fades without shape remain linear');
	assert.equal(clipFadeGain(0, 100, 0, 0), 1);
	assert.equal(clipFadeGain(100, 100, 0, 50), 0);
});

test('shape drags change only the exponent and clamp to the upstream range', () => {
	const up = fadeShapeAtPointer(1, 100, 90, 100);
	const down = fadeShapeAtPointer(1, 100, 110, 100);
	assert.ok(up < 1);
	assert.ok(down > 1);
	assert.equal(fadeShapeAtPointer(1, 100, -100, 100), 0.15);
	assert.equal(fadeShapeAtPointer(1, 100, 1000, 100), 6);
	assert.equal(fadeShapeAtPointer(1, 100, 100, 100), 1);
	assert.equal(fadeShapeAtKey('Home', false, 1), 0.15);
	assert.equal(fadeShapeAtKey('End', false, 1), 6);
	assert.equal(fadeShapeAtKey('ArrowDown', false, 1), 1.1);
	assert.equal(fadeShapeAtKey('ArrowUp', true, 1), 0.99);
	assert.equal(fadeShapeAtKey('Enter', false, 1), null);
	const thirdPointBase = Math.sin(Math.PI / 6);
	const thirdPointGain = thirdPointBase ** 2;
	assert.ok(Math.abs(fadeShapeAtPointer(2, 100, 110, 100, thirdPointBase)
		- Math.log(thirdPointGain - 0.1) / Math.log(thirdPointBase)) < 1e-10);
	assert.ok(Math.abs(fadeShapeAtPointer(2, 100, 110, 100, thirdPointBase, 0.5)
		- Math.log(0.4) / Math.log(thirdPointBase)) < 1e-10,
	'legacy handles start their drag at the actual linear gain');
});

test('shape dots stay on each fade curve and remain separate when fade lengths overlap', () => {
	const clip = {
		timelineStartFrame: 0, durationFrames: 100, fadeInFrames: 100, fadeOutFrames: 100,
		fadeInShape: 1, fadeOutShape: 1,
	};
	const geometry = fadeOverlayGeometry(clip, 0, 100, 48, 100);
	const positions = placeFadeShapeHandles(geometry, 48, clip);
	assert.equal(positions.length, 2);
	const incoming = positions.find(position => position.edge === 'in')!;
	const outgoing = positions.find(position => position.edge === 'out')!;
	assert.ok(outgoing.left - incoming.left >= 16, 'both 16px targets remain reachable');
	for (const position of positions) {
		const x = position.left + 8;
		const progress = position.edge === 'in' ? x / 48 : (48 - x) / 48;
		assert.ok(Math.abs(position.baseGain - Math.sin(progress * Math.PI / 2)) < 1e-10);
		assert.ok(Math.abs(position.topPercent - (1 - position.baseGain) * 100) < 1e-10);
	}
});

test('shape dots align with the rounded rendered clip width', () => {
	const clip = { timelineStartFrame: 0, durationFrames: 100, fadeInFrames: 100, fadeOutFrames: 0, fadeInShape: 1 };
	const geometry = fadeOverlayGeometry(clip, 0, 100, 20, 100);
	const [position] = placeFadeShapeHandles(geometry, Math.round(geometry.width), clip);
	assert.ok(position);
	assert.equal(position.edge, 'in');
	assert.equal(position.left + 8, 10);
	assert.ok(Math.abs(position.topPercent - (1 - Math.SQRT1_2) * 100) < 1e-10);
});

test('shape dots hide below eight rendered pixels and appear at the threshold', () => {
	const clip = { timelineStartFrame: 0, durationFrames: 1000, fadeInFrames: 100, fadeOutFrames: 0 };
	const narrow = fadeOverlayGeometry(clip, 0, 1000, 79, 1000);
	assert.equal(placeFadeShapeHandles(narrow, 79, clip).length, 0);
	const threshold = fadeOverlayGeometry(clip, 0, 1000, 80, 1000);
	const [position] = placeFadeShapeHandles(threshold, 80, clip);
	assert.ok(position);
	assert.equal(position.left + 8, 4);
	assert.ok(Math.abs(position.baseGain - Math.SQRT1_2) < 1e-10);

	const sixPixelClip = { timelineStartFrame: 0, durationFrames: 600, fadeInFrames: 600, fadeOutFrames: 0 };
	const sixPixelGeometry = fadeOverlayGeometry(sixPixelClip, 0, 600, 1, 100);
	assert.equal(sixPixelGeometry.width, 6);
	assert.equal(placeFadeShapeHandles(sixPixelGeometry, Math.round(sixPixelGeometry.width), sixPixelClip).length, 0,
		'an entire fade on a six-pixel rendered clip stays hidden');
	const eightPixelClip = { timelineStartFrame: 0, durationFrames: 800, fadeInFrames: 800, fadeOutFrames: 0 };
	const eightPixelGeometry = fadeOverlayGeometry(eightPixelClip, 0, 800, 1, 100);
	assert.equal(placeFadeShapeHandles(eightPixelGeometry, Math.round(eightPixelGeometry.width), eightPixelClip).length, 1,
		'an entire fade on an exactly eight-pixel rendered clip remains editable');
});

test('viewport cropping does not manufacture handles at visible clip edges', () => {
	const geometry = fadeOverlayGeometry({ timelineStartFrame: 0, durationFrames: 48000, fadeInFrames: 4800, fadeOutFrames: 9600 }, 12000, 36000, 100, 48000);
	assert.equal(geometry.left, 0);
	assert.equal(geometry.width, 50);
	assert.equal(geometry.fadeInX, null);
	assert.equal(geometry.fadeOutX, null);
	const full = fadeOverlayGeometry({ timelineStartFrame: 48000, durationFrames: 48000, fadeInFrames: 4800, fadeOutFrames: 9600 }, 0, 144000, 100, 48000);
	assert.equal(full.left, 100);
	assert.equal(full.fadeInX, 10);
	assert.equal(full.fadeOutX, 80);
	assert.equal(full.curves.length, 2);
	assert.ok(full.curves.every(curve => curve.path.startsWith('M ')));
});

test('curves occupy only their fade regions and the shape changes their midpoint', () => {
	const legacy = fadeOverlayGeometry({
		timelineStartFrame: 0, durationFrames: 100, fadeInFrames: 50, fadeOutFrames: 25,
	}, 0, 100, 100, 100);
	const equalPower = fadeOverlayGeometry({
		timelineStartFrame: 0, durationFrames: 100, fadeInFrames: 50, fadeOutFrames: 25,
		fadeInShape: 1, fadeOutShape: 1,
	}, 0, 100, 100, 100);
	const shaped = fadeOverlayGeometry({
		timelineStartFrame: 0, durationFrames: 100, fadeInFrames: 50, fadeOutFrames: 25,
		fadeInShape: 2,
	}, 0, 100, 100, 100);
	assert.equal(legacy.curves[0]?.edge, 'in');
	assert.equal(legacy.curves[1]?.edge, 'out');
	assert.equal(legacy.curves[0]?.midpointX, 25);
	assert.equal(legacy.curves[0]?.midpointGain, 0.5);
	assert.ok(Math.abs((equalPower.curves[0]?.midpointGain ?? 0) - Math.SQRT1_2) < 1e-10);
	assert.ok(Math.abs((shaped.curves[0]?.midpointGain ?? 0) - 0.5) < 1e-10);
	assert.match(legacy.curves[0]?.path ?? '', /25\.000,50\.000/u);
	assert.match(equalPower.curves[0]?.path ?? '', /25\.000,29\.289/u);
	assert.match(shaped.curves[0]?.path ?? '', /25\.000,50\.000/u);
	assert.match(legacy.curves[0]?.path ?? '', /50\.000,0\.000$/u);
});

test('legacy linear shape dots sit on their line before the first shape edit', () => {
	const clip = { timelineStartFrame: 0, durationFrames: 100, fadeInFrames: 100, fadeOutFrames: 0 };
	const geometry = fadeOverlayGeometry(clip, 0, 100, 100, 100);
	const [position] = placeFadeShapeHandles(geometry, 100, clip);
	assert.equal(position?.topPercent, 50);
	assert.equal(position?.gain, 0.5);
	assert.ok(Math.abs((position?.baseGain ?? 0) - Math.SQRT1_2) < 1e-10);
});

test('fade shading follows each shaped curve and closes above it within its fade region', () => {
	for (const shape of [undefined, 0.15, 1, 2, 6]) {
		const geometry = fadeOverlayGeometry({
			timelineStartFrame: 0, durationFrames: 100, fadeInFrames: 50, fadeOutFrames: 25,
			fadeInShape: shape, fadeOutShape: shape,
		}, 0, 100, 100, 100);
		const [incoming, outgoing] = geometry.curves;
		assert.ok(incoming && outgoing);
		assert.equal(incoming.shadePath, `${incoming.path} L 50.000,0 L 0.000,0 Z`);
		assert.equal(outgoing.shadePath, `${outgoing.path} L 100.000,0 L 75.000,0 Z`);
	}
});

test('fade shading crops to the viewport without adding endpoint guides at the crop', () => {
	const geometry = fadeOverlayGeometry({
		timelineStartFrame: 0, durationFrames: 100, fadeInFrames: 100, fadeOutFrames: 100,
	}, 25, 75, 100, 100);
	assert.equal(geometry.fadeInX, null);
	assert.equal(geometry.fadeOutX, null);
	const [incoming, outgoing] = geometry.curves;
	assert.ok(incoming && outgoing);
	assert.match(incoming.shadePath, /^M 0\.000,75\.000 /u);
	assert.match(outgoing.shadePath, /^M 0\.000,25\.000 /u);
	for (const curve of geometry.curves) {
		assert.ok(curve.shadePath.startsWith(curve.path));
		assert.match(curve.shadePath, / L 50\.000,0 L 0\.000,0 Z$/u);
	}
	assert.deepEqual(fadeOverlayGeometry({ timelineStartFrame: 0, durationFrames: 100 }, 0, 100, 100, 100).curves, []);
});

/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fadeDurationAtPointer, fadeDurationAtKey, clipFadeGain, fadeOverlayGeometry } from '../src/common/editor/ui/timeline/clip-fade-geometry.ts';

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

test('shading follows the multiplied linear fade envelope, including overlap', () => {
	assert.equal(clipFadeGain(25, 100, 50, 50), 0.5);
	assert.equal(clipFadeGain(50, 100, 100, 100), 0.25);
	assert.equal(clipFadeGain(0, 100, 0, 0), 1);
	assert.equal(clipFadeGain(100, 100, 0, 50), 0);
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
	assert.ok(full.points.length > 2);
});

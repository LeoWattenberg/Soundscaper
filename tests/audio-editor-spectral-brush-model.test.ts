/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { planSpectralBrushGesture } from '../src/common/editor/ui/timeline/spectral-brush-model.ts';

const geometry = Object.freeze({
	laneWidth: 480,
	laneHeight: 200,
	overscanStartFrame: 48_000,
	pixelsPerSecond: 120,
	sampleRate: 48_000,
	minimumFrequency: 0,
	maximumFrequency: 24_000,
	scale: 'linear' as const,
});

test('spectral brush gesture maps one pointer origin and drag radius into exact selection authority', () => {
	assert.deepEqual(planSpectralBrushGesture({
		...geometry,
		startX: 120,
		startY: 100,
		endX: 150,
		endY: 80,
	}), {
		centerFrame: 96_000,
		centerFrequency: 12_000,
		radiusFrames: 12_000,
		radiusFrequency: 2_400,
	});
});

test('spectral brush gesture clamps coordinates and gives clicks a usable minimum radius', () => {
	assert.deepEqual(planSpectralBrushGesture({
		...geometry,
		startX: -20,
		startY: 300,
		endX: -20,
		endY: 300,
	}), {
		centerFrame: 48_000,
		centerFrequency: 0,
		radiusFrames: 1_600,
		radiusFrequency: 480,
	});
});

test('spectral brush gesture rejects malformed geometry before producing a selection', () => {
	assert.throws(() => planSpectralBrushGesture({
		...geometry,
		pixelsPerSecond: 0,
		startX: 10,
		startY: 10,
		endX: 20,
		endY: 20,
	}), /pixels per second/u);
	assert.throws(() => planSpectralBrushGesture({
		...geometry,
		maximumFrequency: 0,
		startX: 10,
		startY: 10,
		endX: 20,
		endY: 20,
	}), /frequency bounds/u);
});

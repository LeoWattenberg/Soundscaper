/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	filterCurveGain,
	filterCurvePolyline,
	filterCurvePosition,
	filterCurvePointAt,
	type FilterCurveViewport,
} from '../src/common/editor/audacity-effects/filter-curve.ts';
import { createFilterCurveGesture } from '../src/common/editor/controller/effects/filter-curve-gesture.ts';

const viewport: FilterCurveViewport = {
	sampleRate: 48_000, linearFrequencyScale: false, minimumDb: -30, maximumDb: 30,
};

test('Audacity curves extend the end gains across the graph, including empty and single curves', () => {
	assert.equal(filterCurvePolyline([], viewport), '0.000000,0.500000 1.000000,0.500000');
	const points = [{ frequency: 100, gain: -20 }, { frequency: 6_000, gain: 0 }];
	const line = filterCurvePolyline(points, viewport).split(' ');
	assert.equal(line[0], '0.000000,0.833333');
	assert.equal(line.at(-1), '1.000000,0.500000');
	assert.equal(filterCurveGain([{ frequency: 100, gain: 6 }], 24_000), 6);
});

test('the graph and DSP share interpolation, including Audacity subsonic and Nyquist boundaries', () => {
	const points = [{ frequency: 0, gain: -60 }, { frequency: 100, gain: 0 }];
	const at20 = -60 + 60 * Math.log(20) / Math.log(100);
	assert.ok(Math.abs(filterCurveGain(points, 0) - at20) < 1e-10);
	assert.equal(filterCurveGain(points, 10), filterCurveGain(points, 20));
	assert.equal(filterCurveGain(points, 0, true), -60);
	assert.equal(filterCurveGain(points, 50, true), -30);
	const lowRate = { ...viewport, sampleRate: 8_000 };
	const aboveNyquist = [{ frequency: 1_000, gain: 0 }, { frequency: 16_000, gain: 24 }];
	assert.equal(filterCurvePolyline(aboveNyquist, lowRate).split(' ').at(-1), '1.000000,0.300000');
});

test('frequency and gain coordinates round trip on both scales and preserve offscreen slopes', () => {
	for (const linearFrequencyScale of [false, true]) {
		const scale = { ...viewport, linearFrequencyScale };
		for (const frequency of [20, 100, 1_000, 24_000]) {
			const point = { frequency, gain: -12 };
			const restored = filterCurvePointAt(filterCurvePosition(point, scale), scale);
			assert.ok(Math.abs(restored.frequency - frequency) < 1e-8);
			assert.ok(Math.abs(restored.gain - point.gain) < 1e-8);
		}
	}
	assert.equal(filterCurvePosition({ frequency: 0, gain: 0 }, { ...viewport, linearFrequencyScale: true }).x, 0);
	assert.equal(filterCurvePosition({ frequency: 100, gain: -80 }, viewport).y, 110 / 60);
});

test('curve gestures preview locally, commit once, cancel, and delete by dragging outside', () => {
	const points = [{ frequency: 100, gain: 0 }, { frequency: 1_000, gain: 0 }];
	const gesture = createFilterCurveGesture();
	const start = filterCurvePosition(points[0]!, viewport);
	gesture.begin(points, 0, start, viewport);
	const next = gesture.move({ x: start.x, y: 0.3 });
	assert.ok(next && Math.abs(next[0]!.gain - 12) < 1e-10);
	assert.deepEqual(points, [{ frequency: 100, gain: 0 }, { frequency: 1_000, gain: 0 }]);
	assert.deepEqual(gesture.complete(), next);
	assert.equal(gesture.complete(), null);
	gesture.begin(points, 0, start, viewport);
	gesture.move({ x: start.x, y: 0.3 });
	assert.deepEqual(gesture.cancel(), points);
	assert.equal(gesture.complete(), null);
	gesture.begin(points, 0, start, viewport);
	assert.deepEqual(gesture.move({ x: start.x, y: -0.1 }), [points[1]]);
	assert.deepEqual(gesture.complete(), [points[1]]);
});

test('adding and moving points keeps frequencies unique and restores a point dragged back inside', () => {
	const gesture = createFilterCurveGesture();
	const points = [{ frequency: 100, gain: 0 }, { frequency: 1_000, gain: 0 }];
	const at100 = filterCurvePosition(points[0]!, viewport);
	assert.equal(gesture.begin(points, null, at100, viewport).length, 2);
	assert.equal(gesture.move({ x: 1, y: 0.2 })?.length, 2);
	const moved = gesture.complete()!;
	assert.ok(moved[0]!.frequency < moved[1]!.frequency);
	gesture.begin(points, 0, at100, viewport);
	gesture.move({ x: -0.1, y: 0.5 });
	assert.equal(gesture.move(at100)?.length, 2);
	assert.deepEqual(gesture.complete(), points);
});

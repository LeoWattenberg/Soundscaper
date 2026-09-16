/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { audacityCompressionCurve } from '../src/common/editor/ui/audacity-compression-curve.ts';
import { audacityEffectDefaults } from '../src/common/editor/audacity-effects/manifest.js';

type Point = readonly [number, number];

function points(path: string): Point[] {
	return [...path.matchAll(/[ML]\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
		.map((match) => [Number(match[1]), Number(match[2])]);
}

test('Audacity compression curve uses dB axes and closes its fill at the graph floor', () => {
	const curve = audacityCompressionCurve({ thresholdDb: -12, ratio: 4, kneeWidthDb: 0, makeupGainDb: 0 });
	const line = points(curve.line);
	assert.equal(line.length, 200);
	assert.deepEqual(line[0], [0, 100]);
	assert.deepEqual(line.at(-1), [100, 25]);
	assert.ok(line.every(([x, y], index) => index === 0 || x > line[index - 1]![0] && y <= line[index - 1]![1]));
	assert.deepEqual(points(curve.area), [[0, 100], ...line, [100, 100]]);
	assert.ok(curve.area.endsWith(' Z'));
});

test('Audacity soft knee bends below the hard knee around the threshold', () => {
	const hard = points(audacityCompressionCurve({ thresholdDb: -18, ratio: 4, kneeWidthDb: 0, makeupGainDb: 0 }).line);
	const soft = points(audacityCompressionCurve({ thresholdDb: -18, ratio: 4, kneeWidthDb: 12, makeupGainDb: 0 }).line);
	assert.deepEqual(soft[0], hard[0]);
	assert.deepEqual(soft.at(-1), hard.at(-1));
	// At -18 dB, a 12 dB knee and 4:1 ratio reduce the output by 1.125 dB.
	const threshold = soft[99]!;
	assert.ok(Math.abs(threshold[0] - 50) < 0.3);
	assert.ok(Math.abs(threshold[1] - 53.125) < 0.2);
	assert.ok(threshold[1] > hard[99]![1]);
});

test('compressor makeup shifts the whole curve without flattening values above the graph', () => {
	const line = points(audacityCompressionCurve({ thresholdDb: -12, ratio: 1, kneeWidthDb: 6, makeupGainDb: 9 }).line);
	assert.deepEqual(line[0], [0, 75]);
	assert.deepEqual(line.at(-1), [100, -25]);
});

test('limiter uses infinite compression and makeup target instead of compressor makeup gain', () => {
	const line = points(audacityCompressionCurve({
		thresholdDb: -6, makeupTargetDb: -1, kneeWidthDb: 0, ratio: 2, makeupGainDb: 30,
	}, { limiter: true }).line);
	assert.ok(Math.abs(line[0]![1] - 86.1111) < 0.0001);
	assert.deepEqual(line.at(-1), [100, 2.7778]);
	assert.ok(line.slice(-20).every(([, y]) => y === 2.7778));
});

test('missing and malformed parameters produce a finite usable curve', () => {
	const defaultCurve = audacityCompressionCurve({});
	assert.deepEqual(defaultCurve, audacityCompressionCurve(audacityEffectDefaults('audacity-compressor')));
	assert.deepEqual(audacityCompressionCurve({}, { limiter: true }),
		audacityCompressionCurve(audacityEffectDefaults('audacity-limiter'), { limiter: true }));
	assert.deepEqual(audacityCompressionCurve({
		thresholdDb: Number.NaN, ratio: Number.POSITIVE_INFINITY,
		kneeWidthDb: 'invalid', makeupGainDb: undefined,
	}), defaultCurve);
	for (const parameters of [{ ratio: 0, kneeWidthDb: -2 }, { ratio: -10 }, { thresholdDb: 1e300 }]) {
		const curve = audacityCompressionCurve(parameters);
		assert.ok(!/NaN|Infinity/.test(curve.line));
		assert.equal(points(curve.line).length, 200);
	}
});

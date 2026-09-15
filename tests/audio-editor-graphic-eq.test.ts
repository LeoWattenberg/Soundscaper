/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraphicEqGesture, type GraphicEqBandBounds } from '../src/common/editor/controller/effects/graphic-eq-gesture.ts';
import { createGraphicEqCurve, GRAPHIC_EQ_FREQUENCIES } from '../src/common/editor/audacity-effects/spectral-equalization-curves.js';

const bands: readonly GraphicEqBandBounds[] = Array.from({ length: 31 }, (_, index) => ({
	left: index * 32, right: index * 32 + 16, top: 0, bottom: 100,
}));
const flat = Array<number>(31).fill(0);
const makeGesture = () => createGraphicEqGesture({ minimum: -20, maximum: 20, step: 0.5 });

// Independent single-band cosine oracle: Audacity inserts 180 envelope
// points at i / 179, then interpolates their dB values for CalcFilter.
function audacitySingleCosineBand(index: number, frequency: number): number {
	const coordinate = (hz: number) => Math.log(hz / 20) / Math.log(24_000 / 20);
	const center = coordinate(GRAPHIC_EQ_FREQUENCIES[index]!);
	const leftSpan = index ? center - coordinate(GRAPHIC_EQ_FREQUENCIES[index - 1]!) : coordinate(25);
	const rightSpan = index < 30 ? coordinate(GRAPHIC_EQ_FREQUENCIES[index + 1]!) - center : leftSpan;
	const sample = (at: number) => {
		const distance = Math.abs(at - center);
		const span = at < center ? leftSpan : rightSpan;
		return distance >= span ? 0 : 10 * (1 + Math.cos(Math.PI * distance / span)) / 2;
	};
	const at = coordinate(frequency) * 179;
	const low = Math.floor(at);
	return sample(low / 179) * (1 - (at - low)) + sample((low + 1) / 179) * (at - low);
}

test('Audacity band indices and the pointer bank agree from 20 Hz through 20 kHz', () => {
	assert.deepEqual(GRAPHIC_EQ_FREQUENCIES, [20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200,
		250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]);
	for (let index = 0; index < bands.length; index += 1) {
		const gesture = makeGesture();
		const preview = gesture.begin(flat, bands, { x: index * 32 + 8, y: 25 });
		assert.equal(preview?.[index], 10);
		assert.deepEqual(gesture.complete()?.indices, [index]);
		assert.deepEqual(flat, Array(31).fill(0));
		const gains = [...flat]; gains[index] = 10;
		const curve = createGraphicEqCurve(gains, 'cosine', 24_000);
		for (const frequency of GRAPHIC_EQ_FREQUENCIES) {
			assert.ok(Math.abs(curve(frequency) - audacitySingleCosineBand(index, frequency)) < 1e-10,
				`band ${String(index)} at ${String(frequency)} Hz`);
		}
		assert.ok(curve(GRAPHIC_EQ_FREQUENCIES[index]!) > 9);
	}
});

test('Audacity keeps dragging the pressed fader until another fader starts painting', () => {
	const gesture = makeGesture();
	gesture.begin(flat, bands, { x: 8, y: 25 });
	assert.equal(gesture.move({ x: 24, y: 30 })?.[0], 8);
	const second = gesture.move({ x: 40, y: 75 });
	assert.equal(second?.[0], 8);
	assert.equal(second?.[1], -10);
	const gap = gesture.move({ x: 56, y: 60 });
	assert.equal(gap?.[0], 8);
	assert.equal(gap?.[1], -4);
	const result = gesture.complete();
	assert.deepEqual(result?.indices, [0, 1]);
	assert.equal(gesture.complete(), null);
	assert.equal(gesture.move({ x: 72, y: 0 }), null);
});

test('a continuous sweep fills bands crossed between sparse pointer events', () => {
	const gesture = makeGesture();
	gesture.begin(flat, bands, { x: 8, y: 25 });
	gesture.move({ x: 136, y: 100 });
	assert.deepEqual(gesture.complete()?.gains.slice(0, 6), [10, 2.5, -5, -12.5, -20, 0]);
});

test('vertical drags clamp to the EQ range and cancellation restores the whole bank', () => {
	const gesture = makeGesture();
	gesture.begin(flat, bands, { x: 552, y: 49 });
	assert.equal(gesture.move({ x: 552, y: -20 })?.[17], 20);
	assert.equal(gesture.move({ x: 552, y: 120 })?.[17], -20);
	assert.deepEqual(gesture.cancel(), flat);
	assert.equal(gesture.cancel(), null);
	assert.equal(gesture.complete(), null);
	assert.deepEqual(flat, Array(31).fill(0));
});

test('pressing a gap can start painting when the pointer enters a fader', () => {
	const gesture = makeGesture();
	assert.deepEqual(gesture.begin(flat, bands, { x: 24, y: 25 }), flat);
	assert.equal(gesture.move({ x: 40, y: 38 })?.[1], 5);
	assert.deepEqual(gesture.complete()?.indices, [1]);
});

test('Audacity B-spline applies the same weights to the final Nyquist band', () => {
	const gains = [...flat]; gains[30] = 12; gains[29] = 4;
	const curve = createGraphicEqCurve(gains, 'bspline', 20_000);
	assert.equal(curve(20_000), 12 * 0.75 + 4 * 0.125);
});

test('Audacity cubic sampling reaches its appended Nyquist endpoint', () => {
	const gains = [...flat]; gains[30] = 12;
	const curve = createGraphicEqCurve(gains, 'cubic', 24_000);
	assert.ok(Math.abs(curve(24_000) - 12) < 1e-10);
});

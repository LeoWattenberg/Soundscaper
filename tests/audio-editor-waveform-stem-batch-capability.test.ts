/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { canBatchRoundCapStems } from '../src/common/editor/waveform-stem-batch-capability.ts';

// Recording fixtures test admission/ownership only. Native pixel parity and
// batching savings are proved separately by the browser renderer spec.
function fixture({ mismatched = false, unreadable = false, unavailable = false, unreleasable = false } = {}) {
	const surfaces: { width: number; height: number }[] = [];
	const settings: CanvasRenderingContext2DSettings[] = [];
	let readbacks = 0;
	let failCreation = false;
	const document = { createElement() {
		if (failCreation) throw new Error('No native surface');
		let width = 0;
		const canvas = { get width() { return width; }, set width(value: number) {
			if (unreleasable && width && value === 0) throw new Error('Native surface release unavailable');
			width = value;
		}, height: 0, getContext(_kind: string, attributes: CanvasRenderingContext2DSettings) {
			settings.push(attributes);
			if (unavailable) return null;
			return {
				beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {},
				getImageData() {
					if (unreadable) throw new Error('Readback unavailable');
					return { data: new Uint8ClampedArray([mismatched ? readbacks++ : 0, 0, 0, 0]) };
				},
			};
		} };
		surfaces.push(canvas);
		return canvas;
	} };
	const context = {
		canvas: { ownerDocument: document, width: 123, height: 45 }, globalAlpha: 1,
		globalCompositeOperation: 'source-over', shadowColor: 'rgba(0, 0, 0, 0)',
		shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none',
		getLineDash() { return [] as number[]; },
		getContextAttributes() { return { alpha: true }; },
	};
	return { context, native: context as unknown as CanvasRenderingContext2D, surfaces, settings,
		set failCreation(value: boolean) { failCreation = value; } };
}

void test('unknown native owners and unsupported compositing decline without allocating a surface', () => {
	const unknown = fixture();
	assert.equal(canBatchRoundCapStems({ ...unknown.native, canvas: {} } as CanvasRenderingContext2D), false);
	for (const properties of [
		{ globalAlpha: 0.5 }, { globalCompositeOperation: 'multiply' }, { shadowBlur: 1 },
		{ shadowOffsetX: 1 }, { shadowOffsetY: 1 }, { shadowColor: '#000' },
		{ filter: 'blur(1px)' }, { getLineDash: () => [1, 2] },
	]) assert.equal(canBatchRoundCapStems({ ...unknown.native, ...properties } as CanvasRenderingContext2D), false);
	assert.equal(unknown.surfaces.length, 0);
});

void test('one private readback proof is cached by owner and backend settings and releases its surfaces', () => {
	const value = fixture();
	assert.equal(canBatchRoundCapStems(value.native), true);
	assert.equal(value.surfaces.length, 2);
	assert.ok(value.surfaces.every(surface => surface.width === 0 && surface.height === 0));
	assert.equal(value.context.canvas.width, 123);
	assert.equal(value.context.canvas.height, 45);
	assert.equal(canBatchRoundCapStems({ ...value.native } as CanvasRenderingContext2D), true);
	assert.equal(value.surfaces.length, 2, 'another context in the same native realm reuses the proof');
	value.context.getContextAttributes = () => ({ alpha: false });
	assert.equal(canBatchRoundCapStems(value.native), true);
	assert.equal(value.surfaces.length, 4, 'different native backend settings require a separate proof');
	assert.deepEqual(value.settings, [{ alpha: true }, { alpha: true }, { alpha: false }, { alpha: false }]);
});

void test('pixel mismatch and failed native surfaces remain conservative and cache their rejection', () => {
	for (const options of [{ mismatched: true }, { unreadable: true }, { unavailable: true }]) {
		const value = fixture(options);
		assert.equal(canBatchRoundCapStems(value.native), false);
		const allocations = value.surfaces.length;
		assert.ok(value.surfaces.every(surface => surface.width === 0 && surface.height === 0));
		assert.equal(canBatchRoundCapStems(value.native), false);
		assert.equal(value.surfaces.length, allocations);
	}
	const absent = fixture();
	absent.failCreation = true;
	assert.equal(canBatchRoundCapStems(absent.native), false);
	absent.failCreation = false;
	assert.equal(canBatchRoundCapStems(absent.native), false);
	assert.equal(absent.surfaces.length, 0, 'failed creation does not repeatedly allocate on later waveform draws');
});

void test('failed surface release declines batching and still attempts every other cleanup', () => {
	const value = fixture({ unreleasable: true });
	assert.equal(canBatchRoundCapStems(value.native), false);
	assert.equal(value.surfaces.length, 2);
	assert.ok(value.surfaces.every(surface => surface.height === 0));
	assert.equal(canBatchRoundCapStems(value.native), false);
	assert.equal(value.surfaces.length, 2, 'release failure is cached as a conservative rejection');
});

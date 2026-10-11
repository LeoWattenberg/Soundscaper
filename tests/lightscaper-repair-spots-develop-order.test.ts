/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withRepairSpotsPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-repair-spots-v1.ts';
import { withPhotoDevelopFullResolutionFrameV2 } from '../src/lightscaper/controller/photo-develop-frame-v2.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';

const LIMITS = { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 };
const original = () => ({ descriptor: { schemaVersion: 1 as const, width: 5, height: 1,
	sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const },
	pixels: new Uint8Array([255, 64, 32, 0, 128].flatMap(value => [value, value, value, 255])) });
const repairs = () => ({ schemaVersion: 1, spots: [{ id: 'spot', mode: 'clone', enabled: true,
	target: { x: 0.7, y: 0.5 }, source: { x: 0.1, y: 0.5 }, radius: 0.51, feather: 0, opacity: 1 }] });
function develop() {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(),
		geometry: { crop: { x: 0.6, y: 0, width: 0.4, height: 1 }, rotationDegrees: 0, flipHorizontal: false, flipVertical: false },
		effects: [createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } }),
			createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } })] });
}

test('explicit repair prepass composes with the real legacy crop, effect geometry and linear-sRGB tone stage', async () => {
	const frame = original(), before = [...frame.pixels], retained: PixelFrameV1['pixels'][] = [];
	// This composes the new foundation explicitly. Process3 product routing is a later slice.
	const result = await withRepairSpotsPixelFrameV1({ frame, repairs: repairs() }, repaired => {
		retained.push(repaired.pixels);
		assert.deepEqual([...repaired.pixels], [255, 64, 32, 255, 128].flatMap(value => [value, value, value, 255]));
		return withPhotoDevelopFullResolutionFrameV2({ frame: repaired, develop: develop() }, view => {
			retained.push(view.frame.pixels);
			return { pixels: [...view.frame.pixels], descriptor: view.frame.descriptor, histogram: view.histogram };
		});
	}, { limits: LIMITS });
	// Original pixel3 is cloned before cropping to pixels3/4, flipping, then exposure-1.
	assert.deepEqual(result.pixels, [92, 92, 92, 255, 188, 188, 188, 255]);
	assert.equal(result.descriptor.width, 2); assert.equal(result.descriptor.height, 1);
	assert.equal(result.histogram.sampledPixels, 2); assert.equal(result.histogram.bins.red[92], 1);
	assert.equal(result.histogram.bins.red[188], 1); assert.equal(result.histogram.bins.red[0], 0);
	assert.equal(retained.length, 2); assert.ok(retained.every(bytes => bytes.every(value => value === 0)));
	assert.deepEqual([...frame.pixels], before);
});

test('empty and inactive repairs retain the exact current develop bytes and histogram', async () => {
	const frame = original(), before = [...frame.pixels];
	const legacy = await withPhotoDevelopFullResolutionFrameV2({ frame, develop: develop() }, view => ({
		pixels: [...view.frame.pixels], histogram: view.histogram, descriptor: view.frame.descriptor,
	}));
	for (const recipe of [{ schemaVersion: 1, spots: [] }, { ...repairs(), spots: repairs().spots.map(spot => ({ ...spot, enabled: false })) },
		{ ...repairs(), spots: repairs().spots.map(spot => ({ ...spot, opacity: 0 })) }]) {
		const result = await withRepairSpotsPixelFrameV1({ frame, repairs: recipe }, repaired =>
			withPhotoDevelopFullResolutionFrameV2({ frame: repaired, develop: develop() }, view => ({
				pixels: [...view.frame.pixels], histogram: view.histogram, descriptor: view.frame.descriptor,
			})), { limits: LIMITS });
		assert.deepEqual(result, legacy);
	}
	assert.deepEqual([...frame.pixels], before);
});

test('a staged repair can retire before the ordinary develop owner starts without changing immutable original custody', async () => {
	const frame = original(), before = [...frame.pixels]; let borrowed: PixelFrameV1['pixels'] | undefined;
	const staged = await withRepairSpotsPixelFrameV1({ frame, repairs: repairs() }, repaired => {
		borrowed = repaired.pixels;
		return { descriptor: repaired.descriptor, pixels: new Uint8Array(repaired.pixels) };
	}, { limits: LIMITS });
	assert.ok(borrowed?.every(value => value === 0));
	try {
		const result = await withPhotoDevelopFullResolutionFrameV2({ frame: staged, develop: develop() }, view => [...view.frame.pixels]);
		assert.deepEqual(result, [92, 92, 92, 255, 188, 188, 188, 255]);
		assert.deepEqual([...frame.pixels], before);
	} finally { staged.pixels.fill(0); }
});

test('the strict process1/2 owner still refuses scalar repair fields and process3 before reflecting source pixels', async () => {
	let reflected = 0, delivered = 0;
	const unread = new Proxy({}, { ownKeys() { reflected++; throw new Error('Legacy owner reflected repair pixels'); } });
	for (const recipe of [{ ...develop(), repairs: repairs() }, { ...develop(), processVersion: 3, repairs: repairs() }]) {
		await assert.rejects(withPhotoDevelopFullResolutionFrameV2({ frame: unread, develop: recipe }, () => { delivered++; }));
	}
	assert.equal(reflected, 0); assert.equal(delivered, 0);
});

test('the shared repair foundation admits a small original under a wider host capacity without raising its own source budget', async () => {
	const frame = original(), before = [...frame.pixels];
	// Frame's existing capacity can be larger than Photo's; the actual repair
	// source still has to pass the independent 64 MiB planner before pixel reads.
	const result = await withRepairSpotsPixelFrameV1({ frame, repairs: { schemaVersion: 1, spots: [] } },
		output => [...output.pixels], { limits: { maximumSidePixels: 16_384, maximumPixels: 33_554_432, maximumBytes: 134_217_728 } });
	assert.deepEqual(result, before); assert.deepEqual([...frame.pixels], before);
});

test('complete repair work admission precedes reflection of the frame owner pixel property', async () => {
	let pixelDescriptors = 0, delivered = 0;
	const frame = new Proxy({ descriptor: { ...original().descriptor, width: 4096, height: 4096 }, pixels: {} }, {
		getOwnPropertyDescriptor(target, key) {
			if (key === 'pixels') { pixelDescriptors++; throw new Error('Pixel property inspected before repair work admission'); }
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	const full = { ...repairs().spots[0]!, target: { x: 0.5, y: 0.5 }, radius: 1 };
	await assert.rejects(withRepairSpotsPixelFrameV1({ frame, repairs: { schemaVersion: 1,
		spots: [full, { ...full, id: 'second' }] } }, () => { delivered++; }, { limits: LIMITS }), /visit|budget/iu);
	assert.equal(pixelDescriptors, 0); assert.equal(delivered, 0);
});

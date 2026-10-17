/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withImageDevelopFrameV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import { withImageDevelopFrameV2 } from '../src/common/editor/imaging/image-develop-frame-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const SOURCE = { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 };
const PROFILE = { source: SOURCE, render: { maximumSidePixels: 16_384, maximumPixels: 67_108_864, maximumBytes: 268_435_456 } };
const original = () => ({ descriptor: { schemaVersion: 1 as const, width: 5, height: 1,
	sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const },
	pixels: new Uint8Array([255, 64, 32, 0, 128].flatMap(value => [value, value, value, 255])) });
const spots = () => [{ id: 'repair', mode: 'clone', enabled: true, target: { x: 0.7, y: 0.5 },
	source: { x: 0.1, y: 0.5 }, radius: 0.51, feather: 0, opacity: 1 }];
const develop = () => ({ ...defaultImageDevelopStateV2(),
	geometry: { crop: { x: 0.6, y: 0, width: 0.4, height: 1 }, rotationDegrees: 0, flipHorizontal: false, flipVertical: false },
	effects: [createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } }),
		createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } })] });

test('the real process3 renderer repairs original coordinates before legacy crop, effect flip and exposure', async () => {
	const frame = original(), before = [...frame.pixels]; let borrowed: Uint8Array | undefined;
	const result = await withImageDevelopFrameV3({ frame, develop: { ...develop(), processVersion: 3,
		repairs: { schemaVersion: 1, spots: spots() } } }, view => {
		borrowed = view.frame.pixels;
		return { pixels: [...view.frame.pixels], descriptor: view.frame.descriptor, histogram: view.histogram };
	}, PROFILE);
	assert.deepEqual(result.pixels, [92, 92, 92, 255, 188, 188, 188, 255]);
	assert.equal(result.descriptor.width, 2); assert.equal(result.descriptor.height, 1);
	assert.equal(result.histogram.sampledPixels, 2); assert.equal(result.histogram.bins.red[92], 1);
	assert.equal(result.histogram.bins.red[188], 1); assert.equal(result.histogram.bins.red[0], 0);
	assert.ok(borrowed?.every(value => value === 0)); assert.deepEqual([...frame.pixels], before);
});

test('explicit current rendering preserves complete legacy results and inactive repair bytes', async () => {
	const frame = original(), before = [...frame.pixels];
	for (const recipe of [{ ...develop(), processVersion: 1 }, develop(), defaultImageDevelopStateV1()]) {
		const legacy = await withImageDevelopFrameV2({ frame, develop: recipe }, view => ({
			pixels: [...view.frame.pixels], descriptor: view.frame.descriptor, histogram: view.histogram,
		}), PROFILE);
		const current = await withImageDevelopFrameV3({ frame, develop: recipe }, view => ({
			pixels: [...view.frame.pixels], descriptor: view.frame.descriptor, histogram: view.histogram,
		}), PROFILE);
		assert.deepEqual(current, legacy);
		for (const repairs of [{ schemaVersion: 1, spots: [] }, { schemaVersion: 1, spots: spots().map(spot => ({ ...spot, enabled: false })) },
			{ schemaVersion: 1, spots: spots().map(spot => ({ ...spot, opacity: 0 })) }]) {
			const inactive = await withImageDevelopFrameV3({ frame, develop: { ...recipe, processVersion: 3, repairs } }, view => ({
				pixels: [...view.frame.pixels], descriptor: view.frame.descriptor, histogram: view.histogram,
			}), PROFILE);
			assert.deepEqual(inactive, legacy);
		}
	}
	assert.deepEqual([...frame.pixels], before);
});

test('strict old rendering refuses process3 before reflecting source frames', async () => {
	let reflections = 0, deliveries = 0;
	const frame = new Proxy({}, { ownKeys() { reflections++; throw new Error('Unadmitted pixels reflected'); } });
	await assert.rejects(withImageDevelopFrameV2({ frame, develop: { ...develop(), processVersion: 3,
		repairs: { schemaVersion: 1, spots: spots() } } }, () => { deliveries++; }, PROFILE));
	assert.equal(reflections, 0); assert.equal(deliveries, 0);
});

test('process3 complete repair work admission precedes the owning pixels property descriptor', async () => {
	let pixelDescriptors = 0, deliveries = 0;
	const frame = new Proxy({ descriptor: { ...original().descriptor, width: 4096, height: 4096 }, pixels: {} }, {
		getOwnPropertyDescriptor(target, key) {
			if (key === 'pixels') { pixelDescriptors++; throw new Error('Premature pixels property reflection'); }
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	const spot = { ...spots()[0]!, target: { x: 0.5, y: 0.5 }, radius: 1 };
	await assert.rejects(withImageDevelopFrameV3({ frame, develop: { ...defaultImageDevelopStateV2(), processVersion: 3,
		repairs: { schemaVersion: 1, spots: [spot, { ...spot, id: 'second' }] } } }, () => { deliveries++; }, PROFILE), /visit|budget/iu);
	assert.equal(pixelDescriptors, 0); assert.equal(deliveries, 0);
});

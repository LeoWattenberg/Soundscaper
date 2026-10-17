/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withImageDevelopFrameV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { gradientGraph, LUT_BODY, LUT_REFERENCE, profile as lutEffect, rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';

const LIMITS = { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 };
const PROFILE = { source: LIMITS, render: LIMITS };
function repair(mode: 'clone' | 'heal' = 'clone') {
	return { id: 'repair', mode, enabled: true, target: { x: 0.5, y: 0.5 },
		source: { x: 1 / 6, y: 0.5 }, radius: 0.1, feather: 0, opacity: 1 };
}
function develop(spots: readonly unknown[] = [repair()]) {
	return { ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots } };
}
function invert() {
	return createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
}
function rangeGraph() {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [
		{ id: 'luma', kind: 'luminance-range', lower: 0.2126, upper: 0.2126, falloff: 0 },
		{ id: 'color', kind: 'color-range', color: { r: 1, g: 0, b: 0 }, radius: 0, falloff: 0 },
		{ id: 'both', kind: 'boolean', operation: 'intersect', inputNodeIds: ['luma', 'color'] },
	], outputNodeId: 'both' };
}
function brushGraph(sourceRef: string, id = 'mask') {
	return { schemaVersion: 1, id, kind: 'matte', inputs: [{ name: 'paint', sourceRef, kind: 'alpha' }],
		nodes: [{ id: 'painted', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'painted' };
}
async function brush(alpha: readonly number[]) {
	return withPreparedBrushMaskResourceV1({ width: alpha.length, height: 1, alpha: new Uint8Array(alpha) },
		prepared => ({ reference: prepared.reference, bytes: prepared.bytes.slice() }));
}
function donors() {
	const pixels = new Uint8Array(11 * 3 * 4);
	for (let i = 0; i < pixels.length; i += 4) pixels.set([0, 0, 0, 255], i);
	for (let y = 0; y < 3; y++) for (let x = 0; x < 11; x++) {
		const gray = x < 3 ? 32 : x >= 4 && x < 7 ? 64 : x >= 8 ? 128 : 0;
		pixels.set([gray, gray, gray, 255], (y * 11 + x) * 4);
	}
	pixels.set([64, 64, 64, 255], (11 + 1) * 4);
	pixels.set([192, 192, 192, 255], (11 + 5) * 4);
	pixels.set([0, 0, 0, 255], (11 + 9) * 4);
	return { descriptor: { ...rgbaFrame().descriptor, width: 11, height: 3 }, pixels };
}

test('V3 Heal uses immutable original boundary guidance and moving its donor changes the actual developed pixel', async () => {
	const frame = donors(), original = frame.pixels.slice();
	const spot = { ...repair('heal'), target: { x: 9.5 / 11, y: 0.5 }, source: { x: 1.5 / 11, y: 0.5 }, radius: 0.2 };
	for (const [sourceX, expected] of [[1.5 / 11, 138], [5.5 / 11, 217]] as const) {
		const actual = await withImageDevelopFrameV3({ frame, develop: develop([{ ...spot, source: { x: sourceX, y: 0.5 } }]) },
			view => [...view.frame.pixels], PROFILE);
		// Single-cell screened solutions are D(128)+D(64)-D(32) and D(128)+D(192)-D(64).
		assert.deepEqual(actual.slice(20 * 4, 21 * 4), [expected, expected, expected, 255]);
		const unchanged = [...original]; unchanged.splice(20 * 4, 4, expected, expected, expected, 255);
		assert.deepEqual(actual, unchanged); assert.deepEqual(frame.pixels, original);
	}
});

test('V3 repairs precede genuine range and LUT stages, and each binding samples its own incoming frame', async () => {
	const frame = rgbaFrame([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255]), original = frame.pixels.slice();
	const recipe = { ...develop(), effects: [lutEffect(), invert()], masks: [rangeGraph()],
		maskBindings: [{ effectId: 'profile', maskId: 'mask' }, { effectId: 'invert', maskId: 'mask' }] };
	let reads = 0;
	const source: CubeLutSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, source); assert.deepEqual(reference, LUT_REFERENCE); reads++; return consume(LUT_BODY);
	} };
	for (const [effectId, coverage] of [['profile', [255, 255, 0]], ['invert', [0, 0, 0]]] as const) {
		const result = await withImageDevelopFrameV3({ frame, develop: recipe, maskOverlay: { maskId: 'mask', effectId } }, view => {
			assert.ok(view.maskOverlay); return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
		}, PROFILE, { source });
		// The real LUT maps linear red to .25 -> encoded137. It is outside the later hard red/luma range.
		assert.deepEqual(result, { pixels: [137, 0, 0, 255, 137, 0, 0, 255, 0, 0, 0, 255], coverage });
		assert.notDeepEqual(result.pixels.slice(4, 8), [118, 255, 255, 255], 'Earlier coverage must not be reused after the LUT');
	}
	assert.equal(reads, 2); assert.deepEqual(frame.pixels, original); assert.equal(LUT_BODY[0], 76);
});

test('V3 observed mask coverage follows cropped effect input and suffix flip after original repair', async () => {
	const frame = rgbaFrame([255, 255, 255, 255, 0, 0, 0, 128, 0, 0, 0, 255, 0, 0, 0, 255]);
	const original = frame.pixels.slice(), crop = createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: 0.5 } });
	const flip = createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } });
	const recipe = { ...develop([{ ...repair(), target: { x: 0.375, y: 0.5 }, source: { x: 0.125, y: 0.5 } }]),
		effects: [crop, invert(), flip], masks: [gradientGraph()], maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
	const result = await withImageDevelopFrameV3({ frame, develop: recipe, maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
		assert.ok(view.maskOverlay); return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage],
			width: view.frame.descriptor.width, overlayWidth: view.maskOverlay.width, height: view.maskOverlay.height };
	}, PROFILE);
	// Gradient64/191 projects191/64. Remaining white191/255 encodes224;64/255 encodes137.
	assert.deepEqual(result, { pixels: [137, 137, 137, 128, 224, 224, 224, 255], coverage: [191, 64], width: 2, overlayWidth: 2, height: 1 });
	assert.deepEqual(frame.pixels, original);
});

test('V3 authentic brush declarations borrow serially after repair and release before actual effect delivery', async () => {
	const first = await brush([255]), second = await brush([64]);
	const frame = rgbaFrame([255, 255, 255, 255, 0, 0, 0, 255]), original = frame.pixels.slice();
	const graph = { ...brushGraph(first.reference.storageKey), inputs: [
		{ name: 'first', sourceRef: first.reference.storageKey, kind: 'alpha' }, { name: 'second', sourceRef: second.reference.storageKey, kind: 'alpha' },
	], nodes: [{ id: 'one', kind: 'alpha', inputName: 'first' }, { id: 'two', kind: 'alpha', inputName: 'second' },
		{ id: 'both', kind: 'boolean', operation: 'intersect', inputNodeIds: ['one', 'two'] }], outputNodeId: 'both' };
	const recipe = { ...develop([{ ...repair(), target: { x: 0.75, y: 0.5 }, source: { x: 0.25, y: 0.5 } }]),
		effects: [invert()], masks: [graph], maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
	let active = 0, maximum = 0; const retired: string[] = [];
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, maskSource); active++; maximum = Math.max(maximum, active);
		try { return await consume(reference.storageKey === first.reference.storageKey ? first.bytes : second.bytes); }
		finally { active--; retired.push(reference.storageKey); }
	} };
	const result = await withImageDevelopFrameV3({ frame, develop: recipe, maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
		assert.equal(active, 0); assert.equal(retired.length, 2); assert.ok(view.maskOverlay);
		return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
	}, PROFILE, { maskSource });
	// Coverage64 leaves191/255 of white, encoding224 rather than the exact .75 value225.
	assert.deepEqual(result, { pixels: [224, 224, 224, 255, 224, 224, 224, 255], coverage: [64, 64] });
	assert.equal(maximum, 1); assert.deepEqual(new Set(retired), new Set([first.reference.storageKey, second.reference.storageKey]));
	assert.deepEqual(frame.pixels, original);
});

test('V3 authenticates a corrupt unused brush body before delivering any repaired result', async () => {
	const used = await brush([255]), unused = await brush([64]), corrupt = unused.bytes.slice(); corrupt[16] = 63;
	const recipe = { ...develop(), effects: [invert()], masks: [brushGraph(used.reference.storageKey), brushGraph(unused.reference.storageKey, 'unbound')],
		maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
	const frame = rgbaFrame([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]), original = frame.pixels.slice();
	let delivered = 0; const requested: string[] = [];
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		requested.push(reference.storageKey); return consume(reference.storageKey === used.reference.storageKey ? used.bytes : corrupt);
	} };
	await assert.rejects(withImageDevelopFrameV3({ frame, develop: recipe }, () => { delivered++; }, PROFILE, { maskSource }), /SHA256/iu);
	assert.equal(delivered, 0); assert.ok(requested.includes(unused.reference.storageKey)); assert.deepEqual(frame.pixels, original);
	assert.deepEqual(unused.bytes.slice(16), new Uint8Array([64]));
});

test('strict V3 brush authority refuses missing sources and non-alpha declarations before source frame reflection', async () => {
	const body = await brush([255]); let pixels = 0, bodies = 0;
	const unread = new Proxy({}, { ownKeys() { pixels++; throw Error('Unsupported brush inspected original'); } });
	const maskSource: MaskRasterSourcePortV1 = { async withBytes() { bodies++; throw Error('Unsupported brush acquired bytes'); } };
	const graph = brushGraph(body.reference.storageKey), recipe = { ...develop(), effects: [invert()], masks: [graph],
		maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
	await assert.rejects(withImageDevelopFrameV3({ frame: unread, develop: recipe }, () => {}, PROFILE));
	for (const channel of ['red', 'luma']) {
		const invalid = { ...graph, inputs: [{ ...graph.inputs[0]!, kind: 'raster' }],
			nodes: [{ id: 'painted', kind: 'raster', inputName: 'paint', channel }] };
		await assert.rejects(withImageDevelopFrameV3({ frame: unread, develop: { ...recipe, masks: [invalid] } }, () => {}, PROFILE, { maskSource }));
	}
	assert.equal(pixels, 0); assert.equal(bodies, 0);
});

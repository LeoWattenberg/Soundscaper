/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withPhotoDevelopProxyFrameV1 } from '../src/lightscaper/controller/photo-develop-frame-v1.ts';
import { withPhotoDevelopProxyFrameV2 } from '../src/lightscaper/controller/photo-develop-frame-v2.ts';
import { PHOTO_DEVELOP_PROXY_LIMITS_V1 } from '../src/lightscaper/controller/photo-develop-frame-core.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { planAdmittedImageDevelopMasksV1 } from '../src/common/editor/imaging/image-develop-mask-plan-v1.ts';
import { prepareImageDevelopBrushMasksV1, prepareVideoMaskMatteBrushInputsV1 } from '../src/common/editor/imaging/image-develop-brush-mask-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { withImageDevelopMaskOverlayV1 } from '../src/common/editor/imaging/image-develop-mask-overlay-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';

function graph() {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [{ id: 'shape', kind: 'vector-shape',
		shape: 'rectangle', x: 2 / 3, y: 0, width: 1 / 3, height: 1 }], outputNodeId: 'shape' };
}
function recipe(mask: unknown, processVersion = 2) {
	return { ...defaultImageDevelopStateV1(), processVersion,
		effects: [createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } }),
			createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } })],
		masks: [mask], maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
}
const named = () => ({ ...graph(), schemaVersion: 2, name: 'Sky ☀' });

test('explicit legacy-to-named promotion keeps literal pixels, alpha and projected overlay through geometry', async () => {
	const frame = rgbaFrame([0, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 255]), original = [...frame.pixels];
	const expected = [255, 255, 255, 255, 0, 0, 0, 128, 0, 0, 0, 0];
	const legacy = await withPhotoDevelopProxyFrameV1({ frame, develop: recipe(graph(), 1) }, view => [...view.frame.pixels]);
	assert.deepEqual(legacy, expected);
	const develop = recipe(named()), wire = JSON.stringify(develop);
	const result = await withPhotoDevelopProxyFrameV2({ frame, develop, maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
		assert.ok(view.maskOverlay);
		return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
	});
	assert.deepEqual(result, { pixels: expected, coverage: [255, 0, 0] });
	assert.deepEqual([...frame.pixels], original); assert.equal(JSON.stringify(develop), wire);
	const coverage = await withImageDevelopMaskOverlayV1({ develop, source: { width: 3, height: 1 }, maskId: 'mask', effectId: 'invert' },
		view => [...view.coverage], PHOTO_DEVELOP_PROXY_LIMITS_V1);
	assert.deepEqual(coverage, [255, 0, 0]);
});

test('named recipe planning validates metadata and uses a strict legacy computational graph without dropping persisted names', () => {
	const plain = graph(), label = { ...plain, schemaVersion: 2, name: 'Water' }, develop = recipe(label), wire = JSON.stringify(develop);
	const before = planAdmittedImageDevelopMasksV1(recipe(plain), 3, 1, PHOTO_DEVELOP_PROXY_LIMITS_V1.render);
	const plan = planAdmittedImageDevelopMasksV1(develop, 3, 1, PHOTO_DEVELOP_PROXY_LIMITS_V1.render);
	assert.deepEqual(plan, before); assert.equal(plan.bindings[0]?.graph.schemaVersion, 1);
	assert.equal(Object.hasOwn(plan.bindings[0]!.graph, 'name'), false); assert.equal(JSON.stringify(develop), wire);
	assert.throws(() => planAdmittedImageDevelopMasksV1(recipe({ ...label, name: ' Water ' }), 3, 1, PHOTO_DEVELOP_PROXY_LIMITS_V1.render));
});

test('named brush recipes retain authenticated body identity and independently known linear blend bytes', async () => {
	const body = await withPreparedBrushMaskResourceV1({ width: 4, height: 1, alpha: new Uint8Array([0, 64, 128, 255]) },
		prepared => ({ reference: prepared.reference, bytes: prepared.bytes.slice() }));
	const mask = { schemaVersion: 2, id: 'mask', kind: 'matte', name: 'Brush',
		inputs: [{ name: 'paint', kind: 'alpha', sourceRef: body.reference.storageKey }],
		nodes: [{ id: 'painted', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'painted' };
	const develop = { ...recipe(mask), effects: recipe(mask).effects.slice(0, 1) }, wire = JSON.stringify(develop);
	const prepared = prepareImageDevelopBrushMasksV1(develop, 4, 1, PHOTO_DEVELOP_PROXY_LIMITS_V1.render);
	assert.deepEqual(prepared.references, [body.reference]); assert.equal(prepared.plan.bindings[0]?.graph.schemaVersion, 1);
	const frame = rgbaFrame([0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 1, 0, 0, 0, 255]);
	const original = [...frame.pixels], bytes = [...body.bytes]; let reads = 0;
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, maskSource); assert.deepEqual(reference, body.reference); reads++; return consume(body.bytes);
	} };
	const result = await withPhotoDevelopProxyFrameV2({ frame, develop, maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
		assert.ok(view.maskOverlay); return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
	}, { maskSource });
	assert.deepEqual(result, { pixels: [0, 0, 0, 255, 137, 137, 137, 128, 188, 188, 188, 1, 255, 255, 255, 255], coverage: [0, 64, 128, 255] });
	assert.equal(reads, 1); assert.deepEqual([...frame.pixels], original); assert.deepEqual([...body.bytes], bytes);
	assert.equal(JSON.stringify(develop), wire);
	// The standalone Graph1 owner still refuses nested Graph2 metadata.
	assert.throws(() => prepareVideoMaskMatteBrushInputsV1(mask, 4, 1));
});

test('names confer no body capability and invalid named metadata refuses before frame or source reflection', async () => {
	let inspected = 0, reads = 0, consumed = 0;
	const frame = new Proxy({}, { ownKeys() { inspected++; throw Error('Frame inspected before admission'); } });
	const maskSource = new Proxy({} as MaskRasterSourcePortV1, { ownKeys() { reads++; throw Error('Source inspected before admission'); },
		getOwnPropertyDescriptor() { reads++; throw Error('Source reflected before admission'); } });
	for (const mask of [{ ...named(), name: '' }, { ...named(), name: ' invalid ' }, { ...named(), name: null },
		{ ...named(), schemaVersion: 3 }, { ...named(), name: 'a\u0000b' }, { ...named(), name: '\uD800' }]) {
		await assert.rejects(withPhotoDevelopProxyFrameV2({ frame, develop: recipe(mask) }, () => { consumed++; }, { maskSource }));
	}
	const brush = { ...named(), inputs: [{ name: 'paint', kind: 'alpha', sourceRef: `brush-mask-v1:1:1:${'a'.repeat(64)}` }],
		nodes: [{ id: 'painted', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'painted' };
	await assert.rejects(withPhotoDevelopProxyFrameV2({ frame, develop: recipe(brush) }, () => { consumed++; }), /authority|authenticated/iu);
	assert.equal(inspected, 0); assert.equal(reads, 0); assert.equal(consumed, 0);
});

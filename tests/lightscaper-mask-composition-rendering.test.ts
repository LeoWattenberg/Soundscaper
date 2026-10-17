/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withPhotoDevelopProxyFrameV2 } from '../src/lightscaper/controller/photo-develop-frame-v2.ts';
import { PHOTO_DEVELOP_PROXY_LIMITS_V1 } from '../src/lightscaper/controller/photo-develop-frame-core.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { manageImageDevelopMasksV3 } from '../src/common/editor/imaging/image-develop-mask-management-v3.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { planAdmittedImageDevelopMasksV1 } from '../src/common/editor/imaging/image-develop-mask-plan-v1.ts';
import { prepareImageDevelopBrushMasksV1 } from '../src/common/editor/imaging/image-develop-brush-mask-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';

const OPERATIONS = [
	{ operation: 'union', coverage: [255, 192, 192, 255], gray: [255, 225, 225, 255] },
	{ operation: 'intersect', coverage: [0, 64, 64, 0], gray: [0, 137, 137, 0] },
	{ operation: 'subtract', coverage: [0, 63, 191, 255], gray: [0, 136, 224, 255] },
] as const;

for (const { operation, coverage, gray } of OPERATIONS) test(`composed ${operation} blends independently known brush alpha and projects coverage through geometry`, async () => {
	const bodies = await Promise.all([[0, 64, 192, 255], [255, 192, 64, 0]].map(alpha =>
		withPreparedBrushMaskResourceV1({ width: 4, height: 1, alpha: new Uint8Array(alpha) },
			prepared => ({ reference: prepared.reference, bytes: prepared.bytes.slice() }))));
	const masks = bodies.map((body, index) => ({ schemaVersion: 2, id: index === 0 ? 'selected' : 'operand', kind: 'matte', name: index === 0 ? 'Sky' : 'Paint',
		inputs: [{ name: 'paint', kind: 'alpha', sourceRef: body.reference.storageKey },
			{ name: 'unused', kind: 'alpha', sourceRef: body.reference.storageKey }],
		nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'alpha' }));
	const input = { ...defaultImageDevelopStateV2(), masks, maskBindings: [{ maskId: 'selected', effectId: 'invert' }],
		effects: [createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } }),
			createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } })] };
	const wire = JSON.stringify(input), develop = manageImageDevelopMasksV3(input, { type: 'compose', maskId: 'selected', operandMaskId: 'operand', operation });
	assert.equal(develop.masks.find(mask => mask.id === 'selected')?.schemaVersion, 2);
	assert.deepEqual(develop.masks.find(mask => mask.id === 'operand'), masks[1]);
	assert.deepEqual(develop.maskBindings, input.maskBindings);
	const prepared = prepareImageDevelopBrushMasksV1(develop, 4, 1, PHOTO_DEVELOP_PROXY_LIMITS_V1.render);
	assert.deepEqual(prepared.references.map(reference => reference.storageKey).sort(), bodies.map(body => body.reference.storageKey).sort());
	const reads = new Map<string, number>(), bytes = bodies.map(body => [...body.bytes]);
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, maskSource);
		const body = bodies.find(candidate => candidate.reference.storageKey === reference.storageKey)!;
		assert.deepEqual(reference, body.reference); reads.set(reference.storageKey, (reads.get(reference.storageKey) ?? 0) + 1);
		return consume(body.bytes);
	} };
	const frame = rgbaFrame([0, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 1, 0, 0, 0, 255]), original = [...frame.pixels];
	const result = await withPhotoDevelopProxyFrameV2({ frame, develop, maskOverlay: { maskId: 'selected', effectId: 'invert' } }, view => {
		assert.ok(view.maskOverlay); return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
	}, { maskSource });
	// Geometry returns straight alpha and canonical zero for hidden zero-alpha RGB.
	// Other literals encode linear-light blending followed by a horizontal flip.
	const expected = [3, 2, 1, 0].flatMap(index => {
		const alpha = [0, 128, 1, 255][index]!, value = alpha === 0 ? 0 : gray[index]!;
		return [value, value, value, alpha];
	});
	assert.deepEqual(result, { pixels: expected, coverage: [...coverage].reverse() });
	assert.deepEqual([...reads.values()], [1, 1]); assert.deepEqual(bodies.map(body => [...body.bytes]), bytes);
	assert.deepEqual([...frame.pixels], original); assert.equal(JSON.stringify(input), wire);
});

test('a copied range definition samples the destination adjustment input, independently of its donor binding', async () => {
	const masks = [{ schemaVersion: 1, id: 'operand', kind: 'mask', inputs: [],
		nodes: [{ id: 'range', kind: 'luminance-range', lower: 0, upper: 0.25, falloff: 0 }], outputNodeId: 'range' },
	{ schemaVersion: 2, id: 'selected', kind: 'mask', name: 'Outside', inputs: [],
		nodes: [{ id: 'empty', kind: 'vector-shape', shape: 'rectangle', x: 2, y: 0, width: 0.1, height: 1 }], outputNodeId: 'empty' }];
	const input = { ...defaultImageDevelopStateV2(), masks,
		effects: ['first', 'second'].map(id => createVideoEffect('point-curves-v1', { id, params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } })),
		maskBindings: [{ effectId: 'first', maskId: 'operand' }, { effectId: 'second', maskId: 'selected' }] };
	const develop = manageImageDevelopMasksV3(input, { type: 'compose', maskId: 'selected', operandMaskId: 'operand', operation: 'union' });
	const frame = rgbaFrame([0, 0, 0, 1, 0, 0, 0, 255]), original = [...frame.pixels];
	const result = await withPhotoDevelopProxyFrameV2({ frame, develop, maskOverlay: { maskId: 'selected', effectId: 'second' } }, view => {
		assert.ok(view.maskOverlay); return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
	});
	assert.deepEqual(result, { pixels: [255, 255, 255, 1, 255, 255, 255, 255], coverage: [0, 0] });
	assert.deepEqual([...frame.pixels], original); assert.deepEqual(develop.maskBindings, input.maskBindings);
});

test('composition preserves the separate working-plane ceiling even when both original masks individually fit', () => {
	function graph(id: string) {
		const leaves = Array.from({ length: 256 }, (_, index) => ({ id: `shape-${String(index)}`, kind: 'vector-shape',
			shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }));
		const groups = Array.from({ length: 4 }, (_, index) => ({ id: `group-${String(index)}`, kind: 'boolean', operation: 'union',
			inputNodeIds: leaves.slice(index * 64, (index + 1) * 64).map(node => node.id) }));
		return { schemaVersion: 1, id, kind: 'mask', inputs: [], nodes: [...leaves, ...groups,
			{ id: 'output', kind: 'boolean', operation: 'union', inputNodeIds: groups.map(node => node.id) }], outputNodeId: 'output' };
	}
	const input = { ...defaultImageDevelopStateV2(), masks: [graph('selected'), graph('operand')],
		effects: [createVideoEffect('tone-ladder-v1', { id: 'tone' })], maskBindings: [{ effectId: 'tone', maskId: 'selected' }] };
	assert.ok(planAdmittedImageDevelopMasksV1(input, 400, 400, PHOTO_DEVELOP_PROXY_LIMITS_V1.render).maximumWorkingBytes < 64 * 1024 * 1024);
	const develop = manageImageDevelopMasksV3(input, { type: 'compose', maskId: 'selected', operandMaskId: 'operand', operation: 'union' });
	assert.throws(() => planAdmittedImageDevelopMasksV1(develop, 400, 400, PHOTO_DEVELOP_PROXY_LIMITS_V1.render), /working|budget|limit/iu);
});

test('composing brush references grants no media capability and refuses before reflecting a source frame', async () => {
	const masks = ['selected', 'operand'].map(id => ({ schemaVersion: 1, id, kind: 'mask',
		inputs: [{ name: 'paint', kind: 'alpha', sourceRef: `brush-mask-v1:4:1:${'a'.repeat(64)}` }],
		nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'alpha' }));
	const input = { ...defaultImageDevelopStateV2(), masks, effects: [createVideoEffect('tone-ladder-v1', { id: 'tone' })],
		maskBindings: [{ effectId: 'tone', maskId: 'selected' }] };
	const develop = manageImageDevelopMasksV3(input, { type: 'compose', maskId: 'selected', operandMaskId: 'operand', operation: 'union' });
	let inspected = 0, consumed = 0;
	const frame = new Proxy({}, { ownKeys() { inspected++; throw Error('Frame reflected before brush admission'); } });
	await assert.rejects(withPhotoDevelopProxyFrameV2({ frame, develop }, () => { consumed++; }), /authority|authenticated/iu);
	assert.equal(inspected, 0); assert.equal(consumed, 0);
});

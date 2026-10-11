/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMotionAeProperties } from '../src/common/editor/motion-ae-property-custody.ts';
import { readMotionAeHostProperty, type MotionAePropertyHost, type MotionAePropertyReadHost } from '../src/common/editor/motion-ae-host-property.ts';
const base = { kind: 'group', name: 'Mask', matchName: 'ADBE Mask Atom', children: [] };
const metadata = { mode: 'subtract', inverted: true, rotoBezier: false, featherFalloff: 'smooth', motionBlur: 'same-as-layer' };
const normalize = (value: unknown) => normalizeMotionAeProperties([value], { properties: 0, keys: 0 })[0];
test('Motion AE mask custody preserves explicit semantics without changing older absent metadata', () => {
	assert.deepEqual(normalize(base), base); assert.deepEqual(normalize({ ...base, mask: metadata }), { ...base, mask: metadata });
	assert.throws(() => normalize({ ...base, mask: { ...metadata, mode: 'execute' } }), /mask mode/iu);
	assert.throws(() => normalize({ ...base, mask: { ...metadata, executable: 'bad' } }), /unsupported|unexpected|unknown/iu);
	assert.throws(() => normalize({ ...base, matchName: 'ADBE Transform Group', mask: metadata }), /mask atom/iu);
});
test('Motion AE host reads MaskPropertyGroup metadata through its explicit host adapter', () => {
	const property = { name: 'Mask', matchName: 'ADBE Mask Atom', numProperties: 0 } as MotionAePropertyHost;
	const host: MotionAePropertyReadHost = { kind: () => 'group', interpolation: () => 'linear', text: () => { throw new Error('unused'); }, checkCancelled: () => {},
		mask: () => ({ ...metadata, mode: 'subtract', featherFalloff: 'smooth', motionBlur: 'same-as-layer' }) };
	assert.deepEqual(readMotionAeHostProperty(property, host, 'layer', 'mask', [], { properties: 0, keys: 0 }), { ...base, mask: metadata });
});

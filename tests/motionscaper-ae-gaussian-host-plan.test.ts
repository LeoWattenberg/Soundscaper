/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareMotionAeHostImport } from '../src/common/editor/motion-ae-host-import-plan.ts';
import type { MotionAeProperty } from '../src/common/editor/motion-ae-exchange-types.ts';
import { gaussianExchange } from './helpers/motionscaper-ae-gaussian-exchange-fixture.ts';
test('Motion AE host plan admits only exact reviewed Gaussian controls and retains inert profile before mutation', () => {
	const source = gaussianExchange(), plan = prepareMotionAeHostImport(JSON.stringify(source));
	assert.deepEqual(plan.gaussianProfile, source.gaussianProfile); assert.deepEqual(plan.compositions[0]!.layers[0]!.gaussian, [{ enabled: true, blur: { matchName: 'reviewed-radius', expression: null, value: [6], spatial: false, keys: [] } }]);
	assert.ok(plan.warnings.some(value => /kernel.*unqualified/u.test(value)));
	const without = prepareMotionAeHostImport(JSON.stringify({ ...source, gaussianProfile: undefined })); assert.deepEqual(without.compositions[0]!.layers[0]!.gaussian, []); assert.ok(without.warnings.some(value => /unmapped effect/u.test(value)));
});
test('Motion AE host plan rejects changed neutral Gaussian control, layer authority and malformed profile before mutation', () => {
	const source = gaussianExchange();
	for (const matchName of ['reviewed-opacity', 'reviewed-repeat', 'reviewed-dimensions', 'reviewed-radius']) {
		const change = (property: MotionAeProperty): MotionAeProperty => property.kind === 'group' ? { ...property, children: property.children.map(change) } : property.kind === 'numeric' && property.matchName === matchName ? { ...property, value: [999] } : property;
		assert.throws(() => prepareMotionAeHostImport(JSON.stringify({ ...source, compositions: source.compositions.map(comp => ({ ...comp, layers: comp.layers.map(layer => ({ ...layer, properties: layer.properties.map(change) })) })) })), /Gaussian/iu);
	}
	for (const change of [{ effectsActive: undefined }, { compositing: undefined }, { threeD: true }]) assert.throws(() => prepareMotionAeHostImport(JSON.stringify({ ...source, compositions: source.compositions.map(comp => ({ ...comp, layers: comp.layers.map(layer => ({ ...layer, ...change })) })) })), /Gaussian/iu);
	assert.throws(() => prepareMotionAeHostImport(JSON.stringify({ ...source, gaussianProfile: { ...source.gaussianProfile, reviewed: false } })), /review/iu);
});

/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { convertMotionAeGaussianEffects, exportMotionAeGaussianEffects } from '../src/common/editor/motion-ae-gaussian-conversion.ts';
import { normalizeMotionAeProperties } from '../src/common/editor/motion-ae-property-custody.ts';
import { motionAeGaussianProfileFixture } from './helpers/motionscaper-ae-gaussian-fixture.ts';
import { createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
import { compileInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
import type { MotionAeLayer, MotionAeProperty, MotionAeReportEntry } from '../src/common/editor/motion-ae-exchange-types.ts';
const rate = { num: 24, den: 1 };
function layer() { return { ...createMotionLayer({ id: 'layer', name: 'Blur', durationFrames: 48, content: { kind: 'null' } }), effects: [{ id: 'blur', type: 'gaussian-blur', enabled: true, parameters: [{ id: 'sigma', value: { ...motionScalar(2), curve: compileInterpolationCurve({ anchors: [{ position: { num: 0, den: 1 }, value: 2 }, { position: { num: 24, den: 1 }, value: 6 }], segments: [{ kind: 'linear' }] }) } }] }] }; }
function source(properties: readonly MotionAeProperty[]): MotionAeLayer { return { id: 'ae-layer', name: 'AE blur', kind: 'null', sourceId: null, parentId: null, matte: null, startTime: 0, inPoint: 0, outPoint: 2, stretch: 100,
	enabled: true, threeD: false, adjustment: false, blendMode: 'normal', compositing: { preserveTransparency: false, collapseTransformation: false }, effectsActive: true, properties }; }
function replace(properties: readonly MotionAeProperty[], change: (property: MotionAeProperty) => MotionAeProperty): readonly MotionAeProperty[] { return properties.map(property => change(property.kind === 'group' ? { ...property, children: replace(property.children, change) } : property)); }
test('Motion AE Gaussian maps explicit declared scale and hold/linear keys bidirectionally without changing profile values', () => {
	const profile = motionAeGaussianProfileFixture(), before = JSON.stringify(profile), report: MotionAeReportEntry[] = [];
	const exported = exportMotionAeGaussianEffects(layer(), rate, profile, report); assert.equal(exported.length, 1);
	const restored = convertMotionAeGaussianEffects(source(exported), rate, profile, () => 'restored-blur', report);
	assert.equal(restored.length, 1); assert.equal(restored[0]!.type, 'gaussian-blur'); assert.equal(restored[0]!.enabled, true);
	assert.deepEqual(restored[0]!.parameters[0]!.value, layer().effects[0]!.parameters[0]!.value);
	assert.equal(JSON.stringify(profile), before); assert.ok(report.every(entry => entry.status === 'editable' && /unqualified/u.test(entry.message)));
	const disabled = convertMotionAeGaussianEffects({ ...source(exported), effectsActive: false }, rate, profile, () => 'disabled', []); assert.equal(disabled[0]!.enabled, false);
});
test('Motion AE Gaussian requires reviewed profile, captured effect and layer switches and neutral compositing geometry', () => {
	const profile = motionAeGaussianProfileFixture(), exported = exportMotionAeGaussianEffects(layer(), rate, profile, []), original = source(exported);
	for (const input of [{ ...original, effectsActive: undefined }, { ...original, threeD: true }, { ...original, compositing: undefined }, { ...original, adjustment: true },
		{ ...original, properties: replace(exported, property => property.kind === 'group' && property.matchName === 'ADBE Gaussian Blur 2' ? { ...property, enabled: undefined } : property) }]) {
		const report: MotionAeReportEntry[] = []; assert.deepEqual(convertMotionAeGaussianEffects(input, rate, profile, () => 'unused', report), []); assert.ok(report.some(entry => entry.status === 'unsupported'));
	}
	const report: MotionAeReportEntry[] = []; assert.deepEqual(convertMotionAeGaussianEffects(original, rate, null, () => 'unused', report), []);
	assert.deepEqual(exportMotionAeGaussianEffects(layer(), rate, null, report), []); assert.ok(report.every(entry => entry.status === 'unsupported' && /profile/iu.test(entry.message)));
});
test('Motion AE Gaussian refuses changed control closure, opacity, edge/channel settings, masks, enabled expressions and nonlinear or out-of-bound keys', () => {
	const profile = motionAeGaussianProfileFixture(), exported = exportMotionAeGaussianEffects(layer(), rate, profile, []);
	const changes: ((property: MotionAeProperty) => MotionAeProperty)[] = [
		property => property.kind === 'numeric' && property.matchName === 'reviewed-opacity' ? { ...property, value: [50] } : property,
		property => property.kind === 'numeric' && property.matchName === 'reviewed-repeat' ? { ...property, value: [1] } : property,
		property => property.kind === 'numeric' && property.matchName === 'reviewed-dimensions' ? { ...property, value: [82] } : property,
		property => property.kind === 'group' && property.matchName === 'reviewed-mask-references' ? { ...property, children: [{ kind: 'numeric', matchName: 'new-mask', name: 'Mask', value: [1], keys: [], spatial: false, expression: null }] } : property,
		property => property.kind === 'numeric' && property.matchName === 'reviewed-radius' ? { ...property, expression: { enabled: true, disposition: 'unsupported', source: 'time' } } : property,
		property => property.kind === 'numeric' && property.matchName === 'reviewed-radius' ? { ...property, keys: property.keys.map(key => ({ ...key, outInterpolation: 'bezier' })) } : property,
		property => property.kind === 'numeric' && property.matchName === 'reviewed-radius' ? { ...property, value: [41] } : property,
	];
	for (const change of changes) { const report: MotionAeReportEntry[] = []; assert.deepEqual(convertMotionAeGaussianEffects(source(replace(exported, change)), rate, profile, () => 'unused', report), []); assert.ok(report.some(entry => entry.status === 'unsupported')); }
});
test('Motion AE Gaussian reverse refuses unsupported effects, ambiguous parameters and authored expressions without hiding source intent', () => {
	const base = layer(), blur = base.effects[0]!, profile = motionAeGaussianProfileFixture();
	for (const effect of [{ ...blur, type: 'glow' }, { ...blur, parameters: [] }, { ...blur, parameters: [...blur.parameters, ...blur.parameters] },
		{ ...blur, parameters: [{ id: 'sigma', value: { ...motionScalar(2), expression: { enabled: true, source: 'time', references: [] } } }] },
		{ ...blur, parameters: [{ id: 'sigma', value: motionScalar(21) }] }]) {
		const report: MotionAeReportEntry[] = [], input = { ...base, effects: [effect] }, before = JSON.stringify(input);
		assert.deepEqual(exportMotionAeGaussianEffects(input, rate, profile, report), []); assert.ok(report.some(entry => entry.status === 'unsupported')); assert.equal(JSON.stringify(input), before);
	}
});

test('Motion AE Gaussian control admission keeps unrelated effect metadata closed and bounds expansion before conversion', () => {
	const profile = motionAeGaussianProfileFixture(), exported = exportMotionAeGaussianEffects(layer(), rate, profile, []), root = exported[0]!;
	assert.throws(() => normalizeMotionAeProperties([{ kind: 'group', name: 'Unmapped effect', matchName: 'ADBE Unmapped Effect', enabled: true, children: [] }], { properties: 0, keys: 0 }), /enabled/iu);
	const reports: MotionAeReportEntry[] = [];
	assert.deepEqual(convertMotionAeGaussianEffects(source([{ ...root, children: Array.from({ length: 33 }, () => root.children[0]!) }]), rate, profile, () => 'unused', reports), []);
	assert.match(reports[0]!.message, /bounded/iu);
	assert.deepEqual(convertMotionAeGaussianEffects(source([root, root]), rate, profile, () => 'unused', reports), []); assert.match(reports.at(-1)!.message, /Duplicate/u);
	assert.deepEqual(exportMotionAeGaussianEffects({ ...layer(), effects: Array.from({ length: 33 }, (_, index) => ({ ...layer().effects[0]!, id: `blur-${String(index)}` })) }, rate, profile, reports), []);
	assert.match(reports.at(-1)!.message, /32-effect/u);
});

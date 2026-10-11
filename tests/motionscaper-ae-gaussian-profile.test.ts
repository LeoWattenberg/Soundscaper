/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMotionAeGaussianProfile, parseMotionAeGaussianProfile, motionAeGaussianControl, type MotionAeGaussianProfile } from '../src/common/editor/motion-ae-gaussian-profile.ts';
const host = { version: '25.0', buildNumber: 17, locale: 'en_US' };
function fixture(): MotionAeGaussianProfile { return { format: 'org.motionscaper.ae-gaussian-profile', version: 1, qualification: 'unqualified', reviewed: true, host,
	review: { dimensions: 'both', repeatEdgePixels: false, effectOpacity: 100, effectMasks: 'none' }, blurrinessPerSigma: 2, blurrinessPath: ['reviewed-radius'], effectOpacityPath: ['reviewed-compositing', 'reviewed-opacity'],
	controls: { kind: 'group', matchName: 'ADBE Gaussian Blur 2', children: [
		{ kind: 'scalar', matchName: 'reviewed-radius', value: 0, minimum: 0, maximum: 1000 },
		{ kind: 'scalar', matchName: 'reviewed-dimensions', value: 81, minimum: 1, maximum: 100 },
		{ kind: 'scalar', matchName: 'reviewed-repeat', value: 0, minimum: 0, maximum: 1 },
		{ kind: 'group', matchName: 'reviewed-compositing', children: [{ kind: 'scalar', matchName: 'reviewed-opacity', value: 100, minimum: 0, maximum: 100 }, { kind: 'group', matchName: 'reviewed-mask-references', children: [] }] },
	] } }; }
test('Motion AE Gaussian profile retains exact reviewed host, declared scale, selected path and neutral control closure', () => {
	const source = fixture(), normalized = parseMotionAeGaussianProfile(JSON.stringify(source), host);
	assert.deepEqual(normalized, source); assert.notEqual(normalized, source); assert.notEqual(normalized.controls.children, source.controls.children);
	assert.equal(motionAeGaussianControl(normalized.controls, normalized.blurrinessPath).maximum, 1000);
	for (const changed of [{ ...host, version: '25.1' }, { ...host, buildNumber: 18 }, { ...host, locale: 'de_DE' }]) assert.throws(() => parseMotionAeGaussianProfile(JSON.stringify(source), changed), /host|version|language/iu);
});
test('Motion AE Gaussian profile requires explicit unqualified label review and a finite positive declared unit scale', () => {
	for (const change of [{ reviewed: false }, { qualification: 'qualified' }, { version: 2 }, { blurrinessPerSigma: 0 }, { blurrinessPerSigma: -1 }, { blurrinessPerSigma: NaN }, { blurrinessPerSigma: 1e7 }, { blurrinessPerSigma: 1e-8 }]) assert.throws(() => normalizeMotionAeGaussianProfile({ ...fixture(), ...change }), /profile|scale|review/iu);
	for (const change of [{ dimensions: 'horizontal' }, { repeatEdgePixels: true }, { effectOpacity: 50 }, { effectMasks: 'active' }]) assert.throws(() => normalizeMotionAeGaussianProfile({ ...fixture(), review: { ...fixture().review, ...change } }), /review/iu);
});
test('Motion AE Gaussian profile bounds its tree before traversal and refuses malformed, duplicate or hidden fields', () => {
	const source = fixture();
	for (const change of [{ nativePath: '/tmp/effect' }, { controls: { ...source.controls, children: Array(65).fill(source.controls.children[0]) } },
		{ controls: { ...source.controls, children: [source.controls.children[0], source.controls.children[0]] } }, { host: { ...host, native: true } },
		{ controls: { ...source.controls, children: [{ ...source.controls.children[0], expression: 'time' }] } }]) assert.throws(() => normalizeMotionAeGaussianProfile({ ...source, ...change }), /profile|control|budget|field|duplicate/iu);
	const cycle: { kind: string; matchName: string; children: unknown[] } = { kind: 'group', matchName: 'ADBE Gaussian Blur 2', children: [] }; cycle.children.push(cycle);
	assert.throws(() => normalizeMotionAeGaussianProfile({ ...source, controls: cycle }), /depth|budget/iu);
	assert.throws(() => parseMotionAeGaussianProfile(' '.repeat(32769), host), /budget/iu);
});
test('Motion AE Gaussian profile rejects ambiguous selected controls, nonzero neutral blur, unknown bounds and changed effect identity', () => {
	const source = fixture(), radius = source.controls.children[0]!;
	for (const change of [{ blurrinessPath: [] }, { blurrinessPath: ['missing'] }, { effectOpacityPath: ['reviewed-radius'] }, { effectOpacityPath: ['missing'] }, { blurrinessPath: ['reviewed-compositing'] },
		{ controls: { ...source.controls, matchName: 'ADBE Gaussian Blur' } },
		...[{ value: 2 }, { minimum: null }, { maximum: null }, { minimum: -1 }, { maximum: 0 }].map(value => ({ controls: { ...source.controls, children: [{ ...radius, ...value }, ...source.controls.children.slice(1)] } }))]) assert.throws(() => normalizeMotionAeGaussianProfile({ ...source, ...change }), /profile|blur|control|bound|path/iu);
});

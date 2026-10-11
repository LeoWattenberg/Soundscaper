/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { captureMotionAeGaussianControls, applyMotionAeGaussianHostEffect } from '../src/common/editor/motion-ae-gaussian-host-controls.ts';
import { motionAeGaussianProfileFixture } from './helpers/motionscaper-ae-gaussian-fixture.ts';
import type { MotionAeImportNumeric } from '../src/common/editor/motion-ae-host-import-plan.ts';
import { motionAeGaussianHostFixture as fixture, motionAeGaussianHostKind as kind } from './helpers/motionscaper-ae-gaussian-host-fixture.ts';
function numeric(): MotionAeImportNumeric { return { matchName: 'reviewed-radius', expression: null, spatial: false, value: [4], keys: [] }; }
test('Motion AE Gaussian host capture preserves all numeric controls/bounds without writes and refuses uncaptured control kinds or expressions', () => {
	const profile = motionAeGaussianProfileFixture(), host = fixture(); assert.deepEqual(captureMotionAeGaussianControls(host.root, kind), profile.controls); assert.deepEqual(host.writes, []);
	host.root.children[0]!.expressionEnabled = true; assert.throws(() => captureMotionAeGaussianControls(host.root, kind), /expression/iu); assert.deepEqual(host.writes, []);
	assert.throws(() => captureMotionAeGaussianControls(fixture().root, () => 'unsupported'), /unsupported/iu);
});
test('Motion AE Gaussian host application verifies the entire new effect inventory and roundtrips named control values', () => {
	const profile = motionAeGaussianProfileFixture(), host = fixture();
	applyMotionAeGaussianHostEffect(host.root, profile, numeric(), false, { kind, hold: 11, linear: 21 });
	assert.equal(host.root.enabled, false); assert.equal(host.root.children[0]!.value, 4);
	assert.equal(host.root.children[1]!.value, 81); assert.equal(host.root.children[2]!.value, 0);
	const clamped = fixture(true); assert.throws(() => applyMotionAeGaussianHostEffect(clamped.root, profile, numeric(), true, { kind, hold: 11, linear: 21 }), /changed|clamp/iu);
});
test('Motion AE Gaussian host refuses changed bounds or extra mask/control inventory before parameter writes', () => {
	const profile = motionAeGaussianProfileFixture();
	for (const change of [(host: ReturnType<typeof fixture>) => host.root.children.push(new host.Control({ kind: 'scalar', matchName: 'extra-mask', value: 1, minimum: 0, maximum: 10 })),
		(host: ReturnType<typeof fixture>) => { Object.defineProperty(host.root.children[0]!, 'maximum', { value: 50 }); }]) {
		const host = fixture(); change(host); assert.throws(() => applyMotionAeGaussianHostEffect(host.root, profile, numeric(), true, { kind, hold: 11, linear: 21 }), /inventory|bound|closure/iu); assert.deepEqual(host.writes, []);
	}
});
test('Motion AE Gaussian host verifies every applied scalar key and refuses forged expression or interpolation intent', () => {
	const profile = motionAeGaussianProfileFixture(), ease = [{ speed: 0, influence: 33 }], keyed: MotionAeImportNumeric = { ...numeric(), keys: [0, 1].map(time => ({ time, value: [4 + time * 4], inInterpolation: 'linear', outInterpolation: 'hold', inEase: ease, outEase: ease, inSpatialTangent: null, outSpatialTangent: null, roving: false })) };
	const host = fixture(); applyMotionAeGaussianHostEffect(host.root, profile, keyed, true, { kind, hold: 11, linear: 21 }); assert.deepEqual(Array.from(host.root.children[0]!.keys.values()), [4, 8]);
	const shifted = fixture(); shifted.root.children[0]!.keyTime = () => 0.1; assert.throws(() => applyMotionAeGaussianHostEffect(shifted.root, profile, keyed, true, { kind, hold: 11, linear: 21 }), /changed|clamp/iu);
	assert.throws(() => applyMotionAeGaussianHostEffect(fixture(true).root, profile, keyed, true, { kind, hold: 11, linear: 21 }), /changed|clamp/iu);
	for (const altered of [{ ...keyed, expression: 'time' }, { ...keyed, keys: keyed.keys.map(key => ({ ...key, outInterpolation: 'bezier' as const })) }]) { const host = fixture(); assert.throws(() => applyMotionAeGaussianHostEffect(host.root, profile, altered, true, { kind, hold: 11, linear: 21 }), /expression|interpolation/iu); assert.deepEqual(host.writes, []); }
});

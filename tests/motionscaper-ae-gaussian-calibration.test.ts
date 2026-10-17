/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { captureMotionAeGaussianCalibration, prepareMotionAeGaussianCalibration, type MotionAeGaussianCalibrationHost, type MotionAeGaussianSample } from '../src/common/editor/motion-ae-gaussian-calibration.ts';
import { gaussianHost, motionAeGaussianProfileFixture } from './helpers/motionscaper-ae-gaussian-fixture.ts';
import { motionAeGaussianHostFixture, motionAeGaussianHostKind } from './helpers/motionscaper-ae-gaussian-host-fixture.ts';
function fixture(unavailable = false, cleanupFailure = false) {
	const controls = motionAeGaussianHostFixture(), calls: string[] = [], state = { effectCount: 0, maskCount: 0, removed: false };
	const effects = { get numProperties() { return state.effectCount; }, property: (index: number) => index === 1 && state.effectCount ? controls.root : null,
		canAddProperty: (name: string) => name === 'ADBE Gaussian Blur 2' && !unavailable, addProperty: (name: string) => { assert.equal(name, 'ADBE Gaussian Blur 2'); calls.push('add-owned-effect'); state.effectCount++; } };
	const layer = { name: '', enabled: false, effectsActive: false, property: (name: string) => name === 'ADBE Effect Parade' ? effects : name === 'ADBE Mask Parade' ? { ...effects, numProperties: state.maskCount } : null };
	const sample = { comment: '', numLayers: 0, layers: { addShape: () => { calls.push('add-owned-layer'); sample.numLayers++; return layer; } }, layer: () => layer,
		openInViewer: () => { calls.push('open'); }, remove: () => { calls.push('remove-owned-sample'); if (cleanupFailure) throw new Error('sample remove failed'); state.removed = true; } };
	let selected: readonly (readonly string[])[] = [motionAeGaussianProfileFixture().blurrinessPath, motionAeGaussianProfileFixture().effectOpacityPath];
	const host: MotionAeGaussianCalibrationHost = { identity: gaussianHost, begin: () => { calls.push('begin'); }, end: () => { calls.push('end'); }, create: () => { calls.push('create-owned-sample'); return sample; },
		kind: motionAeGaussianHostKind, selection: (value: MotionAeGaussianSample) => { assert.equal(value, sample); return selected; } };
	return { host, sample, state, layer, controls, calls, select: (paths: readonly (readonly string[])[]) => { selected = paths; } };
}
test('Motion AE Gaussian calibration owns one sample only and captures its exact reviewed controls without source writes', () => {
	const state = fixture(), sample = prepareMotionAeGaussianCalibration(state.host); assert.equal(sample, state.sample);
	assert.deepEqual(state.calls, ['begin', 'create-owned-sample', 'add-owned-layer', 'add-owned-effect', 'open', 'end']);
	assert.deepEqual(captureMotionAeGaussianCalibration(sample, state.host, true, 2), motionAeGaussianProfileFixture()); assert.deepEqual(state.controls.writes, []);
	assert.equal(state.state.removed, false); assert.equal(state.calls.length, 6);
});
test('Motion AE Gaussian calibration preserves primary and cleanup errors while removing only its new sample', () => {
	const state = fixture(true); assert.throws(() => prepareMotionAeGaussianCalibration(state.host), /unavailable/iu); assert.equal(state.state.removed, true); assert.equal(state.calls.at(-1), 'end');
	const failed = fixture(true, true); assert.throws(() => prepareMotionAeGaussianCalibration(failed.host), error => { assert.ok(error instanceof Error); assert.match(error.message, /unavailable/iu); assert.match(error.message, /sample remove failed/u); return true; });
});
test('Motion AE Gaussian capture requires explicit review, exact host marker, empty masks and both selected scalar paths', () => {
	const state = fixture(), sample = prepareMotionAeGaussianCalibration(state.host);
	assert.throws(() => captureMotionAeGaussianCalibration(sample, state.host, false, 2), /review/iu);
	assert.throws(() => captureMotionAeGaussianCalibration(sample, { ...state.host, identity: { ...gaussianHost, buildNumber: 99 } }, true, 2), /host/iu);
	state.state.maskCount = 1; assert.throws(() => captureMotionAeGaussianCalibration(sample, state.host, true, 2), /mask|inventory/iu); state.state.maskCount = 0;
	for (const selection of [[], [['reviewed-radius']], [['reviewed-radius'], ['reviewed-repeat']]]) { state.select(selection); assert.throws(() => captureMotionAeGaussianCalibration(sample, state.host, true, 2), /Select|selected|Opacity/u); }
	assert.deepEqual(state.controls.writes, []);
});

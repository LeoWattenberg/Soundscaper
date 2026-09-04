/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EFFECT_MACRO_STEP_DEFINITIONS,
	createEffectMacroStep,
	effectMacroStepTypes,
	isEffectMacroStepType,
	isRealtimeEffectMacroStepType,
	normalizeEffectMacroStep,
} from '../src/common/editor/effect-macro-steps.ts';
import { audioEffectTypes, audioSelectionEffectTypes } from '../src/common/editor/effects.js';

test('a macro step accepts every rack effect and every selection effect', () => {
	const types = new Set(effectMacroStepTypes());
	for (const type of audioEffectTypes() as readonly string[]) assert.ok(types.has(type), type);
	for (const type of audioSelectionEffectTypes() as readonly string[]) assert.ok(types.has(type), type);
	assert.equal(types.size, Object.keys(EFFECT_MACRO_STEP_DEFINITIONS).length);
});

test('the rack effects keep their order ahead of the offline-only effects', () => {
	const types = effectMacroStepTypes();
	assert.deepEqual(types.slice(0, audioEffectTypes().length), audioEffectTypes());
	assert.ok(types.includes('audacity-amplify'));
	assert.ok(types.indexOf('audacity-amplify') >= audioEffectTypes().length);
});

test('only rack effects report as realtime steps', () => {
	assert.equal(isRealtimeEffectMacroStepType('compressor'), true);
	assert.equal(isRealtimeEffectMacroStepType('audacity-limiter'), true);
	assert.equal(isRealtimeEffectMacroStepType('audacity-amplify'), false);
	assert.equal(isEffectMacroStepType('audacity-amplify'), true);
	assert.equal(isEffectMacroStepType('audacity-not-an-effect'), false);
});

test('an offline macro step normalizes to its effect defaults', () => {
	const step = createEffectMacroStep('audacity-normalize', { id: 'effect-1' });
	assert.deepEqual(step, {
		id: 'effect-1',
		type: 'audacity-normalize',
		enabled: true,
		params: { peakDb: -1, removeDc: true, applyGain: true, stereoIndependent: false },
	});
});

test('an offline macro step keeps the parameters it is given', () => {
	const step = createEffectMacroStep('audacity-amplify', { id: 'effect-2', params: { gainDb: 3 } });
	assert.equal(step.params.gainDb, 3);
	assert.equal(step.params.allowClipping, false);
});

test('an offline macro step rejects an out-of-range parameter', () => {
	assert.throws(
		() => createEffectMacroStep('audacity-repeat', { id: 'effect-3', params: { count: 0 } }),
		/count/,
	);
});

test('an offline macro step carries no rack context', () => {
	assert.throws(
		() => createEffectMacroStep('audacity-amplify', { id: 'effect-4', context: { noiseProfile: {} } }),
		/carries no rack context/,
	);
});

test('a rack macro step is still built by the rack factory', () => {
	const step = createEffectMacroStep('audacity-noise-reduction', {
		id: 'effect-5',
		context: { noiseProfile: { type: 'audacity-noise-profile' } },
	});
	assert.equal(step.type, 'audacity-noise-reduction');
	assert.deepEqual(step.context, { noiseProfile: { type: 'audacity-noise-profile' } });
});

test('an unknown macro effect is rejected', () => {
	assert.throws(() => createEffectMacroStep('nope'), /Unsupported macro effect/);
	assert.throws(() => normalizeEffectMacroStep(null), /An effect is required/);
});

test('a stored offline step round-trips through normalization', () => {
	const step = createEffectMacroStep('audacity-change-pitch', { id: 'effect-6' });
	assert.deepEqual(normalizeEffectMacroStep(step), step);
});

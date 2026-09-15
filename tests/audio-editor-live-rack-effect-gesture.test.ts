/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffect } from '../src/common/editor/effects.js';
import { supportsLiveRackEffectGesture } from '../src/common/editor/ui/inspector/live-rack-effect-gesture.ts';

const convertedTypes = [
	'multi-tap-delay', 'highpass-filter', 'lowpass-filter', 'noise-gate',
	'notch-filter', 'shelf-filter', 'tremolo', 'vocoder',
] as const;

for (const type of convertedTypes) {
	test(`${type} uses live rack gestures while its processor is active`, () => {
		const effect = createEffect(type);
		assert.equal(supportsLiveRackEffectGesture(effect, { effectsActive: true }), true);
		assert.equal(supportsLiveRackEffectGesture(effect, {}), true);
		assert.equal(supportsLiveRackEffectGesture({ ...effect, enabled: false }, {}), false);
		assert.equal(supportsLiveRackEffectGesture({ ...effect, bypassed: true }, {}), false);
		assert.equal(supportsLiveRackEffectGesture(effect, { effectsActive: false }), false);
	});
}

test('converted Delay can change from completely dry without rebuilding its live processor', () => {
	const effect = createEffect('multi-tap-delay', { params: { mix: 0 } });
	assert.equal(supportsLiveRackEffectGesture(effect, {}), true);
});

test('Feedback delay retains its positive mix requirement for live gestures', () => {
	assert.equal(supportsLiveRackEffectGesture(createEffect('delay'), {}), true);
	for (const mix of [0, -1, 'invalid']) {
		assert.equal(supportsLiveRackEffectGesture({ type: 'delay', params: { mix } }, {}), false);
	}
	assert.equal(supportsLiveRackEffectGesture({ type: 'delay', params: { mix: '0.25' } }, {}), true);
	assert.equal(supportsLiveRackEffectGesture({ type: 'delay', enabled: false, params: { mix: 1 } }, {}), false);
	assert.equal(supportsLiveRackEffectGesture({ type: 'delay', params: { mix: 1 } }, { effectsActive: false }), false);
});

test('missing and unrelated processors keep their existing parameter update path', () => {
	assert.equal(supportsLiveRackEffectGesture(null, {}), false);
	assert.equal(supportsLiveRackEffectGesture(undefined, undefined), false);
	for (const type of ['missing', 'reverb', 'gate', 'highpass', 'nyquist:tremolo']) {
		assert.equal(supportsLiveRackEffectGesture({ type, params: { mix: 1 } }, {}), false);
	}
});

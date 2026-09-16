/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audioEffectLabel, audioEffectTypes, audioSelectionEffectLabel,
	audioSelectionEffectTypes, normalizeEffect,
} from '../src/common/editor/effects.js';
import {
	effectMacroStepTypes, normalizeEffectMacroStep,
} from '../src/common/editor/effect-macro-steps.ts';

test('effect and macro pickers offer only the Audacity Compressor and Limiter', () => {
	for (const types of [audioEffectTypes(), audioSelectionEffectTypes(), effectMacroStepTypes()]) {
		assert.equal(types.includes('compressor'), false);
		assert.equal(types.includes('limiter'), false);
		assert.equal(types.includes('audacity-compressor'), true);
		assert.equal(types.includes('audacity-limiter'), true);
	}
	for (const [type, label, german] of [
		['audacity-compressor', 'Compressor', 'Kompressor'],
		['audacity-limiter', 'Limiter', 'Limiter'],
	]) {
		assert.equal(audioEffectLabel(type), label);
		assert.equal(audioSelectionEffectLabel(type), label);
		assert.equal(audioEffectLabel(type, 'de'), german);
		assert.equal(audioSelectionEffectLabel(type, 'de'), german);
		assert.equal(audioEffectTypes().filter(candidate => audioEffectLabel(candidate) === label).length, 1);
	}
});

test('saved native dynamics retain their settings and playback identity', () => {
	for (const effect of [
		{
			id: 'saved-compressor', type: 'compressor', enabled: false,
			params: { threshold: -18, knee: 8, ratio: 6, attack: 0.012, release: 0.24, makeupGain: 2 },
		},
		{
			id: 'saved-limiter', type: 'limiter', enabled: true,
			params: { ceiling: -4, lookahead: 0.003, release: 0.15 },
		},
	]) {
		assert.deepEqual(normalizeEffect(effect), effect);
		assert.deepEqual(normalizeEffectMacroStep(effect), effect);
	}
});

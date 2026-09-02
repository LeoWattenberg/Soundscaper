/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EFFECT_MACRO_TEMPLATE_IDS,
	createEffectMacroTemplateDraft,
	effectMacroMissingEmbeddedNoiseProfile,
} from '../src/common/editor/effect-macro-templates.ts';

test('the built-in Restoration template is an ordered editable macro with canonical defaults', () => {
	let sequence = 0;
	const draft = createEffectMacroTemplateDraft('restoration', {
		idFactory: (prefix) => `${prefix}-${++sequence}`,
	});

	assert.deepEqual(EFFECT_MACRO_TEMPLATE_IDS, ['restoration']);
	assert.equal(draft.id, 'macro-1');
	assert.equal(draft.name, 'Restoration');
	assert.deepEqual(draft.effects.map(({ id, type }) => ({ id, type })), [
		{ id: 'effect-2', type: 'audacity-click-removal' },
		{ id: 'effect-3', type: 'audacity-noise-reduction' },
		{ id: 'effect-4', type: 'audacity-filter-curve-eq' },
	]);
	assert.deepEqual(draft.effects.map(({ params }) => params), [
		{ threshold: 200, maximumWidth: 20 },
		{ reductionDb: 6, sensitivity: 6, frequencySmoothingBands: 6, output: 'reduce' },
		{
			points: [{ frequency: 20, gain: 0 }, { frequency: 20_000, gain: 0 }],
			filterLength: 8_191,
			linearFrequencyScale: false,
		},
	]);
	assert.equal(effectMacroMissingEmbeddedNoiseProfile(draft.effects), true);
	assert.ok(Object.isFrozen(draft));
	assert.ok(Object.isFrozen(draft.effects));
});

test('macro profile admission requires a serialized profile on every Noise Reduction step', () => {
	const draft = createEffectMacroTemplateDraft('restoration', {
		idFactory: (prefix, index = 0) => `${prefix}-${index}`,
	});
	const profile = Object.freeze({
		type: 'audacity-noise-profile',
		version: 1,
		sampleRate: 48_000,
		windowSize: 2_048,
		stepsPerWindow: 4,
		windowType: 'hann-hann',
		channelCount: 1,
		windowCount: 2,
		meanPowers: Object.freeze(Array.from({ length: 1_025 }, () => 0.25)),
	});
	const effects = draft.effects.map((effect) => effect.type === 'audacity-noise-reduction'
		? Object.freeze({ ...effect, context: Object.freeze({ noiseProfile: profile }) })
		: effect);

	assert.equal(effectMacroMissingEmbeddedNoiseProfile(effects), false);
	assert.equal(effectMacroMissingEmbeddedNoiseProfile([
		...effects,
		{ ...effects[1]!, id: 'second-noise', context: undefined },
	]), true);
	assert.throws(
		() => createEffectMacroTemplateDraft('unknown' as never),
		/unknown effect macro template/iu,
	);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CREATIVE_EFFECT_GUIDES, DYNAMICS_EFFECT_GUIDES, REPAIR_EFFECT_GUIDES } from '../handbook/guides/soundscaper/production-effects.mjs';
import { GUIDE_FIXTURES } from '../handbook/guides/fixtures.mjs';
import { validateGuide } from '../handbook/guides/steps.mjs';

const all = [...CREATIVE_EFFECT_GUIDES, ...REPAIR_EFFECT_GUIDES, ...DYNAMICS_EFFECT_GUIDES];

test('production effect guides cover the six reader tasks with browser-replayable selection scopes', () => {
	assert.deepEqual(CREATIVE_EFFECT_GUIDES.map(({ id }) => id), [
		'apply-tremolo', 'apply-bitcrusher', 'make-a-vocoder-effect', 'add-multi-tap-delay',
	]);
	assert.deepEqual(REPAIR_EFFECT_GUIDES.map(({ id }) => id), ['reduce-sibilance-with-a-de-esser']);
	assert.deepEqual(DYNAMICS_EFFECT_GUIDES.map(({ id }) => id), ['compress-frequency-bands-independently']);
	assert.equal(all.length, 6);
	for (const guide of all) {
		validateGuide(guide, GUIDE_FIXTURES);
		assert.equal((guide.intro.match(/[.!?](?:\s|$)/gu) || []).length, 2, `${guide.id} needs a two-sentence introduction`);
		assert.equal(guide.tips.length, 2, `${guide.id} needs two practical tips`);
		assert.ok(guide.steps.some(({ kind, path }) => kind === 'menu' && path[0] === 'Select' && path[1] === 'Select all'), `${guide.id} must explicitly scope the selection`);
		assert.ok(guide.steps.some(({ kind }) => kind === 'effect'), `${guide.id} must apply its effect from the Effect menu`);
		assert.ok(guide.steps.some(({ kind }) => kind === 'play' || kind === 'check'), `${guide.id} must verify its result`);
	}
});

test('each production effect guide names the current UI path and its essential control', () => {
	const expected = new Map([
		['apply-tremolo', ['Distortion and modulation', 'Tremolo', 'Depth']],
		['apply-bitcrusher', ['Distortion and modulation', 'Bitcrusher', 'Bit depth']],
		['make-a-vocoder-effect', ['Distortion and modulation', 'Vocoder', 'Vocoder bands']],
		['add-multi-tap-delay', ['Delay and reverb', 'Delay', 'Number of echoes']],
		['reduce-sibilance-with-a-de-esser', ['Noise removal and repair', 'De-esser', 'Frequency']],
		['compress-frequency-bands-independently', ['Volume and compression', 'Multiband compressor', 'Low ratio']],
	]);
	for (const guide of all) {
		const [group, name, field] = expected.get(guide.id);
		const step = guide.steps.find(({ kind, name: effectName }) => kind === 'effect' && effectName === name);
		assert.ok(step, `${guide.id} applies ${name}`);
		assert.equal(step.group, group);
		assert.ok(step.settings.some(({ label }) => label === field), `${guide.id} configures ${field}`);
	}
});

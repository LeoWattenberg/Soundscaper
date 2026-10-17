/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { GLOBAL_DEVELOP_PROCESS_V1, GLOBAL_DEVELOP_EFFECT_TYPES_V1, normalizeGlobalDevelopEffectV1,
	normalizeGlobalDevelopParamsV1, prepareGlobalDevelopEffectV1 } from '../src/common/editor/video-global-develop-v1.ts';
import { createVideoEffect, VIDEO_EFFECT_TYPES, VIDEO_EFFECT_V5_TYPES, normalizeVideoEffect,
	serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { videoEffectPasses, EFFECT_CODES, EFFECT_PROGRAM_COUNT } from '../src/common/editor/ui/video-preview-effects.js';
import { FRAGMENT_SHADER_SOURCE } from '../src/common/editor/ui/video-preview-effects-shader.js';
import { defaultPhotoDevelopV1, normalizePhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';

test('versioned global processes append exactly two authorable effects without changing the old profiles', () => {
	assert.equal(GLOBAL_DEVELOP_PROCESS_V1, 'linear-srgb-global-v1');
	assert.deepEqual(GLOBAL_DEVELOP_EFFECT_TYPES_V1, ['white-balance-v1', 'tone-ladder-v1']);
	assert.deepEqual(VIDEO_EFFECT_TYPES.slice(12, 14), GLOBAL_DEVELOP_EFFECT_TYPES_V1);
	assert.deepEqual(VIDEO_EFFECT_V5_TYPES, ['color-adjust', 'pixelate', 'vignette', 'gaussian-blur', 'sharpen', 'rgb-split']);
	assert.deepEqual(createVideoEffect('white-balance-v1', { id: 'white' }).params, { temperature: 0, tint: 0 });
	assert.deepEqual(createVideoEffect('tone-ladder-v1', { id: 'tone' }).params,
		{ exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 });
	assert.throws(() => normalizeVideoEffect(createVideoEffect('tone-ladder-v1'), 'old', { allowedTypes: VIDEO_EFFECT_V5_TYPES }), /not supported/u);
});

test('complete shared recipes are detached, closed and strictly range checked even when disabled', () => {
	const input = createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } });
	const output = normalizeGlobalDevelopEffectV1(input); Object.assign(input.params, { exposure: 3 });
	assert.equal(output.params.exposure, 1); assert.equal(Object.isFrozen(output), true); assert.equal(Object.isFrozen(output.params), true);
	let getters = 0;
	const params = Object.defineProperty({}, 'exposure', { enumerable: true, get() { getters++; return 1; } });
	for (const value of [{ ...input, future: 1 }, { ...input, enabled: false, params }, { ...input, params: null },
		{ ...input, params: undefined }, { ...input, id: 'x'.repeat(129) }, { ...input, type: 'tone-ladder-v2' }]) {
		assert.throws(() => prepareGlobalDevelopEffectV1(value));
	}
	for (const [key, outside] of [['exposure', 5.01], ['contrast', 101], ['highlights', -101], ['shadows', 101], ['whites', -101], ['blacks', 101]] as const) {
		assert.throws(() => normalizeGlobalDevelopParamsV1('tone-ladder-v1', { [key]: outside }));
	}
	for (const params of [{ temperature: -101 }, { tint: 101 }, { temperature: Infinity }, { tint: '1' }, { constructor: 1 }]) {
		assert.throws(() => normalizeGlobalDevelopParamsV1('white-balance-v1', params));
	}
	assert.equal(getters, 0);
});

test('new-family authoring and normalization refuse identities that the renderer cannot admit', () => {
	for (const type of GLOBAL_DEVELOP_EFFECT_TYPES_V1) {
		assert.throws(() => createVideoEffect(type, { id: 'x'.repeat(129) }));
		assert.throws(() => normalizeVideoEffect({ ...createVideoEffect(type), id: 'x'.repeat(129) }));
	}
	const legacy = createVideoEffect('pixelate', { id: 'x'.repeat(129) });
	assert.equal(normalizeVideoEffect(legacy).id.length, 129);
});

test('the admitted Lightscaper recipe retains the identical shared version and settings', () => {
	const effects = [createVideoEffect('white-balance-v1', { id: 'white', params: { temperature: -40, tint: 30 } }),
		createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 0.5, highlights: -20, blacks: 10 } })];
	const develop = normalizePhotoDevelopV1({ ...defaultPhotoDevelopV1(), effects });
	assert.deepEqual(develop.effects, effects); Object.assign(effects[0]!.params, { temperature: 100 });
	assert.equal(develop.effects[0]?.params.temperature, -40);
});

test('preview passes carry fixed linear coefficients and reserve distinct shader programs', () => {
	const white = createVideoEffect('white-balance-v1', { id: 'white', params: { temperature: 100 } });
	const tone = createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1, contrast: 50, highlights: -100, shadows: 100, whites: -100, blacks: 100 } });
	assert.deepEqual(videoEffectPasses(white), [{ code: 18, params0: [2, 1, 0.5, 0], params1: [0, 0, 0, 0], direction: [0, 0] }]);
	assert.deepEqual(videoEffectPasses(tone), [{ code: 19, params0: [2, 2, -0.25, 0.25], params1: [-0.25, 0.25, 0, 0], direction: [0, 0] }]);
	assert.equal(EFFECT_PROGRAM_COUNT, 34); assert.equal(EFFECT_CODES['white-balance-v1'], 18); assert.equal(EFFECT_CODES['tone-ladder-v1'], 19);
	assert.equal(EFFECT_CODES['color-wheels-v1'], 26); assert.equal(EFFECT_CODES['detail-sharpen-v1'], 27);
	assert.equal(EFFECT_CODES['post-crop-vignette-v1'], 28);
	assert.equal(EFFECT_CODES['clarity-v1'], 29);
	assert.equal(EFFECT_CODES['noise-reduction-v1'], 30);
	assert.equal(EFFECT_CODES['grain-v1'], 31);
	assert.equal(EFFECT_CODES['texture-v1'], 32);
	assert.match(FRAGMENT_SHADER_SOURCE, /color\.rgb = global_develop_rgb/u);
	assert.match(FRAGMENT_SHADER_SOURCE, /uniform sampler2D u_global_lookup/u);
	assert.match(FRAGMENT_SHADER_SOURCE, /texelFetch\(u_global_lookup/u);
	assert.deepEqual(videoEffectPasses(createVideoEffect('tone-ladder-v1')), []);
	assert.deepEqual(videoEffectPasses({ ...white, enabled: false }), []);
});

test('export expressions use the same linear coefficients and preserve alpha explicitly without external code', () => {
	const effects = [createVideoEffect('white-balance-v1', { params: { temperature: 100 } }),
		createVideoEffect('tone-ladder-v1', { params: { exposure: 1, contrast: 50, highlights: -100, shadows: 100, whites: -100, blacks: 100 } })];
	const operations = serializeVideoEffectsToFfmpegOperations(effects).map(operation => {
		assert.ok('expression' in operation && 'preserveAlpha' in operation); return operation;
	});
	assert.equal(operations.length, 2);
	for (const operation of operations) {
		assert.equal(operation.preserveAlpha, true); assert.match(operation.expression, /^format=pix_fmts=gbrap,geq=r=/u);
		assert.match(operation.expression, /a='alpha\(X,Y\)':interpolation=nearest,format=pix_fmts=rgba$/u);
		assert.match(operation.expression, /0\.04045/u); assert.match(operation.expression, /0\.0031308/u);
		assert.match(operation.expression, /floor\(255\*clip/u);
	}
	assert.match(operations[0]!.expression, /ld\(0\)\*2/u); assert.match(operations[0]!.expression, /ld\(0\)\*0\.5/u);
	assert.match(operations[1]!.expression, /\(ld\(0\)\*2-0\.18\)\*2\+0\.18/u);
	assert.deepEqual(serializeVideoEffectsToFfmpegOperations([createVideoEffect('tone-ladder-v1')]), []);
	assert.throws(() => serializeVideoEffectsToFfmpegOperations([{ ...effects[1], params: { exposure: 'movie=untrusted' } }]));
});

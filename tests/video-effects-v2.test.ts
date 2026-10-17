/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { VIDEO_EFFECT_TYPES, createVideoEffect, normalizeVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1 } from '../src/common/editor/video-cube-lut-profile-v1.ts';
import { VIDEO_EFFECT_TYPES_V2, createVideoEffectV2, normalizeVideoEffectV2, normalizeVideoEffectsV2,
	updateVideoEffectV2, videoEffectDefinitionV2, videoEffectDefaultsV2 } from '../src/common/editor/video-effects-v2.ts';

function reference() {
	return { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 73,
		size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}
function cube(lut: unknown = reference(), enabled = true) {
	return { id: 'cube', type: CUBE_LUT_PROFILE_EFFECT_TYPE_V1, enabled, params: { lut } };
}

test('explicit V2 registry appends only a resource-dependent cube profile while old registry and creation bytes remain unchanged', () => {
	assert.deepEqual(VIDEO_EFFECT_TYPES_V2, [...VIDEO_EFFECT_TYPES, CUBE_LUT_PROFILE_EFFECT_TYPE_V1]);
	for (const [index, type] of VIDEO_EFFECT_TYPES.entries()) {
		const options = { id: `old-${String(index)}` };
		assert.deepEqual(createVideoEffectV2(type, options), createVideoEffect(type, options));
		assert.deepEqual(normalizeVideoEffectV2(createVideoEffect(type, options)), normalizeVideoEffect(createVideoEffect(type, options)));
	}
	const definition = videoEffectDefinitionV2(CUBE_LUT_PROFILE_EFFECT_TYPE_V1);
	assert.equal(definition.resourceDependent, true);
	assert.equal(definition.shader, null);
	assert.equal(definition.ffmpegFilter, null);
	assert.equal(definition.params.lut?.control, 'cube-lut');
	assert.deepEqual(videoEffectDefaultsV2(CUBE_LUT_PROFILE_EFFECT_TYPE_V1), { lut: null });
});

test('cube creation uses explicit null while supplied persisted envelopes remain complete and closed', () => {
	assert.deepEqual(createVideoEffectV2(CUBE_LUT_PROFILE_EFFECT_TYPE_V1, { id: 'cube' }), cube(null));
	for (const value of [{ ...cube(), params: {} }, { ...cube(), params: undefined }, { ...cube(), extra: true },
		{ ...cube(), params: { lut: reference(), amount: 1 } }, { ...cube(), id: 'x'.repeat(129) }]) {
		assert.throws(() => normalizeVideoEffectV2(value));
	}
	for (const options of [{ extra: true }, { enabled: 1 }, { type: 'tone-ladder-v1' }, { params: { lut: undefined } }, { index: -1 }]) {
		assert.throws(() => createVideoEffectV2(CUBE_LUT_PROFILE_EFFECT_TYPE_V1, options));
	}
	assert.throws(() => createVideoEffect(CUBE_LUT_PROFILE_EFFECT_TYPE_V1), /Unsupported/iu);
	for (const value of [cube(), cube(null), cube(reference(), false)]) {
		assert.throws(() => normalizeVideoEffect(value), /Unsupported/iu);
		assert.throws(() => serializeVideoEffectsToFfmpegOperations([value]), /Unsupported/iu);
	}
});

test('active and disabled references are detached and frozen, and discrete clear/toggle retain exact other fields', () => {
	const raw = reference();
	const value = createVideoEffectV2(CUBE_LUT_PROFILE_EFFECT_TYPE_V1, { id: 'cube', enabled: false, params: { lut: raw } });
	raw.domainMin[0] = -1;
	assert.deepEqual(value, cube(reference(), false));
	assert.equal(Object.isFrozen(value), true);
	assert.equal(Object.isFrozen(value.params), true);
	const lut = value.params.lut;
	assert.equal(typeof lut === 'object' && lut !== null && Object.isFrozen(lut), true);
	assert.deepEqual(updateVideoEffectV2(value, { enabled: true }), cube());
	assert.deepEqual(updateVideoEffectV2(value, { params: { lut: null } }), cube(null, false));
	assert.throws(() => updateVideoEffectV2(value, { params: { lut: reference(), body: 'private' } }));
});

test('dense bounded V2 arrays preserve authored order and refuse duplicate IDs, missing slots and shadowed methods', () => {
	const tone = createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } });
	assert.deepEqual(normalizeVideoEffectsV2([tone, cube()]).map(effect => effect.id), ['tone', 'cube']);
	assert.throws(() => normalizeVideoEffectsV2([cube(), cube(null)]), /duplicate/iu);
	const sparse = new Array<unknown>(1);
	assert.throws(() => normalizeVideoEffectsV2(sparse));
	let calls = 0;
	const shadow = Object.assign([cube()], { map() { calls++; return []; } });
	assert.throws(() => normalizeVideoEffectsV2(shadow));
	assert.equal(calls, 0);
	assert.throws(() => normalizeVideoEffectsV2(new Array<unknown>(100_001)));
	assert.throws(() => normalizeVideoEffectV2(cube(), 'effect', { allowedTypes: ['tone-ladder-v1'] }));
});

test('new family dispatch and creation never invoke caller getters and preserve opaque reflection failure identity', () => {
	let inspected = 0;
	const type = Object.defineProperty(cube(), 'type', { enumerable: true, get() { inspected++; throw new Error('type getter'); } });
	const params = Object.defineProperty({}, 'params', { enumerable: true, get() { inspected++; throw new Error('params getter'); } });
	assert.throws(() => normalizeVideoEffectV2(type));
	assert.throws(() => createVideoEffectV2(CUBE_LUT_PROFILE_EFFECT_TYPE_V1, params));
	const reason = new Proxy({}, { get() { inspected++; throw new Error('opaque get'); },
		getOwnPropertyDescriptor() { inspected++; throw new Error('opaque descriptor'); }, getPrototypeOf() { inspected++; throw new Error('opaque prototype'); } });
	let observed: unknown;
	try { normalizeVideoEffectV2(new Proxy(cube(), { ownKeys() { throw reason; } })); }
	catch (error) { observed = error; }
	assert.equal(observed, reason);
	assert.equal(inspected, 0);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const reference = () => ({ storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64), byteLength: 88,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
const profile = (enabled = true) => ({ id: 'profile', type: 'cube-lut-profile-v1', enabled, params: { lut: reference() } });
const empty = () => ({ ...defaultImageDevelopStateV1(), processVersion: 2 });

test('the explicit process2 owner keeps legacy process1 serialization and dispatch unchanged', () => {
	const previous = { ...defaultImageDevelopStateV1(), effects: [createVideoEffect('grain-v1', { params: { seed: 65520 } }),
		createVideoEffect('point-curves-v1', { params: { red: [{ x: 0, y: 0.125 }, { x: 1, y: 0.875 }] } })] };
	const expected = JSON.stringify(normalizeImageDevelopStateV1(previous));
	assert.equal(JSON.stringify(normalizeImageDevelopStateV1OrV2(previous)), expected);
	assert.deepEqual(defaultImageDevelopStateV2(), empty());
	assert.throws(() => normalizeImageDevelopStateV1(empty()));
	assert.throws(() => normalizeImageDevelopStateV2(previous));
	for (const processVersion of [0, 3, '2', null]) assert.throws(() => normalizeImageDevelopStateV1OrV2({ ...empty(), processVersion }));
});

test('process2 admits verified reference envelopes in authored order beside existing scalar and curve owners', () => {
	const raw = profile(), before = { id: 'before', type: 'dehaze-v1', enabled: true, params: { amount: 37.125 } };
	const after = createVideoEffect('point-curves-v1', { id: 'after', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	const state = normalizeImageDevelopStateV2({ ...empty(), effects: [before, raw, after] });
	assert.deepEqual(state.effects.map(effect => effect.id), ['before', 'profile', 'after']);
	assert.deepEqual(state.effects[1], raw);
	raw.params.lut.domainMin[0] = -1; before.params.amount = 0;
	assert.deepEqual(state.effects[1]?.params.lut, reference());
	assert.equal(state.effects[0]?.params.amount, 37.125);
	assert.ok(Object.isFrozen(state) && Object.isFrozen(state.effects) && Object.isFrozen(state.effects[1]?.params));
	assert.equal(JSON.stringify(normalizeImageDevelopStateV1OrV2(state)), JSON.stringify(state));
	assert.throws(() => normalizeImageDevelopStateV1({ ...state, processVersion: 1 }));
});

test('disabled profiles retain reachable references while null profiles retain explicit neutral process2 state', () => {
	const disabled = profile(false), neutral = { ...profile(), id: 'neutral', params: { lut: null } };
	const state = normalizeImageDevelopStateV2({ ...empty(), effects: [disabled, neutral] });
	assert.deepEqual(state.effects[0]?.params.lut, reference());
	assert.deepEqual(state.effects[1]?.params, { lut: null });
	assert.equal(state.processVersion, 2);
});

test('process2 shares original geometry and validates mask references against every real effect ID', () => {
	const state = normalizeImageDevelopStateV2({ ...empty(), effects: [profile()], geometry: {
		crop: { x: 0.25, y: 0, width: 0.5, height: 1 }, rotationDegrees: -37.125, flipHorizontal: true, flipVertical: false },
		masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [],
			nodes: [{ id: 'rectangle', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'rectangle' }],
		maskBindings: [{ effectId: 'profile', maskId: 'mask' }] });
	assert.deepEqual(state.maskBindings, [{ effectId: 'profile', maskId: 'mask' }]);
	assert.equal(state.geometry.rotationDegrees, -37.125);
	assert.throws(() => normalizeImageDevelopStateV2({ ...state, maskBindings: [{ effectId: 'missing', maskId: 'mask' }] }));
	assert.throws(() => normalizeImageDevelopStateV2({ ...state, maskBindings: [{ effectId: 'profile', maskId: 'missing' }] }));
	assert.throws(() => normalizeImageDevelopStateV2({ ...state, geometry: { ...state.geometry, crop: { x: 0.75, y: 0, width: 0.5, height: 1 } } }));
});

test('process2 refuses raw LUT bodies, malformed references, foreign effects and duplicate identities', () => {
	for (const effect of [{ ...profile(), params: { lut: 'LUT_3D_SIZE 2' } },
		{ ...profile(), params: { lut: { ...reference(), storageKey: 'foreign' } } },
		{ ...profile(), params: { lut: reference(), body: new Uint8Array(88) } },
		{ ...profile(), type: 'cube-lut-profile-v2' }]) {
		assert.throws(() => normalizeImageDevelopStateV2({ ...empty(), effects: [effect] }));
	}
	assert.throws(() => normalizeImageDevelopStateV2({ ...empty(), effects: [profile(), profile()] }));
	assert.throws(() => normalizeImageDevelopStateV2({ ...empty(), extra: true }));
});

test('process2 keeps closed own-data and fixed effect limits without reading accessors', () => {
	let calls = 0;
	const accessor = Object.defineProperty({ ...empty() }, 'processVersion', { enumerable: true, get() { calls++; return 2; } });
	assert.throws(() => normalizeImageDevelopStateV1OrV2(accessor));
	const lut = Object.defineProperty({ ...reference() }, 'sha256', { enumerable: true, get() { calls++; return '4'.repeat(64); } });
	assert.throws(() => normalizeImageDevelopStateV2({ ...empty(), effects: [{ ...profile(), params: { lut } }] }));
	assert.equal(calls, 0);
	assert.throws(() => normalizeImageDevelopStateV2({ ...empty(), effects: Array.from({ length: 257 }, (_, index) => ({ ...profile(), id: `profile-${String(index)}` })) }));
	const sparse = Array.from({ length: 2 }, () => profile());
	delete sparse[0];
	assert.throws(() => normalizeImageDevelopStateV2({ ...empty(), effects: sparse }));
	assert.throws(() => normalizeImageDevelopStateV2({ ...empty(), effects: [{ ...profile(), id: 'invalid id' }] }));
});

test('future shared cube registration cannot widen the legacy process1 parameter vocabulary', () => {
	const ownerUrl = new URL('../src/common/editor/video-cube-lut-profile-v1.ts', import.meta.url).href;
	const stateUrl = new URL('../src/common/editor/imaging/image-develop-state-v1.ts', import.meta.url).href;
	const registryUrl = new URL('../src/common/editor/video-effects.js', import.meta.url).href;
	const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
		import assert from 'node:assert/strict';
		import { registerHooks } from 'node:module';
		const owner = ${JSON.stringify(ownerUrl)};
		registerHooks({ load(url, context, next) {
			if (url !== ${JSON.stringify(registryUrl)}) return next(url, context);
			return { format: 'module', shortCircuit: true, source:
				'import { normalizeCubeLutProfileEffectV1 } from ' + JSON.stringify(owner) + ';' +
				'export function normalizeVideoEffects(effects) { return effects.map(normalizeCubeLutProfileEffectV1); }' };
		} });
		const { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } = await import(${JSON.stringify(stateUrl)});
		for (const enabled of [false, true]) for (const lut of [null, ${JSON.stringify(reference())}]) {
			assert.throws(() => normalizeImageDevelopStateV1({ ...defaultImageDevelopStateV1(), effects: [
				{ id: 'profile', type: 'cube-lut-profile-v1', enabled, params: { lut } }
			] }), /process version 2/);
		}
	`], { encoding: 'utf8', timeout: 10_000 });
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

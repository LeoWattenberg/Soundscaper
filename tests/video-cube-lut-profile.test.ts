/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CUBE_LUT_PROFILE_EFFECT_TYPE_V1, CUBE_LUT_PROFILE_PROCESS_V1,
	normalizeCubeLutProfileParamsV1, normalizeCubeLutProfileEffectV1,
	prepareCubeLutProfileResourcePlanV1, assertCubeLutProfileResourcePlanV1,
	cubeLutProfileResourceRequirementV1,
} from '../src/common/editor/video-cube-lut-profile-v1.ts';
import { normalizeVideoColorGradeV1 } from '../src/common/editor/video-color-management-v27.ts';

function reference() {
	return { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 73,
		size: 2, domainMin: [-1, 0, 0], domainMax: [1, 2, 3] };
}
function effect(lut: unknown = reference(), enabled = true) {
	return { id: 'profile-1', type: CUBE_LUT_PROFILE_EFFECT_TYPE_V1, enabled, params: { lut } };
}

test('explicit null default is neutral and retains one exact reference-only parameter', () => {
	const params = normalizeCubeLutProfileParamsV1();
	assert.deepEqual(params, { lut: null });
	assert.equal(Object.isFrozen(params), true);
	const normalized = normalizeCubeLutProfileEffectV1(effect(null));
	assert.equal(JSON.stringify(normalized), '{"id":"profile-1","type":"cube-lut-profile-v1","enabled":true,"params":{"lut":null}}');
	const plan = prepareCubeLutProfileResourcePlanV1(normalized);
	assert.equal(plan.neutral, true);
	assert.equal(plan.process, 'linear-rec709-d65-cube-trilinear-v27');
	assert.equal(cubeLutProfileResourceRequirementV1(plan), null);
});

test('active resource requirement is an immutable detached exact V27 reference, not parsed/body authority', () => {
	const input = effect(), raw = input.params.lut as ReturnType<typeof reference>;
	const expected = normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), lut: raw }).lut;
	const normalized = normalizeCubeLutProfileEffectV1(input);
	const plan = prepareCubeLutProfileResourcePlanV1(normalized);
	assert.deepEqual(plan.reference, expected);
	assert.equal(plan.reference, normalized.params.lut);
	assert.equal(cubeLutProfileResourceRequirementV1(plan), plan.reference);
	assert.equal(plan.neutral, false);
	assert.equal(plan.enabled, true);
	assert.equal(plan.effectId, input.id);
	assert.equal(plan.process, CUBE_LUT_PROFILE_PROCESS_V1);
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.reference?.domainMin), true);
	raw.sha256 = 'cd'.repeat(32); raw.domainMin[0] = -2;
	assert.equal(plan.reference?.sha256, 'ab'.repeat(32));
	assert.deepEqual(plan.reference?.domainMin, [-1, 0, 0]);
	assert.deepEqual(Object.keys(normalized.params), ['lut']);
	assert.equal(Object.hasOwn(plan, 'body'), false);
});

test('disabled profiles still authenticate and retain nonnull references for custody but require no render resource', () => {
	const plan = prepareCubeLutProfileResourcePlanV1(effect(reference(), false));
	assert.equal(plan.enabled, false);
	assert.equal(plan.neutral, false);
	assert.deepEqual(plan.reference, reference());
	assert.equal(cubeLutProfileResourceRequirementV1(plan), null);
	assert.throws(() => prepareCubeLutProfileResourcePlanV1(effect({ ...reference(), sha256: 'wrong' }, false)));
});

test('private normalized ownership reuses exact snapshots without admitting forged resource plans', () => {
	const params = normalizeCubeLutProfileParamsV1({ lut: reference() });
	assert.equal(normalizeCubeLutProfileParamsV1(params), params);
	const normalized = normalizeCubeLutProfileEffectV1({ ...effect(), params });
	assert.equal(normalizeCubeLutProfileEffectV1(normalized), normalized);
	const plan = prepareCubeLutProfileResourcePlanV1(normalized);
	assert.doesNotThrow(() => assertCubeLutProfileResourcePlanV1(plan));
	let inspected = 0;
	const proxy = new Proxy(plan, { get() { inspected++; throw new Error('forged get'); },
		getPrototypeOf() { inspected++; throw new Error('forged prototype'); },
		getOwnPropertyDescriptor() { inspected++; throw new Error('forged descriptor'); } });
	for (const forged of [{ ...plan }, JSON.parse(JSON.stringify(plan)) as unknown, proxy, null, {}]) {
		assert.throws(() => cubeLutProfileResourceRequirementV1(forged), /owning/iu);
		assert.throws(() => assertCubeLutProfileResourcePlanV1(forged), /owning/iu);
	}
	assert.equal(inspected, 0);
});

test('closed effect and params refuse unknown keys, accessors, invalid IDs and implicit persisted defaults', () => {
	let getters = 0;
	const accessor = Object.defineProperty({ ...effect() }, 'params', { enumerable: true,
		get() { getters++; throw new Error('params getter'); } });
	const refAccessor = Object.defineProperty(reference(), 'domainMin', { enumerable: true,
		get() { getters++; throw new Error('domain getter'); } });
	for (const value of [accessor, { ...effect(), id: '' }, { ...effect(), id: 'x'.repeat(129) },
		{ ...effect(), type: 'cube-lut-profile-v2' }, { ...effect(), enabled: 1 },
		{ ...effect(), params: undefined }, { ...effect(), params: {} }, { ...effect(), params: { lut: undefined } },
		{ ...effect(), params: { lut: null, amount: 0.5 } }, { ...effect(), extra: true }, effect(refAccessor),
		{ ...effect(), params: { lut: reference(), body: 'LUT_3D_SIZE 2' } }]) {
		assert.throws(() => prepareCubeLutProfileResourcePlanV1(value));
	}
	assert.equal(getters, 0);
});

test('the V27 tuple/scalar rules reject IEEE invalidity, wrong geometry, body strings and storage mismatch', () => {
	const changes = [{ storageKey: 'unverified' }, { sha256: 'AB'.repeat(32) }, { byteLength: 0 },
		{ byteLength: 16 * 1024 * 1024 + 1 }, { size: 1 }, { size: 66 },
		{ domainMin: [-0, 0, 0] }, { domainMin: [Number.NaN, 0, 0] },
		{ domainMax: [1, Number.POSITIVE_INFINITY, 3] }, { domainMin: [1, 0, 0] },
		{ domainMax: [1, 2] }, { domainMax: [1, 2, 3, 4] }, { domainMax: [1, 2, 65537] },
		{ values: [0, 0, 0] }];
	for (const change of changes) assert.throws(() => prepareCubeLutProfileResourcePlanV1(effect({ ...reference(), ...change })));
	for (const value of ['LUT_3D_SIZE 2', new Uint8Array(73), true, 0]) {
		assert.throws(() => prepareCubeLutProfileResourcePlanV1(effect(value)));
	}
});

test('domain endpoints and V27 canonical integer coercion retain the existing reference normalization exactly', () => {
	const input = { ...reference(), byteLength: '73', size: '2', domainMin: [-65536, 0, -Number.MIN_VALUE],
		domainMax: [65536, Number.MIN_VALUE, 0] };
	const plan = prepareCubeLutProfileResourcePlanV1(effect(input));
	assert.deepEqual(plan.reference, normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), lut: input }).lut);
	assert.equal(plan.reference?.byteLength, 73);
	assert.equal(plan.reference?.size, 2);
});

test('caller reflection failure remains opaque and no resource requirement is donated after refusal', () => {
	let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw new Error('reason get'); },
		getPrototypeOf() { traps++; throw new Error('reason prototype'); } });
	const input = new Proxy(effect(), { ownKeys() { throw reason; } });
	let caught: unknown;
	try { prepareCubeLutProfileResourcePlanV1(input); assert.fail('expected admission refusal'); }
	catch (error) { caught = error; }
	assert.equal(caught, reason);
	assert.equal(traps, 0);
});

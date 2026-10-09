/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createPhotoCubeLutClosureV1, PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1 } from '../src/lightscaper/catalog/photo-cube-lut-closure-v1.ts';

function reference(index = 1) {
	const sha256 = index.toString(16).padStart(64, '0');
	return { storageKey: `lut-sha256:${sha256}`, sha256, byteLength: 73, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}
function state(index = 1, enabled = true) {
	return { ...defaultImageDevelopStateV1(), processVersion: 2, effects: [{ id: `profile-${index}`, type: 'cube-lut-profile-v1', enabled, params: { lut: reference(index) } }] };
}

test('a scalar collector admits both explicit state versions without upgrading or retaining recipes', () => {
	const closure = createPhotoCubeLutClosureV1(), legacy = defaultImageDevelopStateV1(), bytes = JSON.stringify(legacy);
	closure.addDevelop(legacy); assert.equal(JSON.stringify(legacy), bytes);
	const active = state(2), disabled = state(1, false);
	closure.addDevelop(active); closure.addDevelop(disabled); closure.addDevelop(state(2));
	active.effects[0]!.params.lut.domainMin[0] = -1; disabled.effects.length = 0;
	const refs = closure.finish(); assert.deepEqual(refs, [reference(1), reference(2)]);
	assert.equal(Object.isFrozen(refs), true); assert.equal(Object.isFrozen(refs[0]!.domainMin), true);
	assert.equal(closure.finish(), refs);
	assert.throws(() => closure.addDevelop(state(3)), /sealed/iu);
});

test('neutral null retains no body while disabled and every explicitly delivered history/preset state retain theirs', () => {
	const closure = createPhotoCubeLutClosureV1();
	// The product walker will own enumeration. This leaf receives one admitted
	// state at a time, including inactive, redo, snapshot and partial settings.
	for (const index of [6, 4, 3, 2, 5, 1]) closure.addDevelop(state(index, index !== 4));
	closure.addDevelop({ ...state(), effects: [{ ...state().effects[0]!, params: { lut: null } }] });
	assert.deepEqual(closure.finish(), Array.from({ length: 6 }, (_, index) => reference(index + 1)));
});

test('same SHA with different complete reference geometry refuses without replacing its admitted identity', () => {
	const closure = createPhotoCubeLutClosureV1(); closure.addDevelop(state());
	for (const change of [{ size: 3 }, { byteLength: 74 }, { domainMin: [-1, 0, 0] }, { domainMax: [2, 1, 1] }]) {
		const value = state(); Object.assign(value.effects[0]!.params.lut, change);
		assert.throws(() => closure.addDevelop(value), /conflict/iu);
	}
	assert.deepEqual(closure.finish(), [reference()]);
});

test('old process1, future versions, unknown effects and malformed disabled resources keep closed owning admission', () => {
	const closure = createPhotoCubeLutClosureV1(); let calls = 0;
	const bad = Object.defineProperty(state(), 'effects', { enumerable: true, get() { calls++; return []; } });
	for (const value of [bad, { ...state(), processVersion: 1 }, { ...state(), processVersion: 3 },
		{ ...state(), extra: true }, { ...state(), effects: [{ ...state().effects[0]!, type: 'other-lut' }] },
		{ ...state(), effects: [{ ...state().effects[0]!, enabled: false, params: { lut: { ...reference(), storageKey: 'other' } } }] }]) {
		assert.throws(() => closure.addDevelop(value));
	}
	assert.equal(calls, 0); assert.deepEqual(closure.finish(), []);
});

test('caller reflection cannot deliver a state after sealing the collector during admission', () => {
	const closure = createPhotoCubeLutClosureV1(); let snapshot: ReturnType<typeof closure.finish> | null = null;
	const value = new Proxy(state(), { ownKeys(target) {
		snapshot = closure.finish(); return Reflect.ownKeys(target);
	} });
	assert.throws(() => closure.addDevelop(value), /sealed/iu);
	assert.deepEqual(snapshot, []); assert.equal(closure.finish(), snapshot);
	assert.throws(() => closure.addDevelop(state(2)), /sealed/iu);
});

test('the fixed shared archive entry capacity refuses excess unique references and allows duplicate deliveries', () => {
	const closure = createPhotoCubeLutClosureV1(), maximum = PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1.maximumReferences;
	assert.equal(maximum, 4094);
	for (let start = 1; start <= maximum; start += 256) {
		const count = Math.min(256, maximum - start + 1);
		closure.addDevelop({ ...defaultImageDevelopStateV1(), processVersion: 2, effects: Array.from({ length: count }, (_, offset) => state(start + offset).effects[0]!) });
	}
	closure.addDevelop(state(1)); assert.throws(() => closure.addDevelop(state(maximum + 1)), /capacity/iu);
	assert.equal(closure.finish().length, maximum);
});

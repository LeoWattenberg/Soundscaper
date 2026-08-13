/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	canonicalParameterAddressKey,
	legacySendEdgeId,
	normalizeParameterAddress,
	parameterAddressesEqual,
	type ParameterAddress,
} from '../src/common/editor/parameter-address.ts';

test('parameter addresses use stable closed JSON identities', () => {
	const address: ParameterAddress = {
		kind: 'effect',
		strip: { kind: 'track', id: 'track:one' },
		effectId: 'effect,[one]',
		elementId: 'band:"one"',
		parameterId: 'gain',
	};
	const normalized = normalizeParameterAddress(structuredClone(address));
	assert.deepEqual(normalized, address);
	assert.equal(Object.isFrozen(normalized), true);
	assert.equal(Object.isFrozen(normalized.strip), true);
	assert.equal(parameterAddressesEqual(normalized, structuredClone(address)), true);
	assert.deepEqual(JSON.parse(canonicalParameterAddressKey(address)), [
		'effect', ['track', 'track:one'], 'effect,[one]', 'band:"one"', 'gain',
	]);

	assert.notEqual(
		canonicalParameterAddressKey(address),
		canonicalParameterAddressKey({
			...address,
			strip: { kind: 'track', id: 'track' },
			effectId: 'one:effect,[one]',
		}),
	);
});

test('parameter addresses reject unknown members and unstable identifiers', () => {
	assert.throws(
		() => normalizeParameterAddress({
			kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain', extra: true,
		}),
		/unknown member/iu,
	);
	assert.throws(
		() => normalizeParameterAddress({
			kind: 'effect', strip: { kind: 'track', id: '' }, effectId: 'effect', parameterId: 'gain',
		}),
		/stable.*ID/iu,
	);
	assert.throws(
		() => normalizeParameterAddress({
			kind: 'edge', edgeId: 'edge', parameterId: 'pan',
		}),
		/edge parameter/iu,
	);
	const accessor = Object.defineProperty({}, 'kind', {
		enumerable: true,
		get: () => { throw new Error('hostile getter ran'); },
	});
	assert.throws(() => normalizeParameterAddress(accessor), /own data properties/iu);
	assert.throws(
		() => normalizeParameterAddress(Object.assign(Object.create({ kind: 'strip' }), {
			strip: { kind: 'master' }, parameterId: 'gain',
		})),
		/plain object/iu,
	);
});

test('legacy send edge identities survive reload and delimiter-heavy IDs', () => {
	const first = legacySendEdgeId('track:one', 'send,[one]');
	const reloaded = legacySendEdgeId(
		JSON.parse(JSON.stringify('track:one')),
		JSON.parse(JSON.stringify('send,[one]')),
	);
	assert.equal(first, reloaded);
	assert.deepEqual(JSON.parse(first), ['legacy-send-v1', 'track:one', 'send,[one]']);
	assert.notEqual(first, legacySendEdgeId('track', 'one:send,[one]'));
});

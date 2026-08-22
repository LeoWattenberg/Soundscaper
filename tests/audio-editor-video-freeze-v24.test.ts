/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	classifyVideoFreezeFallbackV1,
	computeVideoFreezeFreshnessV1,
	createVideoFreezeFallbackV1,
	normalizeVideoFreezeFallbackV1,
} from '../src/common/editor/video-freeze-v24.ts';

const COMPONENTS = Object.freeze({
	authoredStateSha256: '1'.repeat(64),
	inputIdentitiesSha256: '2'.repeat(64),
	renderPlanFingerprintSha256: '3'.repeat(64),
	nativeEffectFingerprintSha256: '4'.repeat(64),
});

test('V24 video freeze binds every authored, input, plan, and native-effect identity', () => {
	const freshness = computeVideoFreezeFreshnessV1(COMPONENTS);
	assert.deepEqual(freshness, {
		...COMPONENTS,
		freshnessSha256: '4a1ebc141b98750268dd513626f55dc02cce9a731a21d778b5d7f55a50fc9e01',
	});
	assert.equal(Object.isFrozen(freshness), true);
	for (const key of Object.keys(COMPONENTS)) {
		const changed = { ...COMPONENTS, [key]: '5'.repeat(64) };
		assert.notEqual(computeVideoFreezeFreshnessV1(changed).freshnessSha256, freshness.freshnessSha256);
	}
	assert.throws(() => computeVideoFreezeFreshnessV1({ ...COMPONENTS, authoredStateSha256: 'A'.repeat(64) }), /SHA-256|digest/iu);
	assert.throws(() => computeVideoFreezeFreshnessV1({ ...COMPONENTS, renderedBytes: 'inline' }), /unsupported|field/iu);
});

test('frozen fallback is a strict digest-bound reference to external media bytes', () => {
	const fallback = createVideoFreezeFallbackV1({
		renderedSourceId: 'freeze-source-1',
		renderedAssetSha256: 'a'.repeat(64),
		...COMPONENTS,
	});
	assert.deepEqual(fallback, {
		schemaVersion: 1,
		renderedSourceId: 'freeze-source-1',
		renderedAssetSha256: 'a'.repeat(64),
		...COMPONENTS,
		freshnessSha256: computeVideoFreezeFreshnessV1(COMPONENTS).freshnessSha256,
	});
	assert.equal(Object.isFrozen(fallback), true);
	assert.deepEqual(normalizeVideoFreezeFallbackV1(fallback), fallback);
	assert.throws(() => normalizeVideoFreezeFallbackV1({ ...fallback, freshnessSha256: 'b'.repeat(64) }), /freshness|match/iu);
	assert.throws(() => normalizeVideoFreezeFallbackV1({ ...fallback, renderedBytes: new Uint8Array() }), /unsupported|field/iu);
});

test('only an exactly fresh verified fallback may play; stale state can only bypass', () => {
	const fallback = createVideoFreezeFallbackV1({
		renderedSourceId: 'freeze-source-1',
		renderedAssetSha256: 'a'.repeat(64),
		...COMPONENTS,
	});
	assert.deepEqual(classifyVideoFreezeFallbackV1(fallback, COMPONENTS), {
		status: 'fresh',
		mode: 'frozen',
		changedComponents: [],
		authoredStatePreserved: true,
		reportsDegradation: false,
	});
	assert.deepEqual(classifyVideoFreezeFallbackV1(fallback, {
		...COMPONENTS,
		authoredStateSha256: '5'.repeat(64),
		inputIdentitiesSha256: '6'.repeat(64),
	}), {
		status: 'stale',
		mode: 'bypass',
		changedComponents: ['authored-state', 'input-identities'],
		authoredStatePreserved: true,
		reportsDegradation: true,
	});
	assert.deepEqual(classifyVideoFreezeFallbackV1(fallback, null), {
		status: 'unverifiable',
		mode: 'bypass',
		changedComponents: [],
		authoredStatePreserved: true,
		reportsDegradation: true,
	});
});

test('tampered stored freeze state is rejected instead of silently bypassed', () => {
	const fallback = createVideoFreezeFallbackV1({
		renderedSourceId: 'freeze-source-1',
		renderedAssetSha256: 'a'.repeat(64),
		...COMPONENTS,
	});
	assert.throws(() => classifyVideoFreezeFallbackV1({ ...fallback, renderedAssetSha256: 'not-a-digest' }, COMPONENTS), /SHA-256|digest/iu);
});

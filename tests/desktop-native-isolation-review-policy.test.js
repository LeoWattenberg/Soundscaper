/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH,
	resolveNativeIsolationReviewPublicKey,
	validateNativeIsolationReviewPolicy,
} from '../desktop/native-isolation-review-policy.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('checked-in external technical-review trust stays optional and fail-closed', () => {
	const policy = JSON.parse(readFileSync(
		resolve(repositoryRoot, MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH),
		'utf8',
	));
	const admitted = validateNativeIsolationReviewPolicy(policy);
	assert.equal(admitted.algorithm, 'Ed25519');
	assert.deepEqual(admitted.trustedKeys, []);
	assert.ok(admitted.blockedBy.length >= 64);
	assert.match(admitted.blockedBy,
		/repository owner review replaces the independent-reviewer and trust-key requirement/iu);
	assert.equal(resolveNativeIsolationReviewPublicKey(policy, {
		usage: 'framescaper-openfx-production-readiness',
		target: 'linux-x64',
		keyId: 'unconfigured-reviewer',
	}), null);
	assert.equal(resolveNativeIsolationReviewPublicKey(policy, {
		usage: 'framescaper-media-host-production-readiness',
		target: 'linux-x64',
		keyId: 'unconfigured-reviewer',
	}), null);
});

test('review keys are scoped to one accepted usage and target', () => {
	const { publicKey } = generateKeyPairSync('ed25519');
	const policy = {
		schemaVersion: 1,
		algorithm: 'Ed25519',
		trustedKeys: [{
			id: 'reviewer-1',
			status: 'accepted',
			usages: ['framescaper-openfx-production-readiness'],
			targets: ['linux-x64'],
			publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }),
		}],
		blockedBy: 'An independently controlled native-isolation review has not yet been accepted for this exact target.',
	};
	assert.equal(resolveNativeIsolationReviewPublicKey(policy, {
		usage: 'framescaper-openfx-production-readiness',
		target: 'linux-x64',
		keyId: 'reviewer-1',
	})?.asymmetricKeyType, 'ed25519');
	assert.equal(resolveNativeIsolationReviewPublicKey(policy, {
		usage: 'soundscaper-professional-native-production-readiness',
		target: 'linux-x64',
		keyId: 'reviewer-1',
	}), null);
	assert.equal(resolveNativeIsolationReviewPublicKey(policy, {
		usage: 'framescaper-openfx-production-readiness',
		target: 'win-x64',
		keyId: 'reviewer-1',
	}), null);
	assert.equal(resolveNativeIsolationReviewPublicKey(policy, {
		usage: 'framescaper-media-host-production-readiness',
		target: 'linux-x64',
		keyId: 'reviewer-1',
	}), null, 'an OpenFX review key cannot authorize the media host');

	for (const mutate of [
		(value) => { value.algorithm = 'RSA'; },
		(value) => { value.trustedKeys[0].usages = ['package-signing']; },
		(value) => { value.trustedKeys.push(structuredClone(value.trustedKeys[0])); },
	]) {
		const changed = structuredClone(policy);
		mutate(changed);
		assert.throws(() => validateNativeIsolationReviewPolicy(changed), /native-isolation|Ed25519/iu);
	}
});

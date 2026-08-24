/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPublicKey } from 'node:crypto';

export const MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH =
	'config/milestone-5-native-isolation-review-policy.json';
export const MILESTONE_5_NATIVE_ISOLATION_REVIEW_USAGES = Object.freeze([
	'soundscaper-professional-native-production-readiness',
	'framescaper-openfx-production-readiness',
	'framescaper-media-host-production-readiness',
]);
export const MILESTONE_5_NATIVE_ISOLATION_REVIEW_TARGETS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);

const POLICY_FIELDS = Object.freeze(['schemaVersion', 'algorithm', 'trustedKeys', 'blockedBy']);
const KEY_FIELDS = Object.freeze(['id', 'status', 'usages', 'targets', 'publicKeyPem']);
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;

export function validateNativeIsolationReviewPolicy(value) {
	const policy = exactRecord(value, POLICY_FIELDS, 'native-isolation review policy');
	if (policy.schemaVersion !== 1 || policy.algorithm !== 'Ed25519'
		|| !Array.isArray(policy.trustedKeys) || typeof policy.blockedBy !== 'string'
		|| policy.blockedBy.length < 64 || policy.blockedBy.length > 2_048) {
		throw new TypeError('The native-isolation review policy is invalid.');
	}
	const trustedKeys = policy.trustedKeys.map((value, index) => {
		const row = exactRecord(value, KEY_FIELDS, `native-isolation review key ${String(index)}`);
		if (!KEY_ID.test(String(row.id)) || !['accepted', 'revoked'].includes(String(row.status))
			|| !closedSubset(row.usages, MILESTONE_5_NATIVE_ISOLATION_REVIEW_USAGES)
			|| !closedSubset(row.targets, MILESTONE_5_NATIVE_ISOLATION_REVIEW_TARGETS)
			|| typeof row.publicKeyPem !== 'string') {
			throw new TypeError('A native-isolation review key is invalid.');
		}
		let publicKey;
		try { publicKey = createPublicKey(row.publicKeyPem); }
		catch (error) {
			throw new TypeError('A native-isolation review key is not valid PEM.', { cause: error });
		}
		if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
			throw new TypeError('A native-isolation review key must be Ed25519.');
		}
		return Object.freeze({
			id: row.id,
			status: row.status,
			usages: Object.freeze([...row.usages]),
			targets: Object.freeze([...row.targets]),
			publicKeyPem: row.publicKeyPem,
			publicKey,
		});
	});
	if (new Set(trustedKeys.map(({ id }) => id)).size !== trustedKeys.length) {
		throw new TypeError('Native-isolation review key IDs must be unique.');
	}
	return Object.freeze({
		schemaVersion: 1,
		algorithm: 'Ed25519',
		trustedKeys: Object.freeze(trustedKeys),
		blockedBy: policy.blockedBy,
	});
}

export function resolveNativeIsolationReviewPublicKey(policyValue, options) {
	const policy = validateNativeIsolationReviewPolicy(policyValue);
	const request = exactRecord(options, ['usage', 'target', 'keyId'], 'native-isolation key request');
	if (!MILESTONE_5_NATIVE_ISOLATION_REVIEW_USAGES.includes(request.usage)
		|| !MILESTONE_5_NATIVE_ISOLATION_REVIEW_TARGETS.includes(request.target)
		|| !KEY_ID.test(String(request.keyId))) {
		throw new TypeError('The native-isolation review key request is invalid.');
	}
	const matches = policy.trustedKeys.filter(({ id, status, usages, targets }) => (
		id === request.keyId && status === 'accepted'
		&& usages.includes(request.usage) && targets.includes(request.target)
	));
	return matches.length === 1 ? matches[0].publicKey : null;
}

function closedSubset(value, allowed) {
	return Array.isArray(value) && value.length > 0
		&& value.every((item) => typeof item === 'string' && allowed.includes(item))
		&& new Set(value).size === value.length;
}

function exactRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new TypeError(`The ${label} must be one exact record.`);
	}
	return value;
}

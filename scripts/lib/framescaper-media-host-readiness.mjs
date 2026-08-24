/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reopened production-isolation authority for an authenticated media-host release. */

import { createHash } from 'node:crypto';
import {
	closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
	framescaperMediaProductionReadinessReference,
	verifyFramescaperMediaProductionReadiness,
} from '../../desktop/framescaper-media-production-readiness.ts';
import {
	MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH,
	resolveNativeIsolationReviewPublicKey,
	validateNativeIsolationReviewPolicy,
} from '../../desktop/native-isolation-review-policy.mjs';
import { verifyFramescaperMediaHostPayloadManifest } from './framescaper-media-host-build.mjs';

export const FRAMESCAPER_MEDIA_READINESS_EVIDENCE_NAME =
	'framescaper-media-host-production-readiness.json';
export const FRAMESCAPER_MEDIA_REVIEW_POLICY_NAME =
	'milestone-5-native-isolation-review-policy.json';

const VERIFIED_RELEASES = new WeakSet();

export async function verifyFramescaperMediaHostPayloadRelease({ repositoryRoot }) {
	const root = resolve(repositoryRoot);
	const release = verifyFramescaperMediaHostPayloadManifest({ repositoryRoot: root });
	const reviewPolicyBytes = regularCanonicalFile(
		root, MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH,
		'Framescaper media-host native-isolation review policy',
	);
	const reviewPolicy = parseJson(reviewPolicyBytes, 'Framescaper media-host review policy');
	validateNativeIsolationReviewPolicy(reviewPolicy);
	const productionReadiness = {};
	for (const target of release.payload.targets) {
		if (target.status !== 'built' || target.productionReadiness === null) {
			productionReadiness[target.id] = null;
			continue;
		}
		const reference = framescaperMediaProductionReadinessReference(
			target.productionReadiness, target.id,
		);
		const evidence = await verifyFramescaperMediaProductionReadiness(reference, {
			mediaHostSha256: target.payload.sha256,
			isolation: {
				launcherSha256: target.isolationPayload.launcherPayload.sha256,
				sandboxProfileSha256: target.isolationPayload.sandboxProfilePayload.sha256,
				brokerPolicySha256: target.isolationPayload.brokerPolicyPayload.sha256,
				runtimeLibraries: target.isolationPayload.runtimeLibraryPayloads.map((library) => ({
					name: library.path.split('/').at(-1),
					byteLength: library.byteLength,
					sha256: library.sha256,
				})),
			},
		}, {
			readEvidence: async (path) => regularCanonicalFile(
				root, path, `Framescaper media-host ${target.id} readiness evidence`,
			),
			resolveReviewPublicKey: (_target, keyId) => resolveNativeIsolationReviewPublicKey(
				reviewPolicy,
				{ usage: 'framescaper-media-host-production-readiness', target: target.id, keyId },
			),
		});
		const evidenceBytes = regularCanonicalFile(
			root, reference.evidence.path,
			`reopened Framescaper media-host ${target.id} readiness evidence`,
		);
		verifyDescriptor(evidenceBytes, reference.evidence,
			`reopened Framescaper media-host ${target.id} readiness evidence`);
		productionReadiness[target.id] = Object.freeze({
			reference,
			evidence: Object.freeze({ status: 'authenticated', evidence }),
			evidenceBytes,
		});
	}
	const verified = Object.freeze({
		...release,
		reviewPolicy: Object.freeze({
			name: FRAMESCAPER_MEDIA_REVIEW_POLICY_NAME,
			byteLength: reviewPolicyBytes.byteLength,
			sha256: digest(reviewPolicyBytes),
			bytes: reviewPolicyBytes,
		}),
		productionReadiness: Object.freeze(productionReadiness),
	});
	VERIFIED_RELEASES.add(verified);
	return verified;
}

export function framescaperMediaProductionReadinessStageSummary(release, targetId) {
	assertVerifiedRelease(release);
	const readiness = release.productionReadiness[targetId];
	if (readiness === null) return null;
	return deepFreeze({
		reference: structuredClone(readiness.reference),
		evidence: {
			name: FRAMESCAPER_MEDIA_READINESS_EVIDENCE_NAME,
			byteLength: readiness.evidenceBytes.byteLength,
			sha256: digest(readiness.evidenceBytes),
		},
		verified: structuredClone(readiness.evidence),
	});
}

function regularCanonicalFile(root, relativePath, label) {
	const path = resolve(root, relativePath);
	const localPath = relative(root, path);
	if (!localPath || isAbsolute(localPath) || localPath === '..' || localPath.startsWith(`..${sep}`)) {
		throw new Error(`${label} leaves its repository root.`);
	}
	const metadata = lstatSync(path);
	if (metadata.isSymbolicLink() || !metadata.isFile() || realpathSync(path) !== path) {
		throw new Error(`${label} is not a canonical regular file.`);
	}
	if (!Number.isSafeInteger(metadata.size) || metadata.size < 1 || metadata.size > 1024 * 1024) {
		throw new Error(`${label} has an invalid byte length.`);
	}
	const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = fstatSync(descriptor);
		if (!opened.isFile() || opened.size !== metadata.size
			|| (metadata.ino !== 0 && opened.ino !== 0
				&& (opened.dev !== metadata.dev || opened.ino !== metadata.ino))) {
			throw new Error(`${label} changed while it was opened.`);
		}
		const bytes = readFileSync(descriptor);
		const after = fstatSync(descriptor);
		if (after.size !== opened.size || bytes.byteLength !== opened.size) {
			throw new Error(`${label} changed while it was read.`);
		}
		return bytes;
	} finally { closeSync(descriptor); }
}

function verifyDescriptor(bytes, descriptor, label) {
	if (bytes.byteLength !== descriptor.byteLength || digest(bytes) !== descriptor.sha256) {
		throw new Error(`${label} changed bytes or digest.`);
	}
}

function parseJson(bytes, label) {
	try { return JSON.parse(String(bytes)); }
	catch (error) { throw new Error(`${label} is invalid JSON.`, { cause: error }); }
}

function assertVerifiedRelease(release) {
	if (!VERIFIED_RELEASES.has(release)) {
		throw new Error('A verified Framescaper media-host payload release is required.');
	}
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

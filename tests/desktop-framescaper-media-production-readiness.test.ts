/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
	framescaperMediaProductionReadinessReference,
	isVerifiedFramescaperMediaProductionReadiness,
	verifyFramescaperMediaProductionReadiness,
} from '../desktop/framescaper-media-production-readiness.ts';

const HOST_SHA256 = '10'.repeat(32);
const LAUNCHER_SHA256 = '20'.repeat(32);
const PROFILE_SHA256 = '30'.repeat(32);
const BROKER_SHA256 = '40'.repeat(32);
const LIBRARY_SHA256 = '50'.repeat(32);
const KEY_ID = 'independent-media-review-v1';
const KEY = generateKeyPairSync('ed25519');

test('signed media readiness is reopened, bound to the exact runtime closure, and independently branded', async () => {
	const bytes = evidenceBytes();
	const reference = framescaperMediaProductionReadinessReference({
		schemaVersion: 2,
		status: 'reviewed',
		target: 'linux-x64',
		evidence: {
			path: 'config/framescaper-media-host-production-readiness/linux-x64.json',
			byteLength: bytes.byteLength,
			sha256: digest(bytes),
		},
		signature: {
			algorithm: 'ed25519',
			reviewKeyId: KEY_ID,
			valueBase64: sign(null, bytes, KEY.privateKey).toString('base64'),
		},
	}, 'linux-x64');
	let reads = 0;
	const readiness = await verifyFramescaperMediaProductionReadiness(reference, {
		mediaHostSha256: HOST_SHA256,
		isolation: {
			launcherSha256: LAUNCHER_SHA256,
			sandboxProfileSha256: PROFILE_SHA256,
			brokerPolicySha256: BROKER_SHA256,
			runtimeLibraries: [{
				name: 'libframescaper-media.so', byteLength: 47, sha256: LIBRARY_SHA256,
			}],
		},
	}, {
		readEvidence: async () => { reads += 1; return Buffer.from(bytes); },
		resolveReviewPublicKey: () => KEY.publicKey.export({ type: 'spki', format: 'pem' }),
	});
	assert.equal(reads, 2, 'the signed evidence is reopened before the brand is minted');
	assert.equal(isVerifiedFramescaperMediaProductionReadiness(readiness), true);
	assert.equal(isVerifiedFramescaperMediaProductionReadiness(structuredClone(readiness)), false);
});

test('media readiness rejects stale bytes, signatures, payloads, and isolation closure drift', async () => {
	const bytes = evidenceBytes();
	const reference = framescaperMediaProductionReadinessReference({
		schemaVersion: 2,
		status: 'reviewed',
		target: 'linux-x64',
		evidence: {
			path: 'config/framescaper-media-host-production-readiness/linux-x64.json',
			byteLength: bytes.byteLength,
			sha256: digest(bytes),
		},
		signature: {
			algorithm: 'ed25519', reviewKeyId: KEY_ID,
			valueBase64: sign(null, bytes, KEY.privateKey).toString('base64'),
		},
	}, 'linux-x64');
	const payload = {
		mediaHostSha256: HOST_SHA256,
		isolation: {
			launcherSha256: LAUNCHER_SHA256,
			sandboxProfileSha256: PROFILE_SHA256,
			brokerPolicySha256: BROKER_SHA256,
			runtimeLibraries: [{
				name: 'libframescaper-media.so', byteLength: 47, sha256: LIBRARY_SHA256,
			}],
		},
	} as const;
	for (const [label, readEvidence, publicKey, changed] of [
		['changed between opens', async () => Buffer.from(++readCount === 1 ? bytes : Buffer.from('changed')),
			KEY.publicKey, payload],
		['untrusted signature', async () => Buffer.from(bytes), generateKeyPairSync('ed25519').publicKey, payload],
		['host drift', async () => Buffer.from(bytes), KEY.publicKey,
			{ ...payload, mediaHostSha256: 'ff'.repeat(32) }],
		['runtime drift', async () => Buffer.from(bytes), KEY.publicKey, {
			...payload,
			isolation: { ...payload.isolation, runtimeLibraries: [] },
		}],
	] as const) {
		readCount = 0;
		await assert.rejects(
			verifyFramescaperMediaProductionReadiness(reference, changed, {
				readEvidence,
				resolveReviewPublicKey: () => publicKey.export({ type: 'spki', format: 'pem' }),
			}),
			/readiness|signed|stale|changed/iu,
			label,
		);
	}
});

let readCount = 0;

function evidenceBytes(): Buffer {
	return Buffer.from(JSON.stringify({
		schemaVersion: 1,
		kind: 'framescaper-media-host-production-readiness',
		target: 'linux-x64',
		mediaHostSha256: HOST_SHA256,
		runtimeLibraries: [{
			name: 'libframescaper-media.so', byteLength: 47, sha256: LIBRARY_SHA256,
		}],
		launcher: {
			schemaVersion: 1,
			target: 'linux-x64',
			launcherId: 'framescaper-linux-landlock-seccomp-namespaces-v1',
			launcherPayloadSha256: LAUNCHER_SHA256,
			sandboxProfileSha256: PROFILE_SHA256,
			brokerPolicySha256: BROKER_SHA256,
			filesystem: 'broker-grant-only',
			network: 'denied',
			childProcesses: 'denied',
			dynamicCode: 'denied',
		},
		ffmpegVersion: '9.0.1',
		osIsolationAttested: true,
		hostileMediaDenialAttested: true,
		dualStreamFdRemapAttested: true,
		twoHourContinuityAttested: true,
		reviewedAt: '2026-08-24',
		reviewer: 'synthetic-independent-media-reviewer',
	}));
}

function digest(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

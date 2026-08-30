/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
	soundscaperProfessionalReadinessReference,
	verifySoundscaperProfessionalReadiness,
} from '../desktop/soundscaper-professional-native-readiness.mjs';
import {
	parseSoundscaperProfessionalNativeCandidateReadinessBindings,
} from '../desktop/soundscaper-professional-native-candidate-bindings.mjs';
import {
	bindEvidenceReceipt,
} from '../scripts/lib/soundscaper-professional-native-candidate-contract.mjs';

test('signed readiness binds candidate, delivery helper, codec, and runtime closure authority', async () => {
	const bindings = readinessBindings('mac-arm64');
	const harness = signedReadiness(bindings);
	const verified = await verifySoundscaperProfessionalReadiness(harness.reference, bindings, harness.ports);
	assert.equal(verified.status, 'authenticated');
	assert.deepEqual(verified.evidence.buildCandidate, artifact(2));
	assert.deepEqual(verified.evidence.deliveryFilesystem, artifact(3));
	assert.deepEqual(verified.evidence.osAudioCodec, artifact(4));

	for (const field of ['buildCandidate', 'deliveryFilesystem', 'osAudioCodec']) {
		await assert.rejects(() => verifySoundscaperProfessionalReadiness(
			harness.reference,
			{ ...bindings, [field]: { ...bindings[field], sha256: 'f'.repeat(64) } },
			harness.ports,
		), /stale or non-canonical/iu, field);
	}
	await assert.rejects(() => verifySoundscaperProfessionalReadiness(
		harness.reference,
		{ ...bindings, runtimeClosure: [{ path: 'runtime/substituted.so', byteLength: 1, sha256: 'e'.repeat(64) }] },
		harness.ports,
	), /stale|exact professional/iu);
	for (const candidateAuthority of [
		{ ...bindings.candidateAuthority, sourceRevision: '9'.repeat(40) },
		{ ...bindings.candidateAuthority, buildPlanSha256: '9'.repeat(64) },
	]) {
		await assert.rejects(() => verifySoundscaperProfessionalReadiness(
			harness.reference, { ...bindings, candidateAuthority }, harness.ports,
		), /stale or non-canonical/iu);
	}
	await assert.rejects(() => verifySoundscaperProfessionalReadiness(
		harness.reference,
		{ ...bindings, runtimeClosure: [{ ...bindings.runtimeClosure[0], path: 'runtime/foreign.dylib' }] },
		harness.ports,
	), /stale or non-canonical/iu);
});

test('Linux readiness requires an explicit null codec binding', async () => {
	const bindings = readinessBindings('linux-x64');
	const harness = signedReadiness(bindings);
	const verified = await verifySoundscaperProfessionalReadiness(harness.reference, bindings, harness.ports);
	assert.equal(verified.evidence.osAudioCodec, null);
	await assert.rejects(() => verifySoundscaperProfessionalReadiness(
		harness.reference, { ...bindings, osAudioCodec: artifact(9) }, harness.ports,
	), /stale or non-canonical|codec/iu);
});

test('production readiness requires exact schema-v2 bytes and Developer ID mac evidence', async () => {
	const bindings = readinessBindings('mac-arm64');
	for (const mutate of [
		(value) => { value.unreviewedExtension = true; },
		(value) => { delete value.buildProvenance.buildPlanSha256; },
		(value) => { value.macSigning.mode = 'ad-hoc'; },
	]) {
		const harness = signedReadiness(bindings, mutate);
		await assert.rejects(() => verifySoundscaperProfessionalReadiness(
			harness.reference, bindings, harness.ports,
		), /exact record|invalid|stale or non-canonical|Developer ID/iu);
	}
});

test('candidate readiness authority comes from exact canonical candidate and build receipts', () => {
	const candidate = candidateReceipt('mac-arm64');
	const bytes = Buffer.from(`${JSON.stringify(candidate, null, '\t')}\n`);
	assert.deepEqual(parseSoundscaperProfessionalNativeCandidateReadinessBindings(
		bytes, 'mac-arm64',
	), {
		sourceRevision: '1'.repeat(40), buildPlanSha256: '2'.repeat(64),
		macSigning: { mode: 'developer-id', identitySha256: '9'.repeat(64) },
	});
	assert.throws(() => parseSoundscaperProfessionalNativeCandidateReadinessBindings(
		Buffer.from(JSON.stringify(candidate)), 'mac-arm64',
	), /canonical JSON/iu);
	const stale = structuredClone(candidate);
	stale.sourceRevision = '8'.repeat(40);
	assert.throws(() => parseSoundscaperProfessionalNativeCandidateReadinessBindings(
		Buffer.from(`${JSON.stringify(stale, null, '\t')}\n`), 'mac-arm64',
	), /misbound/iu);
});

function signedReadiness(bindings, mutate = null) {
	const { privateKey, publicKey } = generateKeyPairSync('ed25519');
	const evidence = evidenceFor(bindings);
	if (mutate) mutate(evidence);
	const bytes = Buffer.from(JSON.stringify(evidence));
	const signature = sign(null, bytes, privateKey).toString('base64');
	const path = `native/soundscaper-professional-host/prebuilt/${bindings.target}/soundscaper-professional-native-readiness.json`;
	const reference = soundscaperProfessionalReadinessReference({
		schemaVersion: 1, status: 'reviewed', target: bindings.target,
		evidence: { path, byteLength: bytes.byteLength, sha256: hash(bytes) },
		signature: { algorithm: 'ed25519', reviewKeyId: 'fixture-review', valueBase64: signature },
	}, bindings.target);
	return {
		reference,
		ports: {
			readEvidence: async () => bytes,
			resolveReviewPublicKey: async () => publicKey,
		},
	};
}

function readinessBindings(target) {
	return {
		target,
		payload: artifact(1),
		buildCandidate: artifact(2),
		deliveryFilesystem: artifact(3),
		osAudioCodec: target.startsWith('linux-') ? null : artifact(4),
		sourceAuthentication: { schemaVersion: 1, status: 'authenticated', sources: [] },
		toolchainIdentity: 'fixture-cmake-toolchain',
		candidateAuthority: {
			sourceRevision: '1'.repeat(40), buildPlanSha256: '2'.repeat(64),
			macSigning: target === 'mac-arm64'
				? { mode: 'developer-id', identitySha256: '9'.repeat(64) } : null,
		},
		runtimeClosure: [{ path: 'runtime/libfixture.dylib', byteLength: 11, sha256: 'e'.repeat(64) }],
	};
}

function evidenceFor(bindings) {
	return {
		schemaVersion: 2, kind: 'soundscaper-professional-native-production-readiness',
		target: bindings.target,
		payload: bindings.payload,
		buildCandidate: bindings.buildCandidate,
		deliveryFilesystem: bindings.deliveryFilesystem,
		osAudioCodec: bindings.osAudioCodec,
		sourceAuthenticationSha256: hash(Buffer.from(stableJson(bindings.sourceAuthentication))),
		toolchainIdentity: bindings.toolchainIdentity,
		buildProvenance: {
			sourceRevision: bindings.candidateAuthority.sourceRevision,
			buildPlanSha256: bindings.candidateAuthority.buildPlanSha256,
			nativeHostTreeSha256: '3'.repeat(64), helperAddonTreeSha256: '4'.repeat(64),
		},
		macSigning: bindings.candidateAuthority.macSigning,
		launcher: {
			schemaVersion: 1, target: bindings.target,
			launcherId: bindings.target === 'mac-arm64'
				? 'soundscaper-macos-seatbelt-broker-v1'
				: 'soundscaper-linux-landlock-seccomp-namespaces-v1',
			launcherPayloadSha256: '5'.repeat(64), sandboxProfileSha256: '6'.repeat(64),
			brokerPolicySha256: '7'.repeat(64), peerPayloadSha256: '8'.repeat(64),
			runtimeClosureSha256: runtimeClosureSha256(bindings.runtimeClosure),
			filesystem: 'broker-grant-only', network: 'denied', childProcesses: 'denied',
			dynamicCode: 'admitted-plugin-only',
		},
		osIsolationAttested: true, hostilePluginDenialAttested: true,
		realThirdPartyExecutionAttested: true, reviewedAt: '2026-08-30', reviewer: 'Fixture Reviewer',
	};
}

function candidateReceipt(target) {
	const sourceRevision = '1'.repeat(40);
	const buildPlanSha256 = '2'.repeat(64);
	const build = {
		status: 'passed', sourceRevision, buildPlanSha256,
		packagedAppAuthority: {}, tests: [],
		macSigning: target === 'mac-arm64' ? {
			schemaVersion: 1, status: 'signatures-verified', target,
			signing: { mode: 'developer-id', identitySha256: '9'.repeat(64) },
			commands: {}, artifacts: [],
		} : null,
	};
	return {
		schemaVersion: 1, kind: 'soundscaper-professional-native-candidate', target,
		sourceRevision, buildPlanSha256,
		evidenceReceipts: [bindEvidenceReceipt('build', target, build)],
		payload: {}, osAudioCodec: {}, pluginPeer: {}, deliveryFilesystem: {}, isolation: {},
		productionReadiness: null,
	};
}

function artifact(seed) { return { byteLength: seed, sha256: String(seed).repeat(64) }; }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function runtimeClosureSha256(value) {
	return hash(Buffer.from(JSON.stringify(value.map(({ path, byteLength, sha256 }) => ({
		path, byteLength, sha256,
	})).sort((left, right) => left.path.localeCompare(right.path)))));
}
function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.keys(value).sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
	return JSON.stringify(value);
}

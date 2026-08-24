/* SPDX-License-Identifier: AGPL-3.0-only */

/** Signed, reopened build-provenance and OS-isolation authority for M5A hosts. */

import { createHash, verify } from 'node:crypto';
import { posix } from 'node:path';

const SHA256 = /^[a-f\d]{64}$/u;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const TARGETS = Object.freeze(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
const LAUNCHERS = Object.freeze({
	'linux-x64': 'soundscaper-linux-landlock-seccomp-namespaces-v1',
	'linux-arm64': 'soundscaper-linux-landlock-seccomp-namespaces-v1',
	'mac-arm64': 'soundscaper-macos-seatbelt-broker-v1',
	'win-x64': 'soundscaper-windows-appcontainer-job-v1',
	'win-arm64': 'soundscaper-windows-appcontainer-job-v1',
});
const VERIFIED_READINESS = new WeakSet();

export function soundscaperProfessionalReadinessEvidenceName(target) {
	targetId(target);
	return `native/soundscaper-professional-host/prebuilt/${target}/soundscaper-professional-native-readiness.json`;
}

export function soundscaperProfessionalReadinessReference(value, target) {
	const row = closed(value, ['schemaVersion', 'status', 'target', 'evidence', 'signature']);
	const evidence = closed(row.evidence, ['path', 'byteLength', 'sha256']);
	const signature = closed(row.signature, ['algorithm', 'reviewKeyId', 'valueBase64']);
	if (row.schemaVersion !== 1 || row.status !== 'reviewed' || row.target !== targetId(target)
		|| evidence.path !== soundscaperProfessionalReadinessEvidenceName(target)
		|| posix.normalize(String(evidence.path)) !== evidence.path
		|| !Number.isSafeInteger(evidence.byteLength) || Number(evidence.byteLength) < 256
		|| Number(evidence.byteLength) > 1024 * 1024 || !digestValue(evidence.sha256)
		|| signature.algorithm !== 'ed25519' || !KEY_ID.test(String(signature.reviewKeyId))
		|| !canonicalSignature(signature.valueBase64)) {
		throw new TypeError('The Soundscaper professional production-readiness reference is invalid.');
	}
	return deepFreeze({ schemaVersion: 1, status: 'reviewed', target,
		evidence: { path: evidence.path, byteLength: Number(evidence.byteLength), sha256: evidence.sha256 },
		signature: { algorithm: 'ed25519', reviewKeyId: signature.reviewKeyId,
			valueBase64: signature.valueBase64 },
	});
}

export async function verifySoundscaperProfessionalReadiness(referenceValue, bindings, ports) {
	const reference = soundscaperProfessionalReadinessReference(referenceValue, bindings.target);
	const first = Buffer.from(await ports.readEvidence(reference.evidence.path));
	const second = Buffer.from(await ports.readEvidence(reference.evidence.path));
	if (!first.equals(second) || first.byteLength !== reference.evidence.byteLength
		|| sha256(first) !== reference.evidence.sha256) {
		throw new Error('The professional production-readiness evidence changed when reopened.');
	}
	const key = await ports.resolveReviewPublicKey(reference.signature.reviewKeyId);
	if (key === null || key === undefined || !verify(
		null, first, key, Buffer.from(reference.signature.valueBase64, 'base64'),
	)) throw new Error('The professional production-readiness evidence has no trusted Ed25519 signature.');
	let parsed;
	try { parsed = JSON.parse(String(first)); }
	catch { throw new TypeError('The professional production-readiness evidence is not JSON.'); }
	const evidence = readinessEvidence(parsed, bindings.target);
	if (!first.equals(Buffer.from(JSON.stringify(evidence)))
		|| evidence.payload.byteLength !== bindings.payload.byteLength
		|| evidence.payload.sha256 !== bindings.payload.sha256
		|| evidence.sourceAuthenticationSha256 !== sha256(Buffer.from(stableJson(bindings.sourceAuthentication)))
		|| evidence.toolchainIdentity !== bindings.toolchainIdentity) {
		throw new Error('The signed professional production-readiness evidence is stale or non-canonical.');
	}
	const authenticated = deepFreeze({ status: 'authenticated', evidence });
	VERIFIED_READINESS.add(authenticated);
	return authenticated;
}

export function isVerifiedSoundscaperProfessionalReadiness(value) {
	return !!value && typeof value === 'object' && VERIFIED_READINESS.has(value);
}

export function soundscaperProfessionalRuntimeClosureSha256(value) {
	if (!Array.isArray(value) || value.length > 128 || value.some((entry) => (
		!entry || typeof entry !== 'object' || !Number.isSafeInteger(entry.byteLength)
		|| entry.byteLength < 1 || !digestValue(entry.sha256)
	))) throw new TypeError('The professional runtime closure is invalid.');
	const canonical = value.map(({ byteLength, sha256 }) => ({ byteLength, sha256 }))
		.sort((left, right) => left.sha256.localeCompare(right.sha256) || left.byteLength - right.byteLength);
	return sha256(Buffer.from(JSON.stringify(canonical)));
}

function readinessEvidence(value, target) {
	const row = closed(value, [
		'schemaVersion', 'kind', 'target', 'payload', 'sourceAuthenticationSha256',
		'toolchainIdentity', 'buildProvenance', 'launcher', 'osIsolationAttested',
		'hostilePluginDenialAttested', 'realThirdPartyExecutionAttested', 'reviewedAt', 'reviewer',
	]);
	const payload = closed(row.payload, ['byteLength', 'sha256']);
	const build = closed(row.buildProvenance, [
		'sourceRevision', 'buildPlanSha256', 'nativeHostTreeSha256', 'helperAddonTreeSha256',
	]);
	const launcher = launcherEvidence(row.launcher, target);
	if (row.schemaVersion !== 1 || row.kind !== 'soundscaper-professional-native-production-readiness'
		|| row.target !== target || !Number.isSafeInteger(payload.byteLength) || Number(payload.byteLength) < 1
		|| !digestValue(payload.sha256) || !digestValue(row.sourceAuthenticationSha256)
		|| typeof row.toolchainIdentity !== 'string' || row.toolchainIdentity.length < 3
		|| row.toolchainIdentity.length > 512 || !REVISION.test(String(build.sourceRevision))
		|| !digestValue(build.buildPlanSha256) || !digestValue(build.nativeHostTreeSha256)
		|| !digestValue(build.helperAddonTreeSha256) || row.osIsolationAttested !== true
		|| row.hostilePluginDenialAttested !== true || row.realThirdPartyExecutionAttested !== true
		|| typeof row.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(row.reviewedAt)
		|| typeof row.reviewer !== 'string' || row.reviewer.length < 3 || row.reviewer.length > 128) {
		throw new TypeError('Signed professional production-readiness evidence is invalid.');
	}
	return deepFreeze({ schemaVersion: 1, kind: row.kind, target,
		payload: { byteLength: Number(payload.byteLength), sha256: payload.sha256 },
		sourceAuthenticationSha256: row.sourceAuthenticationSha256,
		toolchainIdentity: row.toolchainIdentity,
		buildProvenance: { sourceRevision: build.sourceRevision, buildPlanSha256: build.buildPlanSha256,
			nativeHostTreeSha256: build.nativeHostTreeSha256, helperAddonTreeSha256: build.helperAddonTreeSha256 },
		launcher, osIsolationAttested: true, hostilePluginDenialAttested: true,
		realThirdPartyExecutionAttested: true, reviewedAt: row.reviewedAt, reviewer: row.reviewer,
	});
}

function launcherEvidence(value, target) {
	const row = closed(value, [
		'schemaVersion', 'target', 'launcherId', 'launcherPayloadSha256', 'sandboxProfileSha256',
		'brokerPolicySha256', 'peerPayloadSha256', 'runtimeClosureSha256',
		'filesystem', 'network', 'childProcesses', 'dynamicCode',
	]);
	if (row.schemaVersion !== 1 || row.target !== target || row.launcherId !== LAUNCHERS[target]
		|| !digestValue(row.launcherPayloadSha256) || !digestValue(row.sandboxProfileSha256)
		|| !digestValue(row.brokerPolicySha256) || !digestValue(row.peerPayloadSha256)
		|| !digestValue(row.runtimeClosureSha256) || row.filesystem !== 'broker-grant-only'
		|| row.network !== 'denied' || row.childProcesses !== 'denied'
		|| row.dynamicCode !== 'admitted-plugin-only') {
		throw new TypeError('The signed professional OS-isolation launcher contract is invalid.');
	}
	return Object.freeze({ ...row });
}

function closed(value, fields) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !exactKeys(value, fields)) throw new TypeError('Professional readiness requires an exact record.');
	return value;
}
function exactKeys(value, fields) {
	return JSON.stringify(Reflect.ownKeys(value).sort()) === JSON.stringify([...fields].sort());
}
function targetId(value) {
	if (!TARGETS.includes(value)) throw new TypeError('The professional readiness target is unsupported.');
	return value;
}
function digestValue(value) { return typeof value === 'string' && SHA256.test(value); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.keys(value).sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
	return JSON.stringify(value);
}
function canonicalSignature(value) {
	if (typeof value !== 'string' || !/^[A-Za-z\d+/]+={0,2}$/u.test(value)) return false;
	const bytes = Buffer.from(value, 'base64');
	return bytes.byteLength === 64 && bytes.toString('base64') === value;
}
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

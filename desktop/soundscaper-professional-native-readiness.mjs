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
	const evidence = normalizeSoundscaperProfessionalReadinessEvidence(parsed, bindings.target);
	if (!first.equals(Buffer.from(JSON.stringify(evidence)))
		|| !sameArtifact(evidence.payload, bindings.payload)
		|| !sameArtifact(evidence.buildCandidate, bindings.buildCandidate)
		|| !sameArtifact(evidence.deliveryFilesystem, bindings.deliveryFilesystem)
		|| !sameNullableArtifact(evidence.osAudioCodec, bindings.osAudioCodec)
		|| evidence.sourceAuthenticationSha256
			!== soundscaperProfessionalSourceAuthenticationSha256(bindings.sourceAuthentication)
		|| evidence.toolchainIdentity !== bindings.toolchainIdentity
		|| evidence.buildProvenance.sourceRevision !== bindings.candidateAuthority?.sourceRevision
		|| evidence.buildProvenance.buildPlanSha256 !== bindings.candidateAuthority?.buildPlanSha256
		|| !sameMacSigning(evidence.macSigning, bindings.candidateAuthority?.macSigning)
		|| evidence.launcher.runtimeClosureSha256
			!== soundscaperProfessionalRuntimeClosureSha256(bindings.runtimeClosure)) {
		throw new Error('The signed professional production-readiness evidence is stale or non-canonical.');
	}
	const authenticated = deepFreeze({ status: 'authenticated', evidence });
	VERIFIED_READINESS.add(authenticated);
	return authenticated;
}

export function isVerifiedSoundscaperProfessionalReadiness(value) {
	return !!value && typeof value === 'object' && VERIFIED_READINESS.has(value);
}

export function assertSoundscaperProfessionalReadinessArtifacts(verified, artifacts) {
	if (!isVerifiedSoundscaperProfessionalReadiness(verified)) {
		throw new TypeError('Professional readiness artifact matching requires verified evidence.');
	}
	const evidence = verified.evidence;
	const launcher = evidence.launcher;
	if (!sameArtifact(evidence.buildCandidate, artifacts?.buildCandidate)
		|| !sameNullableArtifact(evidence.osAudioCodec, artifacts?.osAudioCodec)
		|| !sameArtifact(evidence.deliveryFilesystem, artifacts?.deliveryFilesystem)
		|| launcher.peerPayloadSha256 !== artifacts?.pluginPeer?.sha256
		|| launcher.launcherPayloadSha256 !== artifacts?.isolation?.launcher?.sha256
		|| launcher.sandboxProfileSha256 !== artifacts?.isolation?.sandboxProfile?.sha256
		|| launcher.brokerPolicySha256 !== artifacts?.isolation?.brokerPolicy?.sha256
		|| launcher.runtimeClosureSha256
			!== soundscaperProfessionalRuntimeClosureSha256(
				artifacts?.runtimeClosure ?? artifacts?.isolation?.runtimeClosure,
			)) {
		throw new Error('Signed readiness does not bind the exact professional candidate/helper/codec/isolation closure.');
	}
	return verified;
}

export function soundscaperProfessionalRuntimeClosureSha256(value) {
	if (!Array.isArray(value) || value.length > 128 || value.some((entry) => (
		!entry || typeof entry !== 'object' || typeof entry.path !== 'string'
		|| entry.path.length < 1 || entry.path.length > 4096 || entry.path.includes('\0')
		|| !Number.isSafeInteger(entry.byteLength)
		|| entry.byteLength < 1 || !digestValue(entry.sha256)
	))) throw new TypeError('The professional runtime closure is invalid.');
	const canonical = value.map(({ path, byteLength, sha256 }) => ({ path, byteLength, sha256 }))
		.sort((left, right) => left.path.localeCompare(right.path));
	if (new Set(canonical.map(({ path }) => path)).size !== canonical.length) {
		throw new TypeError('The professional runtime closure paths are not unique.');
	}
	return sha256(Buffer.from(JSON.stringify(canonical)));
}

export function soundscaperProfessionalSourceAuthenticationSha256(value) {
	return sha256(Buffer.from(stableJson(value)));
}

export function normalizeSoundscaperProfessionalReadinessEvidence(value, target) {
	const row = closed(value, [
		'schemaVersion', 'kind', 'target', 'payload', 'buildCandidate',
		'deliveryFilesystem', 'osAudioCodec', 'sourceAuthenticationSha256',
		'toolchainIdentity', 'buildProvenance', 'macSigning', 'launcher', 'osIsolationAttested',
		'hostilePluginDenialAttested', 'realThirdPartyExecutionAttested', 'reviewedAt', 'reviewer',
	]);
	const payload = artifactEvidence(row.payload, 'payload');
	const buildCandidate = artifactEvidence(row.buildCandidate, 'build candidate');
	const deliveryFilesystem = artifactEvidence(row.deliveryFilesystem, 'delivery filesystem');
	const osAudioCodec = row.osAudioCodec === null ? null
		: artifactEvidence(row.osAudioCodec, 'OS audio codec');
	const build = closed(row.buildProvenance, [
		'sourceRevision', 'buildPlanSha256', 'nativeHostTreeSha256', 'helperAddonTreeSha256',
	]);
	const macSigning = macSigningEvidence(row.macSigning, target);
	const launcher = launcherEvidence(row.launcher, target);
	if (row.schemaVersion !== 2 || row.kind !== 'soundscaper-professional-native-production-readiness'
		|| row.target !== target || (target.startsWith('linux-') ? osAudioCodec !== null : osAudioCodec === null)
		|| !digestValue(row.sourceAuthenticationSha256)
		|| typeof row.toolchainIdentity !== 'string' || row.toolchainIdentity.length < 3
		|| row.toolchainIdentity.length > 512 || !REVISION.test(String(build.sourceRevision))
		|| !digestValue(build.buildPlanSha256) || !digestValue(build.nativeHostTreeSha256)
		|| !digestValue(build.helperAddonTreeSha256) || row.osIsolationAttested !== true
		|| row.hostilePluginDenialAttested !== true || row.realThirdPartyExecutionAttested !== true
		|| typeof row.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(row.reviewedAt)
		|| typeof row.reviewer !== 'string' || row.reviewer.length < 3 || row.reviewer.length > 128) {
		throw new TypeError('Signed professional production-readiness evidence is invalid.');
	}
	return deepFreeze({ schemaVersion: 2, kind: row.kind, target,
		payload, buildCandidate, deliveryFilesystem, osAudioCodec,
		sourceAuthenticationSha256: row.sourceAuthenticationSha256,
		toolchainIdentity: row.toolchainIdentity,
		buildProvenance: { sourceRevision: build.sourceRevision, buildPlanSha256: build.buildPlanSha256,
			nativeHostTreeSha256: build.nativeHostTreeSha256, helperAddonTreeSha256: build.helperAddonTreeSha256 },
		macSigning, launcher, osIsolationAttested: true, hostilePluginDenialAttested: true,
		realThirdPartyExecutionAttested: true, reviewedAt: row.reviewedAt, reviewer: row.reviewer,
	});
}

function macSigningEvidence(value, target) {
	if (target !== 'mac-arm64') {
		if (value !== null) throw new TypeError('Only mac-arm64 readiness can bind mac signing.');
		return null;
	}
	const row = closed(value, ['mode', 'identitySha256']);
	if (row.mode !== 'developer-id' || !digestValue(row.identitySha256)) {
		throw new TypeError('Stable mac-arm64 readiness requires Developer ID signing evidence.');
	}
	return Object.freeze({ mode: 'developer-id', identitySha256: row.identitySha256 });
}

function artifactEvidence(value, label) {
	const row = closed(value, ['byteLength', 'sha256']);
	if (!Number.isSafeInteger(row.byteLength) || row.byteLength < 1
		|| !digestValue(row.sha256)) {
		throw new TypeError(`The signed professional ${label} evidence is invalid.`);
	}
	return Object.freeze({ byteLength: Number(row.byteLength), sha256: row.sha256 });
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
function sameArtifact(left, right) {
	return !!right && left.byteLength === right.byteLength && left.sha256 === right.sha256;
}
function sameNullableArtifact(left, right) {
	return left === null ? right === null : right !== null && sameArtifact(left, right);
}
function sameMacSigning(left, right) {
	return left === null ? right === null
		: right !== null && right !== undefined && left.mode === right.mode
			&& left.identitySha256 === right.identitySha256;
}
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

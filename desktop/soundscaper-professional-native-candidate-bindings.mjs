/* SPDX-License-Identifier: AGPL-3.0-only */

/** Minimal closed extraction of readiness authority from an authenticated candidate receipt. */

import { createHash } from 'node:crypto';

const SHA256 = /^[a-f\d]{64}$/u;
const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const TARGETS = Object.freeze(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);

export function parseSoundscaperProfessionalNativeCandidateReadinessBindings(bytes, target) {
	const source = Buffer.from(bytes);
	let candidate;
	try { candidate = JSON.parse(String(source)); }
	catch { throw new TypeError('The professional candidate authority is not JSON.'); }
	if (!source.equals(canonicalJson(candidate))) {
		throw new TypeError('The professional candidate authority is not canonical JSON.');
	}
	return soundscaperProfessionalNativeCandidateReadinessBindings(candidate, target);
}

export function soundscaperProfessionalNativeCandidateReadinessBindings(candidate, target) {
	if (!TARGETS.includes(target)) throw new TypeError('The professional candidate target is unsupported.');
	closed(candidate, [
		'schemaVersion', 'kind', 'target', 'sourceRevision', 'buildPlanSha256',
		'evidenceReceipts', 'payload', 'osAudioCodec', 'pluginPeer', 'deliveryFilesystem',
		'isolation', 'productionReadiness',
	], 'candidate authority');
	if (candidate.schemaVersion !== 1
		|| candidate.kind !== 'soundscaper-professional-native-candidate'
		|| candidate.target !== target || !REVISION.test(String(candidate.sourceRevision))
		|| !SHA256.test(String(candidate.buildPlanSha256)) || candidate.productionReadiness !== null
		|| !Array.isArray(candidate.evidenceReceipts)) {
		throw new TypeError('The professional candidate authority identity is invalid.');
	}
	const receipts = candidate.evidenceReceipts.filter((entry) => entry?.kind === 'build');
	if (receipts.length !== 1) throw new TypeError('The professional candidate build authority is not exact.');
	const receipt = receipts[0];
	closed(receipt, ['kind', 'target', 'sha256', 'evidence'], 'candidate build receipt');
	closed(receipt.evidence, [
		'status', 'sourceRevision', 'buildPlanSha256', 'packagedAppAuthority', 'tests', 'macSigning',
	], 'candidate build evidence');
	if (receipt.target !== target || !SHA256.test(String(receipt.sha256))
		|| receipt.sha256 !== sha256(canonicalJson(receipt.evidence))
		|| receipt.evidence.status !== 'passed'
		|| receipt.evidence.sourceRevision !== candidate.sourceRevision
		|| receipt.evidence.buildPlanSha256 !== candidate.buildPlanSha256) {
		throw new TypeError('The professional candidate build authority is misbound.');
	}
	const macSigning = macSigningIdentity(receipt.evidence.macSigning, target);
	return deepFreeze({
		sourceRevision: candidate.sourceRevision,
		buildPlanSha256: candidate.buildPlanSha256,
		macSigning,
	});
}

function macSigningIdentity(value, target) {
	if (target !== 'mac-arm64') {
		if (value !== null) throw new TypeError('Only mac-arm64 can carry candidate signing authority.');
		return null;
	}
	closed(value, ['schemaVersion', 'status', 'target', 'signing', 'commands', 'artifacts'],
		'candidate mac signing evidence');
	closed(value.signing, ['mode', 'identitySha256'], 'candidate mac signing identity');
	if (value.schemaVersion !== 2 || value.status !== 'signatures-verified'
		|| value.target !== target || !['ad-hoc', 'developer-id'].includes(value.signing.mode)
		|| !SHA256.test(String(value.signing.identitySha256))
		|| !Array.isArray(value.artifacts)) {
		throw new TypeError('The candidate mac signing authority is invalid.');
	}
	return Object.freeze({
		mode: value.signing.mode,
		identitySha256: value.signing.identitySha256,
	});
}

function canonicalJson(value) { return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function closed(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Reflect.ownKeys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new TypeError(`Professional ${label} requires an exact record.`);
	}
}
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

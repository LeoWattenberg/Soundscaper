/* SPDX-License-Identifier: AGPL-3.0-only */

/** Minimal source/build-plan extraction from an authenticated native build result. */

import { createHash } from 'node:crypto';

const SHA256 = /^[a-f\d]{64}$/u;
const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const TARGETS = Object.freeze(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);

export function parseSoundscaperProfessionalNativeBuildAuthority(bytes, target) {
	const source = Buffer.from(bytes);
	let result;
	try { result = JSON.parse(String(source)); }
	catch { throw new TypeError('The professional build-result authority is not JSON.'); }
	if (!source.equals(canonicalJson(result))) {
		throw new TypeError('The professional build-result authority is not canonical JSON.');
	}
	return soundscaperProfessionalNativeBuildAuthority(result, target);
}

export function soundscaperProfessionalNativeBuildAuthority(result, target) {
	if (!TARGETS.includes(target)) throw new TypeError('The professional build-result target is unsupported.');
	closed(result, [
		'schemaVersion', 'kind', 'target', 'sourceRevision', 'buildPlanSha256',
		'evidenceReceipts', 'payload', 'osAudioCodec', 'pluginPeer', 'deliveryFilesystem',
		'isolation',
	], 'build-result authority');
	if (result.schemaVersion !== 1
		|| result.kind !== 'soundscaper-professional-native-build-result'
		|| result.target !== target || !REVISION.test(String(result.sourceRevision))
		|| !SHA256.test(String(result.buildPlanSha256))
		|| !Array.isArray(result.evidenceReceipts)) {
		throw new TypeError('The professional build-result authority identity is invalid.');
	}
	const receipts = result.evidenceReceipts.filter((entry) => entry?.kind === 'build');
	if (receipts.length !== 1) throw new TypeError('The professional build-result authority is not exact.');
	const receipt = receipts[0];
	closed(receipt, ['kind', 'target', 'sha256', 'evidence'], 'build-result receipt');
	closed(receipt.evidence, [
		'status', 'sourceRevision', 'buildPlanSha256', 'packagedAppAuthority', 'tests', 'macSigning',
	], 'build-result evidence');
	if (receipt.target !== target || !SHA256.test(String(receipt.sha256))
		|| receipt.sha256 !== sha256(canonicalJson(receipt.evidence))
		|| receipt.evidence.status !== 'passed'
		|| receipt.evidence.sourceRevision !== result.sourceRevision
		|| receipt.evidence.buildPlanSha256 !== result.buildPlanSha256) {
		throw new TypeError('The professional build-result authority is misbound.');
	}
	return deepFreeze({
		sourceRevision: result.sourceRevision,
		buildPlanSha256: result.buildPlanSha256,
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

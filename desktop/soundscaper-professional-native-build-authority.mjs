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
		'verificationChecks', 'payload', 'osAudioCodec', 'pluginPeer', 'deliveryFilesystem',
		'isolation',
	], 'build-result authority');
	if (result.schemaVersion !== 1
		|| result.kind !== 'soundscaper-professional-native-build-result'
		|| result.target !== target || !REVISION.test(String(result.sourceRevision))
		|| !SHA256.test(String(result.buildPlanSha256))
		|| !Array.isArray(result.verificationChecks)) {
		throw new TypeError('The professional build-result authority identity is invalid.');
	}
	const checks = result.verificationChecks.filter((entry) => entry?.kind === 'build');
	if (checks.length !== 1) throw new TypeError('The professional build-result authority is not exact.');
	const check = checks[0];
	closed(check, ['kind', 'target', 'sha256', 'result'], 'build-result verification check');
	closed(check.result, [
		'status', 'sourceRevision', 'buildPlanSha256', 'packagedAppAuthority', 'tests', 'macCodeSeal',
	], 'build-result check result');
	if (check.target !== target || !SHA256.test(String(check.sha256))
		|| check.sha256 !== sha256(canonicalJson(check.result))
		|| check.result.status !== 'passed'
		|| check.result.sourceRevision !== result.sourceRevision
		|| check.result.buildPlanSha256 !== result.buildPlanSha256) {
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

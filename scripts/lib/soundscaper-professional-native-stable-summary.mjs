/* SPDX-License-Identifier: AGPL-3.0-only */

/** Stable-only validation of the serialized, previously authenticated professional-native row. */

import {
	normalizeSoundscaperProfessionalReadinessEvidence,
	soundscaperProfessionalReadinessReference,
	soundscaperProfessionalRuntimeClosureSha256,
	soundscaperProfessionalSourceAuthenticationSha256,
} from '../../desktop/soundscaper-professional-native-readiness.mjs';
import { targetNativeExecutableName }
	from './soundscaper-professional-native-payload-names.mjs';

const SHA256 = /^[a-f\d]{64}$/u;
const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;

export function validateSoundscaperStableProfessionalNativeSummary(
	summary, targetId, manifestName, runtimeSourceRevision,
) {
	const label = `${manifestName} Stable 1 professional native`;
	assert(REVISION.test(String(runtimeSourceRevision)), `${label} runtime manifest source revision is invalid.`);
	assert(summary && typeof summary === 'object' && !Array.isArray(summary), `${label} summary is missing.`);
	assert(summary.target === targetId && summary.targetSource === 'declared', `${label} target is invalid.`);
	assert(summary.status === 'built' && summary.blockedBy === null,
		`${label} does not contain a promoted professional candidate.`);
	assert(summary.sourceAuthentication?.status === 'authenticated',
		`${label} source authentication is incomplete.`);
	assert(typeof summary.toolchainIdentity === 'string' && summary.toolchainIdentity.length >= 3,
		`${label} toolchain identity is incomplete.`);
	assert(summary.m9ReleaseReview?.scope === 'stable-1.0-release'
		&& summary.m9ReleaseReview?.status === 'complete', `${label} M9 review is incomplete.`);
	assertSummaryDescriptor(summary.payloadManifest, `${label} payload manifest`);
	assertSummaryDescriptor(summary.reviewPolicy, `${label} review policy`);
	const root = `native/soundscaper-professional-host/prebuilt/${targetId}/`;
	assert(summary.payload?.name === 'soundscaper_professional.node', `${label} payload is invalid.`);
	assertSummaryEvidence(summary.payload, `${label} payload`);
	assertSummaryArtifact(summary.buildCandidate,
		`${root}soundscaper-professional-native-candidate.json`, `${label} build candidate`);
	assertSummaryArtifact(summary.pluginPeer,
		`${root}${targetNativeExecutableName('soundscaper_professional_peer', targetId)}`,
		`${label} plug-in peer`);
	assertSummaryArtifact(summary.deliveryFilesystem,
		`${root}soundscaper_delivery_fs${targetId.startsWith('win-') ? '.exe' : ''}`,
		`${label} delivery filesystem`);
	if (targetId.startsWith('linux-')) {
		assert(summary.osAudioCodec === null, `${label} unexpectedly carries an OS audio codec.`);
	} else {
		assertSummaryArtifact(summary.osAudioCodec,
			`${root}soundscaper_os_audio_codec.node`, `${label} OS audio codec`);
	}
	const isolation = summary.isolation;
	assert(isolation && typeof isolation === 'object', `${label} isolation closure is missing.`);
	assertSummaryArtifact(isolation.launcher,
		`${root}${targetNativeExecutableName('milestone5-native-isolation-launcher', targetId)}`,
		`${label} isolation launcher`);
	assertSummaryArtifact(isolation.sandboxProfile,
		`${root}native-isolation-profile-v1.json`, `${label} sandbox profile`);
	assertSummaryArtifact(isolation.brokerPolicy,
		`${root}native-isolation-broker-v1.json`, `${label} broker policy`);
	assert(Array.isArray(isolation.runtimeClosure) && isolation.runtimeClosure.length <= 128,
		`${label} runtime closure is invalid.`);
	const closurePaths = new Set();
	for (const artifact of isolation.runtimeClosure) {
		assertSummaryArtifact(artifact, null, `${label} runtime closure`);
		assert(artifact.path.startsWith(`${root}runtime/`) && !closurePaths.has(artifact.path),
			`${label} runtime closure is invalid.`);
		closurePaths.add(artifact.path);
	}
	assert(isolation.entrypointPath === summary.pluginPeer.path
		|| closurePaths.has(isolation.entrypointPath), `${label} isolation entrypoint is invalid.`);
	validateStableProfessionalReadiness(summary, targetId, label, runtimeSourceRevision);
}

function validateStableProfessionalReadiness(summary, targetId, label, runtimeSourceRevision) {
	const readiness = exactRecord(summary.productionReadiness, ['reference', 'evidence', 'verified'],
		`${label} production readiness`);
	const evidenceName = 'soundscaper-professional-native-readiness.json';
	const reference = soundscaperProfessionalReadinessReference(readiness.reference, targetId);
	assert(JSON.stringify(reference) === JSON.stringify(readiness.reference),
		`${label} production readiness reference is non-canonical.`);
	const descriptor = exactRecord(readiness.evidence, ['name', 'byteLength', 'sha256'],
		`${label} production readiness descriptor`);
	assert(reference.evidence.byteLength === descriptor.byteLength
		&& reference.evidence.sha256 === descriptor.sha256 && descriptor.name === evidenceName,
		`${label} production readiness descriptor is inconsistent.`);
	const verified = exactRecord(readiness.verified, ['status', 'evidence'],
		`${label} verified production readiness`);
	assert(verified.status === 'authenticated', `${label} production readiness is incomplete.`);
	const evidence = normalizeSoundscaperProfessionalReadinessEvidence(verified.evidence, targetId);
	assert(JSON.stringify(evidence) === JSON.stringify(verified.evidence),
		`${label} verified production readiness is non-canonical.`);
	const authority = candidateAuthority(summary.candidateAuthority, targetId, label);
	assert(authority.sourceRevision === runtimeSourceRevision,
		`${label} candidate source revision does not match the runtime manifest source revision.`);
	assert(evidence.sourceAuthenticationSha256
		=== soundscaperProfessionalSourceAuthenticationSha256(summary.sourceAuthentication)
		&& evidence.toolchainIdentity === summary.toolchainIdentity,
	`${label} signed readiness does not bind source and toolchain authority.`);
	assert(evidence.buildProvenance.sourceRevision === authority.sourceRevision
		&& evidence.buildProvenance.buildPlanSha256 === authority.buildPlanSha256,
	`${label} signed readiness does not bind candidate build provenance.`);
	assert(JSON.stringify(evidence.macSigning) === JSON.stringify(authority.macSigning),
		`${label} signed readiness does not bind Developer ID evidence.`);
	assert(sameSummaryEvidence(evidence.payload, summary.payload), `${label} signed readiness does not bind the payload.`);
	assert(sameSummaryEvidence(evidence.buildCandidate, summary.buildCandidate),
		`${label} signed readiness does not bind the build candidate.`);
	assert(sameSummaryEvidence(evidence.deliveryFilesystem, summary.deliveryFilesystem),
		`${label} signed readiness does not bind the delivery filesystem.`);
	assert(summary.osAudioCodec === null ? evidence.osAudioCodec === null
		: sameSummaryEvidence(evidence.osAudioCodec, summary.osAudioCodec),
	`${label} signed readiness does not bind the OS audio codec.`);
	assert(evidence.launcher.launcherPayloadSha256 === summary.isolation.launcher.sha256
		&& evidence.launcher.sandboxProfileSha256 === summary.isolation.sandboxProfile.sha256
		&& evidence.launcher.brokerPolicySha256 === summary.isolation.brokerPolicy.sha256
		&& evidence.launcher.peerPayloadSha256 === summary.pluginPeer.sha256,
	`${label} signed readiness does not bind the isolation artifacts.`);
	assert(evidence.launcher.runtimeClosureSha256
		=== soundscaperProfessionalRuntimeClosureSha256(summary.isolation.runtimeClosure),
	`${label} signed readiness does not bind the runtime closure.`);
}

function candidateAuthority(value, targetId, label) {
	const row = exactRecord(value, ['sourceRevision', 'buildPlanSha256', 'macSigning'],
		`${label} candidate authority`);
	assert(REVISION.test(String(row.sourceRevision)) && SHA256.test(String(row.buildPlanSha256)),
		`${label} candidate authority is invalid.`);
	if (targetId === 'mac-arm64') {
		const signing = exactRecord(row.macSigning, ['mode', 'identitySha256'],
			`${label} Developer ID authority`);
		assert(signing.mode === 'developer-id' && SHA256.test(String(signing.identitySha256)),
			`${label} requires Developer ID evidence.`);
	} else assert(row.macSigning === null, `${label} has target-inappropriate mac signing evidence.`);
	return row;
}

function assertSummaryArtifact(value, expectedPath, label) {
	assert(value && typeof value.path === 'string' && !value.path.includes('\\')
		&& !value.path.split('/').includes('..') && (expectedPath === null || value.path === expectedPath),
	`${label} path is invalid.`);
	assertSummaryEvidence(value, label);
}
function assertSummaryDescriptor(value, label) {
	assert(value && (typeof value.id === 'string' || typeof value.name === 'string'),
		`${label} identity is invalid.`);
	assertSummaryEvidence(value, label);
}
function assertSummaryEvidence(value, label) {
	assert(value && Number.isSafeInteger(value.byteLength) && value.byteLength > 0
		&& SHA256.test(String(value.sha256)), `${label} evidence is invalid.`);
}
function sameSummaryEvidence(left, right) {
	return left?.byteLength === right?.byteLength && left?.sha256 === right?.sha256;
}
function exactRecord(value, fields, label) {
	assert(value && typeof value === 'object' && !Array.isArray(value)
		&& JSON.stringify(Reflect.ownKeys(value).sort()) === JSON.stringify([...fields].sort()),
	`${label} requires an exact record.`);
	return value;
}
function assert(condition, message) { if (!condition) throw new Error(message); }

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Stable-package validation for an already verified professional-native build result. */

import { targetNativeExecutableName }
	from './soundscaper-professional-native-payload-names.mjs';

const SHA256 = /^[a-f\d]{64}$/u;
const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;

export function validateSoundscaperStableProfessionalNativeSummary(
	summary, targetId, manifestName, runtimeSourceRevision,
) {
	const label = `${manifestName} stable professional native`;
	assert(REVISION.test(String(runtimeSourceRevision)), `${label} runtime manifest source revision is invalid.`);
	exactRecord(summary, [
		'target', 'targetSource', 'status', 'blockedBy', 'payloadManifest',
		'sourceAuthentication', 'toolchainIdentity', 'buildAuthority', 'payload',
		'buildResult', 'osAudioCodec', 'pluginPeer', 'deliveryFilesystem', 'isolation',
	], `${label} summary`);
	assert(summary.target === targetId && summary.targetSource === 'declared', `${label} target is invalid.`);
	assert(summary.status === 'built' && summary.blockedBy === null,
		`${label} does not contain a professional build result.`);
	assert(summary.sourceAuthentication?.status === 'authenticated',
		`${label} source authentication is incomplete.`);
	assert(typeof summary.toolchainIdentity === 'string' && summary.toolchainIdentity.length >= 3,
		`${label} toolchain identity is incomplete.`);
	assertSummaryDescriptor(summary.payloadManifest, `${label} payload manifest`);
	const authority = exactRecord(summary.buildAuthority, ['sourceRevision', 'buildPlanSha256'],
		`${label} build authority`);
	assert(REVISION.test(String(authority.sourceRevision))
		&& SHA256.test(String(authority.buildPlanSha256)), `${label} build authority is invalid.`);
	assert(authority.sourceRevision === runtimeSourceRevision,
		`${label} build source revision does not match the runtime manifest source revision.`);
	const root = `native/soundscaper-professional-host/prebuilt/${targetId}/`;
	assert(summary.payload?.name === 'soundscaper_professional.node', `${label} payload is invalid.`);
	assertSummaryFileDigest(summary.payload, `${label} payload`);
	assertSummaryArtifact(summary.buildResult,
		`${root}soundscaper-professional-native-build-result.json`, `${label} build result`);
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
	const isolation = exactRecord(summary.isolation, [
		'launcher', 'sandboxProfile', 'brokerPolicy', 'entrypointPath', 'runtimeClosure',
	], `${label} isolation closure`);
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
}

function assertSummaryArtifact(value, expectedPath, label) {
	exactRecord(value, ['path', 'byteLength', 'sha256'], label);
	assert(typeof value.path === 'string' && !value.path.includes('\\')
		&& !value.path.split('/').includes('..') && (expectedPath === null || value.path === expectedPath),
	`${label} path is invalid.`);
	assertSummaryFileDigest(value, label);
}
function assertSummaryDescriptor(value, label) {
	assert(value && (typeof value.id === 'string' || typeof value.name === 'string'),
		`${label} identity is invalid.`);
	assertSummaryFileDigest(value, label);
}
function assertSummaryFileDigest(value, label) {
	assert(value && Number.isSafeInteger(value.byteLength) && value.byteLength > 0
		&& SHA256.test(String(value.sha256)), `${label} file digest is invalid.`);
}
function exactRecord(value, fields, label) {
	assert(value && typeof value === 'object' && !Array.isArray(value)
		&& JSON.stringify(Reflect.ownKeys(value).sort()) === JSON.stringify([...fields].sort()),
	`${label} requires an exact record.`);
	return value;
}
function assert(condition, message) { if (!condition) throw new Error(message); }

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact build/stage/runtime authority for the professional Soundscaper addon. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import { renameIntoPlaceExclusively } from './exclusive-rename.mjs';
import {
	deliveryFilesystemName, professionalIsolationLauncherName,
	professionalNativeSummaryArtifact as summaryArtifact, professionalPluginPeerName,
} from './soundscaper-professional-native-payload-names.mjs';
import {
	assertSoundscaperProfessionalReadinessArtifacts, soundscaperProfessionalReadinessReference,
	verifySoundscaperProfessionalReadiness,
} from '../../desktop/soundscaper-professional-native-readiness.mjs';
import {
	MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH,
	resolveNativeIsolationReviewPublicKey,
	validateNativeIsolationReviewPolicy,
} from '../../desktop/native-isolation-review-policy.mjs';
import {
	describeSoundscaperProfessionalNativePayload as describeRuntimeProfessionalNativePayload,
} from '../../desktop/soundscaper-professional-native-payload.mjs';
import {
	canonicalJson as canonicalCandidateJson, evidenceFor as candidateEvidenceFor, validateCandidateReceipt,
} from './soundscaper-professional-native-candidate-contract.mjs';
import { soundscaperProfessionalNativeCandidateReadinessBindings } from '../../desktop/soundscaper-professional-native-candidate-bindings.mjs';

export const PROFESSIONAL_NATIVE_MANIFEST_PATH =
	'config/soundscaper-professional-native-payload-manifest.json';
const NATIVE_SOURCE_MANIFEST_PATH = 'config/milestone-5-native-source-acquisitions.json';
export const PROFESSIONAL_NATIVE_TARGETS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
export const PROFESSIONAL_NATIVE_RUNTIME_PREFIX = 'native/soundscaper-professional-host';
export const PROFESSIONAL_NATIVE_REVIEW_POLICY_NAME =
	'milestone-5-native-isolation-review-policy.json';
const VERIFIED = new WeakSet();
const SHA256 = /^[a-f\d]{64}$/u;

export async function verifySoundscaperProfessionalNativePayload({
	repositoryRoot, target, targetSource = 'declared',
}) {
	assert(typeof repositoryRoot === 'string' && repositoryRoot, 'repositoryRoot is required.');
	assert(PROFESSIONAL_NATIVE_TARGETS.includes(target),
		`The professional native payload manifest has no ${String(target)} target.`);
	assert(targetSource === 'declared' || targetSource === 'build-host', 'Invalid target source.');
	const root = resolve(repositoryRoot);
	const manifestBytes = await regularFile(resolve(root, PROFESSIONAL_NATIVE_MANIFEST_PATH),
		'professional native payload manifest');
	const manifest = parse(manifestBytes, 'professional native payload manifest');
	const sources = parse(await regularFile(resolve(root, NATIVE_SOURCE_MANIFEST_PATH),
		'M5 native source manifest'), 'M5 native source manifest');
	let reviewPolicyBytes = null;
	let reviewPolicy = null;
	let reviewPolicyFailure = null;
	try {
		reviewPolicyBytes = await regularFile(
			resolve(root, MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH),
			'M5 native-isolation review policy',
		);
		reviewPolicy = parse(reviewPolicyBytes, 'M5 native-isolation review policy');
		validateNativeIsolationReviewPolicy(reviewPolicy);
	} catch (error) { reviewPolicyFailure = errorMessage(error); }
	validateManifest(manifest, sources);
	const selected = manifest.targets.find((entry) => entry.id === target);
	assert(selected, `The professional native payload manifest has no ${target} target.`);
	let payload = null;
	let osAudioCodec = null;
	let pluginPeer = null;
	let deliveryFilesystem = null;
	let isolation = null;
	let buildCandidate = null;
	let productionReadiness = null;
	let m9ReleaseReview = Object.freeze({
		scope: 'stable-1.0-release', status: 'pending',
		detail: 'No independent professional-native review is recorded for stable 1.0 release admission.',
	});
	if (selected.status === 'built') {
		const targetRoot = `native/soundscaper-professional-host/prebuilt/${target}`;
		const expectedPath = `${targetRoot}/${manifest.addon.payloadName}`;
		assert(selected.blockedBy === null && selected.payload?.path === expectedPath,
			`The professional native ${target} payload path is invalid.`);
		const bytes = await regularFile(resolve(root, expectedPath), `professional native payload ${target}`);
		verifyBytes(bytes, selected.payload, `professional native payload ${target}`);
		payload = Object.freeze({ ...selected.payload, name: manifest.addon.payloadName, bytes });
		buildCandidate = await readArtifact(root, selected.buildCandidate,
			`${targetRoot}/soundscaper-professional-native-candidate.json`,
			'professional native build-candidate receipt');
		const candidate = parse(buildCandidate.bytes, 'professional native build-candidate receipt');
		assert(buildCandidate.bytes.equals(canonicalCandidateJson(candidate)),
			'The professional native build-candidate receipt is not canonical JSON.');
		validateCandidateReceipt(candidate);
		const candidateAuthority = soundscaperProfessionalNativeCandidateReadinessBindings(candidate, target);
		osAudioCodec = selected.osAudioCodec === null ? null
			: await readArtifact(root, selected.osAudioCodec,
				`${targetRoot}/soundscaper_os_audio_codec.node`, 'operating-system audio codec addon');
		pluginPeer = await readArtifact(root, selected.pluginPeer,
			`${targetRoot}/${professionalPluginPeerName(manifest, target)}`, 'professional plug-in peer');
		deliveryFilesystem = await readArtifact(root, selected.deliveryFilesystem,
			`${targetRoot}/${deliveryFilesystemName(manifest, target)}`,
			'persistent-delivery filesystem helper');
		isolation = Object.freeze({
			launcher: await readArtifact(root, selected.isolation.launcher,
				`${targetRoot}/${professionalIsolationLauncherName(manifest, target)}`,
				'native-isolation launcher'),
			sandboxProfile: await readArtifact(root, selected.isolation.sandboxProfile,
				`${targetRoot}/${manifest.isolation.profileName}`, 'native-isolation profile'),
			brokerPolicy: await readArtifact(root, selected.isolation.brokerPolicy,
				`${targetRoot}/${manifest.isolation.brokerPolicyName}`, 'native-isolation broker policy'),
			entrypointPath: selected.isolation.entrypointPath,
			runtimeClosure: Object.freeze(await Promise.all(selected.isolation.runtimeClosure.map((entry) =>
				readArtifact(root, entry, entry.path, 'professional runtime closure')))),
		});
		assertCandidateMatchesTarget(candidate, selected);
		if (selected.productionReadiness !== null) {
			try {
				assert(reviewPolicy !== null,
					`The M9 review policy is unavailable: ${reviewPolicyFailure ?? 'not mounted'}.`);
				const reference = soundscaperProfessionalReadinessReference(selected.productionReadiness, target);
				const evidence = await verifySoundscaperProfessionalReadiness(reference, {
					target, payload: selected.payload, sourceAuthentication: selected.sourceAuthentication,
					toolchainIdentity: selected.toolchainIdentity,
					buildCandidate: selected.buildCandidate,
					deliveryFilesystem: selected.deliveryFilesystem,
					osAudioCodec: selected.osAudioCodec,
					runtimeClosure: selected.isolation.runtimeClosure,
					candidateAuthority,
				}, {
					readEvidence: (path) => regularFile(resolve(root, path), 'professional readiness evidence'),
					resolveReviewPublicKey: (keyId) => resolveNativeIsolationReviewPublicKey(reviewPolicy, {
						usage: 'soundscaper-professional-native-production-readiness', target, keyId,
					}),
				});
				const evidenceBytes = await regularFile(resolve(root, reference.evidence.path),
					'professional readiness evidence');
				assertSoundscaperProfessionalReadinessArtifacts(evidence, {
					buildCandidate, osAudioCodec, deliveryFilesystem, pluginPeer, isolation,
					runtimeClosure: selected.isolation.runtimeClosure,
				});
				productionReadiness = Object.freeze({
					reference, evidence, evidenceBytes, candidateAuthority,
				});
				m9ReleaseReview = Object.freeze({
					scope: 'stable-1.0-release', status: 'complete', evidence: productionReadiness,
				});
			} catch (error) {
				m9ReleaseReview = Object.freeze({
					scope: 'stable-1.0-release', status: 'invalid',
					detail: `The recorded professional-native M9 review is invalid: ${errorMessage(error)}`.slice(0, 512),
				});
			}
		}
	} else {
		assert(selected.status === 'pending-external' && selected.payload === null
			&& typeof selected.blockedBy === 'string' && selected.blockedBy.length > 0,
		`The professional native ${target} target has an invalid pending state.`);
	}
	const release = Object.freeze({
		repositoryRoot: root, manifest, manifestBytes,
		manifestSha256: digest(manifestBytes), target: selected, targetSource,
		payload, osAudioCodec, pluginPeer, deliveryFilesystem, isolation, buildCandidate,
		productionReadiness, m9ReleaseReview,
		reviewPolicy: reviewPolicyBytes === null ? null : Object.freeze({
			name: PROFESSIONAL_NATIVE_REVIEW_POLICY_NAME,
			byteLength: reviewPolicyBytes.byteLength,
			sha256: digest(reviewPolicyBytes), bytes: reviewPolicyBytes,
		}),
	});
	VERIFIED.add(release);
	return release;
}

export function professionalNativePayloadStageSummary(release) {
	assertRelease(release);
	return Object.freeze({
		target: release.target.id,
		targetSource: release.targetSource,
		status: release.target.status,
		blockedBy: release.target.blockedBy,
		payloadManifest: Object.freeze({
			id: release.manifest.id, byteLength: release.manifestBytes.byteLength, sha256: release.manifestSha256,
		}),
		reviewPolicy: release.reviewPolicy === null ? null : Object.freeze({
			name: release.reviewPolicy.name, byteLength: release.reviewPolicy.byteLength,
			sha256: release.reviewPolicy.sha256,
		}),
		m9ReleaseReview: release.m9ReleaseReview.status === 'complete'
			? deepFreeze({
				scope: release.m9ReleaseReview.scope, status: release.m9ReleaseReview.status,
				reviewer: release.m9ReleaseReview.evidence.evidence.evidence.reviewer,
				reviewedAt: release.m9ReleaseReview.evidence.evidence.evidence.reviewedAt,
			}) : deepFreeze(structuredClone(release.m9ReleaseReview)),
		sourceAuthentication: release.target.sourceAuthentication === null ? null
			: deepFreeze(structuredClone(release.target.sourceAuthentication)),
		toolchainIdentity: release.target.toolchainIdentity,
		candidateAuthority: release.productionReadiness === null ? null
			: deepFreeze(structuredClone(release.productionReadiness.candidateAuthority)),
		productionReadiness: release.productionReadiness === null ? null : deepFreeze({
			reference: structuredClone(release.productionReadiness.reference),
			evidence: {
				name: release.productionReadiness.reference.evidence.path.split('/').at(-1),
				byteLength: release.productionReadiness.evidenceBytes.byteLength,
				sha256: digest(release.productionReadiness.evidenceBytes),
			},
			verified: structuredClone(release.productionReadiness.evidence),
		}),
		payload: release.payload === null ? null : Object.freeze({
			name: release.payload.name,
			byteLength: release.payload.byteLength,
			sha256: release.payload.sha256,
		}),
		buildCandidate: summaryArtifact(release.buildCandidate),
		osAudioCodec: summaryArtifact(release.osAudioCodec),
		pluginPeer: summaryArtifact(release.pluginPeer),
		deliveryFilesystem: summaryArtifact(release.deliveryFilesystem),
		isolation: release.isolation === null ? null : Object.freeze({
			launcher: summaryArtifact(release.isolation.launcher),
			sandboxProfile: summaryArtifact(release.isolation.sandboxProfile),
			brokerPolicy: summaryArtifact(release.isolation.brokerPolicy),
			entrypointPath: release.isolation.entrypointPath,
			runtimeClosure: Object.freeze(release.isolation.runtimeClosure.map(summaryArtifact)),
		}),
	});
}

export function professionalNativePayloadOutputRoot(runtimeRoot, release) {
	assertRelease(release);
	return resolve(runtimeRoot, release.manifest.staging.runtimePrefix, release.target.id);
}

export function assertSoundscaperProfessionalNativeStablePackageRelease(release) {
	assertRelease(release);
	assert(release.target.status === 'built' && release.payload !== null
		&& release.buildCandidate !== null && release.deliveryFilesystem !== null,
	`Stable Soundscaper packaging requires a promoted professional candidate for ${release.target.id}.`);
	assert(release.productionReadiness !== null && release.m9ReleaseReview.status === 'complete',
		`Stable Soundscaper packaging requires non-pending production readiness for ${release.target.id}.`);
	return deepFreeze({
		id: release.target.id,
		status: 'ready',
		sourceRevision: release.productionReadiness.candidateAuthority.sourceRevision,
		payloadSha256: release.payload.sha256,
		buildCandidateSha256: release.buildCandidate.sha256,
		productionReadinessSha256: release.productionReadiness.reference.evidence.sha256,
	});
}

export async function auditSoundscaperProfessionalNativeStablePayloads({ repositoryRoot }) {
	const releases = await Promise.all(PROFESSIONAL_NATIVE_TARGETS.map((target) =>
		verifySoundscaperProfessionalNativePayload({ repositoryRoot, target, targetSource: 'declared' })));
	const targets = releases.map(stableAuditTarget);
	const blockers = targets.flatMap((target) => target.status === 'ready' ? []
		: target.blockers.map((detail) => Object.freeze({ target: target.id, detail })));
	return deepFreeze({
		schemaVersion: 1,
		status: blockers.length === 0 ? 'ready' : 'blocked',
		targets,
		blockers,
	});
}

function stableAuditTarget(release) {
	if (release.target.status !== 'built' || release.payload === null
		|| release.buildCandidate === null) {
		return Object.freeze({
			id: release.target.id,
			status: 'blocked',
			blockers: Object.freeze([release.target.blockedBy
				?? `No promoted professional candidate exists for ${release.target.id}.`]),
		});
	}
	if (release.productionReadiness === null || release.m9ReleaseReview.status !== 'complete') {
		return Object.freeze({
			id: release.target.id,
			status: 'blocked',
			blockers: Object.freeze([
				release.m9ReleaseReview.detail
				?? `Production readiness is pending for ${release.target.id}.`,
			]),
		});
	}
	return assertSoundscaperProfessionalNativeStablePackageRelease(release);
}

export async function stageVerifiedSoundscaperProfessionalNativePayload({ release, outputRoot }) {
	assertRelease(release);
	const manifestBytes = Buffer.from(release.manifestBytes);
	const payload = release.payload === null ? null
		: { ...release.payload, bytes: Buffer.from(release.payload.bytes) };
	const nativeArtifacts = release.payload === null ? [] : [
		release.buildCandidate, ...(release.osAudioCodec === null ? [] : [release.osAudioCodec]),
		release.pluginPeer, release.deliveryFilesystem, release.isolation.launcher,
		release.isolation.sandboxProfile,
		release.isolation.brokerPolicy, ...release.isolation.runtimeClosure,
	];
	const readiness = release.productionReadiness === null ? null : {
		name: release.productionReadiness.reference.evidence.path.split('/').at(-1),
		bytes: Buffer.from(release.productionReadiness.evidenceBytes),
	};
	const reviewPolicy = release.reviewPolicy === null ? null
		: { ...release.reviewPolicy, bytes: Buffer.from(release.reviewPolicy.bytes) };
	await renameIntoPlaceExclusively(resolve(outputRoot), 'professional native payload output', async (temporary) => {
		await writeFile(resolve(temporary, release.manifest.staging.manifestName), manifestBytes, { flag: 'wx' });
		if (reviewPolicy) await writeFile(resolve(temporary, reviewPolicy.name), reviewPolicy.bytes, { flag: 'wx' });
		if (payload) await writeFile(resolve(temporary, payload.name), payload.bytes, { flag: 'wx', mode: 0o755 });
		for (const artifact of nativeArtifacts) {
			const output = resolve(temporary, relativeTargetPath(release, artifact.path));
			await mkdir(dirname(output), { recursive: true });
			await writeFile(output, artifact.bytes, { flag: 'wx', mode: executableArtifact(release, artifact) ? 0o755 : 0o444 });
		}
		if (readiness) await writeFile(resolve(temporary, readiness.name), readiness.bytes, { flag: 'wx' });
		return temporary;
	});
	return professionalNativePayloadStageSummary(release);
}

export async function verifyStagedSoundscaperProfessionalNativePayload({
	release, outputRoot, stageManifestPath = null,
}) {
	assertRelease(release);
	const entries = await collectStagedFiles(resolve(outputRoot));
	const expected = [release.manifest.staging.manifestName,
		...(release.reviewPolicy ? [release.reviewPolicy.name] : []),
		...(release.payload ? [release.payload.name] : []),
		...(release.payload ? [
			relativeTargetPath(release, release.buildCandidate.path),
			...(release.osAudioCodec === null ? []
				: [relativeTargetPath(release, release.osAudioCodec.path)]),
			relativeTargetPath(release, release.pluginPeer.path),
			relativeTargetPath(release, release.deliveryFilesystem.path),
			relativeTargetPath(release, release.isolation.launcher.path),
			relativeTargetPath(release, release.isolation.sandboxProfile.path),
			relativeTargetPath(release, release.isolation.brokerPolicy.path),
			...release.isolation.runtimeClosure.map(({ path }) => relativeTargetPath(release, path)),
		] : []),
		...(release.productionReadiness ? [release.productionReadiness.reference.evidence.path.split('/').at(-1)] : []),
	].sort();
	assert(JSON.stringify(entries) === JSON.stringify(expected),
		`Staged professional native payload inventory mismatch: ${entries.join(', ') || '<empty>'}.`);
	const manifestBytes = await regularFile(resolve(outputRoot, release.manifest.staging.manifestName),
		'staged professional native payload manifest');
	assert(manifestBytes.equals(release.manifestBytes),
		'The staged professional native payload manifest does not match the verified policy manifest.');
	if (release.reviewPolicy) {
		const reviewPolicyBytes = await regularFile(resolve(outputRoot, release.reviewPolicy.name),
			'staged professional native-isolation review policy');
		verifyBytes(reviewPolicyBytes, release.reviewPolicy,
			'staged professional native-isolation review policy');
	}
	if (release.payload) {
		const bytes = await regularFile(resolve(outputRoot, release.payload.name), 'staged professional native payload');
		verifyBytes(bytes, release.payload, 'staged professional native payload');
		for (const artifact of [release.pluginPeer, release.deliveryFilesystem,
			release.isolation.launcher,
			release.buildCandidate, ...(release.osAudioCodec === null ? [] : [release.osAudioCodec]),
			release.isolation.sandboxProfile, release.isolation.brokerPolicy, ...release.isolation.runtimeClosure]) {
			verifyBytes(await regularFile(resolve(outputRoot, relativeTargetPath(release, artifact.path)),
				'staged professional native artifact'), artifact, 'staged professional native artifact');
		}
	}
	if (release.productionReadiness) {
		const name = release.productionReadiness.reference.evidence.path.split('/').at(-1);
		const bytes = await regularFile(resolve(outputRoot, name), 'staged professional readiness evidence');
		assert(bytes.equals(release.productionReadiness.evidenceBytes),
			'The staged professional readiness evidence does not match its reopened signed bytes.');
	}
	if (stageManifestPath !== null) {
		const stage = parse(await regularFile(stageManifestPath, 'desktop stage manifest'), 'desktop stage manifest');
		assert(JSON.stringify(stage.soundscaperProfessionalNative)
			=== JSON.stringify(professionalNativePayloadStageSummary(release)),
		'The desktop stage manifest does not retain the professional native payload summary.');
	}
	return professionalNativePayloadStageSummary(release);
}

export async function describeSoundscaperProfessionalNativePayload(location, readFileImpl = readFile) {
	return describeRuntimeProfessionalNativePayload(location, readFileImpl);
}

export function createSoundscaperProfessionalNativeVerifier(location, readFileImpl) {
	return async () => {
		const result = await describeSoundscaperProfessionalNativePayload(location, readFileImpl);
		if (result.status !== 'available') {
			throw new Error(`The professional native payload is unavailable (${result.reason}): ${result.detail}`);
		}
		return result.descriptor;
	};
}

function validateManifest(value, sourceRegister) {
	assert(value?.schemaVersion === 1 && value.id === 'soundscaper-professional-native-host-1.0.0',
		'The professional native payload manifest identity is invalid.');
	assert(value.addon?.payloadName === 'soundscaper_professional.node'
		&& value.addon?.napiVersion === 8 && value.addon?.license === 'AGPL-3.0-only',
		'The professional native addon description is invalid.');
	assert(value.pluginPeer?.payloadName === 'soundscaper_professional_peer'
		&& value.pluginPeer?.protocol === 'M5F1' && value.pluginPeer?.license === 'AGPL-3.0-only'
		&& value.deliveryFilesystem?.payloadName === 'soundscaper_delivery_fs'
		&& value.deliveryFilesystem?.protocol === 'SDF1'
		&& value.deliveryFilesystem?.license === 'AGPL-3.0-only'
		&& value.isolation?.launcherName === 'milestone5-native-isolation-launcher'
		&& value.isolation?.profileName === 'native-isolation-profile-v1.json'
		&& value.isolation?.brokerPolicyName === 'native-isolation-broker-v1.json'
		&& value.isolation?.runtimeDirectory === 'runtime',
	'The professional peer/isolation description is invalid.');
	assert(value.staging?.runtimePrefix === PROFESSIONAL_NATIVE_RUNTIME_PREFIX
		&& value.staging?.manifestName === 'soundscaper-professional-native-payload-manifest.json',
		'The professional native staging layout is invalid.');
	assert(Array.isArray(value.targets) && value.targets.length === PROFESSIONAL_NATIVE_TARGETS.length
		&& PROFESSIONAL_NATIVE_TARGETS.every((id) => value.targets.filter((entry) => entry.id === id).length === 1),
		'The professional native target inventory is invalid.');
	for (const target of value.targets) {
		assert(target.status === 'built' || target.status === 'pending-external',
			`The professional native ${target.id} status is invalid.`);
		if (target.status === 'built') {
			const root = `native/soundscaper-professional-host/prebuilt/${target.id}`;
			assert(typeof target.toolchainIdentity === 'string' && target.toolchainIdentity.length > 0
				&& target.payload && Number.isSafeInteger(target.payload.byteLength) && target.payload.byteLength > 0
				&& SHA256.test(String(target.payload.sha256))
				&& validArtifact(target.buildCandidate,
					`${root}/soundscaper-professional-native-candidate.json`)
				&& (target.id.startsWith('linux-') ? target.osAudioCodec === null
					: validArtifact(target.osAudioCodec, `${root}/soundscaper_os_audio_codec.node`))
				&& validArtifact(target.deliveryFilesystem,
					`${root}/${deliveryFilesystemName(value, target.id)}`)
				&& validIsolation(target, value)
				&& validSourceAuthentication(target.sourceAuthentication, target.id, sourceRegister)
				&& target.productionReadiness !== undefined,
			`The professional native ${target.id} built record is invalid.`);
		} else {
			assert(target.sourceAuthentication === null && target.productionReadiness === null
				&& target.buildCandidate === null && target.payload === null
				&& target.osAudioCodec === null && target.pluginPeer === null
				&& target.deliveryFilesystem === null && target.isolation === null,
				`The pending professional native ${target.id} target cannot claim source authentication.`);
		}
	}
	return value;
}

function validSourceAuthentication(value, target, sourceRegister) {
	const ids = ['electron-node-api-headers', 'juce', 'clap', 'vst3-sdk',
		...(target.startsWith('win-') ? ['asio-sdk'] : []),
		...(target.startsWith('linux-') ? ['lv2'] : [])];
	return value?.schemaVersion === 1 && value.status === 'authenticated'
		&& Array.isArray(value.sources) && value.sources.length === ids.length
		&& ids.every((id) => value.sources.filter((source) => source?.id === id).length === 1)
		&& value.sources.every((source) => {
			const pinned = Array.isArray(sourceRegister?.sources)
				? sourceRegister.sources.filter((entry) => entry?.id === source.id) : [];
			return pinned.length === 1 && source.authenticationStatus === 'authenticated'
			&& Number.isSafeInteger(source.archiveEvidence?.byteLength) && source.archiveEvidence.byteLength > 0
			&& SHA256.test(String(source.archiveEvidence?.sha256))
			&& source.extractedTreeEvidence?.algorithm === 'framescaper-portable-source-tree-sha256-v1'
			&& Number.isSafeInteger(source.extractedTreeEvidence?.fileCount)
			&& source.extractedTreeEvidence.fileCount > 0
			&& SHA256.test(String(source.extractedTreeEvidence?.sha256))
			&& source.archiveEvidence.byteLength === pinned[0].archive?.byteLength
			&& source.archiveEvidence.sha256 === pinned[0].archive?.sha256
			&& source.extractedTreeEvidence.algorithm === pinned[0].extractedTree?.algorithm
			&& source.extractedTreeEvidence.fileCount === pinned[0].extractedTree?.fileCount
			&& source.extractedTreeEvidence.sha256 === pinned[0].extractedTree?.sha256;
		});
}

function validIsolation(target, manifest) {
	const root = `native/soundscaper-professional-host/prebuilt/${target.id}`;
	if (!validArtifact(target.pluginPeer, `${root}/${professionalPluginPeerName(manifest, target.id)}`)
		|| !target.isolation || !exactKeys(target.isolation,
			['launcher', 'sandboxProfile', 'brokerPolicy', 'entrypointPath', 'runtimeClosure'])
		|| !validArtifact(target.isolation.launcher,
			`${root}/${professionalIsolationLauncherName(manifest, target.id)}`)
		|| !validArtifact(target.isolation.sandboxProfile, `${root}/${manifest.isolation.profileName}`)
		|| !validArtifact(target.isolation.brokerPolicy, `${root}/${manifest.isolation.brokerPolicyName}`)
		|| !Array.isArray(target.isolation.runtimeClosure) || target.isolation.runtimeClosure.length > 128) return false;
	const runtimePrefix = `${root}/${manifest.isolation.runtimeDirectory}/`;
	const paths = target.isolation.runtimeClosure.map(({ path }) => path);
	return paths.length === new Set(paths).size
		&& target.isolation.runtimeClosure.every((entry) => validArtifact(entry)
			&& entry.path.startsWith(runtimePrefix) && !entry.path.slice(runtimePrefix.length).includes('/../'))
		&& (target.isolation.entrypointPath === target.pluginPeer.path
			|| paths.includes(target.isolation.entrypointPath));
}

function assertCandidateMatchesTarget(candidate, target) {
	const promoted = (descriptor) => ({
		path: target.payload.path.slice(0, target.payload.path.lastIndexOf('/') + 1)
			+ descriptor.path.slice('payload/'.length),
		byteLength: descriptor.byteLength,
		sha256: descriptor.sha256,
	});
	assert(candidate.target === target.id
		&& candidate.productionReadiness === null
		&& sameJson(promoted(candidate.payload), target.payload)
		&& sameJson(candidate.osAudioCodec === null ? null : promoted(candidate.osAudioCodec),
			target.osAudioCodec)
			&& sameJson(promoted(candidate.pluginPeer), target.pluginPeer)
			&& sameJson(promoted(candidate.deliveryFilesystem), target.deliveryFilesystem)
		&& sameJson(promoted(candidate.isolation.launcher), target.isolation.launcher)
		&& sameJson(promoted(candidate.isolation.sandboxProfile), target.isolation.sandboxProfile)
		&& sameJson(promoted(candidate.isolation.brokerPolicy), target.isolation.brokerPolicy)
		&& sameJson(candidate.isolation.runtimeClosure.map(promoted), target.isolation.runtimeClosure)
		&& candidateEvidenceFor(candidate, 'toolchain').identity === target.toolchainIdentity
		&& sameJson(candidateEvidenceFor(candidate, 'source-authentication').authentication,
			target.sourceAuthentication),
	'The professional native build-candidate receipt does not bind the promoted target row.');
}

function validArtifact(value, exactPath = null) {
	return !!value && exactKeys(value, ['path', 'byteLength', 'sha256'])
		&& typeof value.path === 'string' && value.path !== '' && !value.path.includes('\\')
		&& !value.path.split('/').includes('..') && (exactPath === null || value.path === exactPath)
		&& Number.isSafeInteger(value.byteLength) && value.byteLength > 0 && SHA256.test(String(value.sha256));
}

function exactKeys(value, fields) {
	return !!value && typeof value === 'object' && !Array.isArray(value)
		&& JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

async function readArtifact(root, descriptor, expectedPath, label) {
	assert(descriptor.path === expectedPath, `The ${label} path is invalid.`);
	const bytes = await regularFile(resolve(root, descriptor.path), label);
	verifyBytes(bytes, descriptor, label);
	return Object.freeze({ ...descriptor, bytes });
}

function relativeTargetPath(release, path) {
	const prefix = `native/soundscaper-professional-host/prebuilt/${release.target.id}/`;
	assert(path.startsWith(prefix), 'A professional native artifact escaped its target root.');
	return path.slice(prefix.length);
}

function executableArtifact(release, artifact) {
	return artifact.path === release.pluginPeer.path || artifact.path === release.osAudioCodec?.path
		|| artifact.path === release.deliveryFilesystem.path
		|| artifact.path === release.isolation.launcher.path
		|| artifact.path === release.isolation.entrypointPath;
}

async function collectStagedFiles(root) {
	const output = [];
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			assert(!entry.isSymbolicLink(), 'A staged professional payload cannot contain links.');
			if (entry.isDirectory()) await visit(path);
			else {
				assert(entry.isFile(), 'A staged professional payload contains a special entry.');
				output.push(relative(root, path).split('\\').join('/'));
			}
		}
	}
	await visit(root);
	return output.sort();
}

async function regularFile(path, label) {
	const metadata = await lstat(path);
	assert(metadata.isFile() && !metadata.isSymbolicLink(), `${label} is not a regular file.`);
	return readFile(path);
}
function assertRelease(release) {
	assert(VERIFIED.has(release), 'A verified professional native payload release is required.');
	assert(digest(release.manifestBytes) === release.manifestSha256,
		'The buffered professional native manifest changed after verification.');
	if (release.payload) verifyBytes(release.payload.bytes, release.payload, 'buffered professional native payload');
	for (const artifact of release.payload ? [release.buildCandidate,
		...(release.osAudioCodec === null ? [] : [release.osAudioCodec]),
		release.pluginPeer, release.deliveryFilesystem, release.isolation.launcher,
		release.isolation.sandboxProfile, release.isolation.brokerPolicy, ...release.isolation.runtimeClosure] : []) {
		verifyBytes(artifact.bytes, artifact, 'buffered professional native artifact');
	}
	if (release.reviewPolicy) verifyBytes(release.reviewPolicy.bytes, release.reviewPolicy,
		'buffered professional native-isolation review policy');
	if (release.productionReadiness) verifyBytes(
		release.productionReadiness.evidenceBytes,
		release.productionReadiness.reference.evidence,
		'buffered professional readiness evidence',
	);
}
function verifyBytes(bytes, descriptor, label) {
	assert(bytes.byteLength === descriptor.byteLength, `${label} byte length mismatch.`);
	assert(digest(bytes) === descriptor.sha256, `${label} digest mismatch.`);
}
function parse(bytes, label) {
	try { return JSON.parse(String(bytes)); }
	catch (error) { throw new Error(`${label} is invalid JSON: ${errorMessage(error)}`, { cause: error }); }
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function sameJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
function assert(condition, message) { if (!condition) throw new Error(message); }

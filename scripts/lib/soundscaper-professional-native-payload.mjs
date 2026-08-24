/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact build/stage/runtime authority for the professional Soundscaper addon. */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { renameIntoPlaceExclusively } from './exclusive-rename.mjs';
import {
	soundscaperProfessionalReadinessEvidenceName,
	soundscaperProfessionalReadinessReference,
	soundscaperProfessionalRuntimeClosureSha256,
	verifySoundscaperProfessionalReadiness,
} from '../../desktop/soundscaper-professional-native-readiness.mjs';
import {
	MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH,
	resolveNativeIsolationReviewPublicKey,
	validateNativeIsolationReviewPolicy,
} from '../../desktop/native-isolation-review-policy.mjs';

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
	const reviewPolicyBytes = await regularFile(
		resolve(root, MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH),
		'M5 native-isolation review policy',
	);
	const reviewPolicy = parse(reviewPolicyBytes, 'M5 native-isolation review policy');
	validateNativeIsolationReviewPolicy(reviewPolicy);
	validateManifest(manifest, sources);
	const selected = manifest.targets.find((entry) => entry.id === target);
	assert(selected, `The professional native payload manifest has no ${target} target.`);
	let payload = null;
	let pluginPeer = null;
	let isolation = null;
	let productionReadiness = null;
	if (selected.status === 'built') {
		const targetRoot = `native/soundscaper-professional-host/prebuilt/${target}`;
		const expectedPath = `${targetRoot}/${manifest.addon.payloadName}`;
		assert(selected.blockedBy === null && selected.payload?.path === expectedPath,
			`The professional native ${target} payload path is invalid.`);
		const bytes = await regularFile(resolve(root, expectedPath), `professional native payload ${target}`);
		verifyBytes(bytes, selected.payload, `professional native payload ${target}`);
		payload = Object.freeze({ ...selected.payload, name: manifest.addon.payloadName, bytes });
		pluginPeer = await readArtifact(root, selected.pluginPeer,
			`${targetRoot}/${manifest.pluginPeer.payloadName}`, 'professional plug-in peer');
		isolation = Object.freeze({
			launcher: await readArtifact(root, selected.isolation.launcher,
				`${targetRoot}/${manifest.isolation.launcherName}`, 'native-isolation launcher'),
			sandboxProfile: await readArtifact(root, selected.isolation.sandboxProfile,
				`${targetRoot}/${manifest.isolation.profileName}`, 'native-isolation profile'),
			brokerPolicy: await readArtifact(root, selected.isolation.brokerPolicy,
				`${targetRoot}/${manifest.isolation.brokerPolicyName}`, 'native-isolation broker policy'),
			entrypointPath: selected.isolation.entrypointPath,
			runtimeClosure: Object.freeze(await Promise.all(selected.isolation.runtimeClosure.map((entry) =>
				readArtifact(root, entry, entry.path, 'professional runtime closure')))),
		});
		if (selected.productionReadiness !== null) {
			const reference = soundscaperProfessionalReadinessReference(selected.productionReadiness, target);
			const evidence = await verifySoundscaperProfessionalReadiness(reference, {
				target, payload: selected.payload, sourceAuthentication: selected.sourceAuthentication,
				toolchainIdentity: selected.toolchainIdentity,
			}, {
				readEvidence: (path) => regularFile(resolve(root, path), 'professional readiness evidence'),
				resolveReviewPublicKey: (keyId) => resolveNativeIsolationReviewPublicKey(reviewPolicy, {
					usage: 'soundscaper-professional-native-production-readiness', target, keyId,
				}),
			});
			const evidenceBytes = await regularFile(resolve(root, reference.evidence.path),
				'professional readiness evidence');
			assertReadinessArtifacts(evidence, pluginPeer, isolation);
			productionReadiness = Object.freeze({ reference, evidence, evidenceBytes });
		}
	} else {
		assert(selected.status === 'pending-external' && selected.payload === null
			&& typeof selected.blockedBy === 'string' && selected.blockedBy.length > 0,
		`The professional native ${target} target has an invalid pending state.`);
	}
	const release = Object.freeze({
		repositoryRoot: root, manifest, manifestBytes,
		manifestSha256: digest(manifestBytes), target: selected, targetSource,
		payload, pluginPeer, isolation, productionReadiness,
		reviewPolicy: Object.freeze({
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
		reviewPolicy: Object.freeze({
			name: release.reviewPolicy.name, byteLength: release.reviewPolicy.byteLength,
			sha256: release.reviewPolicy.sha256,
		}),
		sourceAuthentication: release.target.sourceAuthentication === null ? null
			: deepFreeze(structuredClone(release.target.sourceAuthentication)),
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
		pluginPeer: summaryArtifact(release.pluginPeer),
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

export async function stageVerifiedSoundscaperProfessionalNativePayload({ release, outputRoot }) {
	assertRelease(release);
	const manifestBytes = Buffer.from(release.manifestBytes);
	const payload = release.payload === null ? null
		: { ...release.payload, bytes: Buffer.from(release.payload.bytes) };
	const nativeArtifacts = release.payload === null ? [] : [
		release.pluginPeer, release.isolation.launcher, release.isolation.sandboxProfile,
		release.isolation.brokerPolicy, ...release.isolation.runtimeClosure,
	];
	const readiness = release.productionReadiness === null ? null : {
		name: release.productionReadiness.reference.evidence.path.split('/').at(-1),
		bytes: Buffer.from(release.productionReadiness.evidenceBytes),
	};
	const reviewPolicy = { ...release.reviewPolicy, bytes: Buffer.from(release.reviewPolicy.bytes) };
	await renameIntoPlaceExclusively(resolve(outputRoot), 'professional native payload output', async (temporary) => {
		await writeFile(resolve(temporary, release.manifest.staging.manifestName), manifestBytes, { flag: 'wx' });
		await writeFile(resolve(temporary, reviewPolicy.name), reviewPolicy.bytes, { flag: 'wx' });
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
		release.reviewPolicy.name,
		...(release.payload ? [release.payload.name] : []),
		...(release.payload ? [
			relativeTargetPath(release, release.pluginPeer.path),
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
	const reviewPolicyBytes = await regularFile(resolve(outputRoot, release.reviewPolicy.name),
		'staged professional native-isolation review policy');
	verifyBytes(reviewPolicyBytes, release.reviewPolicy,
		'staged professional native-isolation review policy');
	if (release.payload) {
		const bytes = await regularFile(resolve(outputRoot, release.payload.name), 'staged professional native payload');
		verifyBytes(bytes, release.payload, 'staged professional native payload');
		for (const artifact of [release.pluginPeer, release.isolation.launcher,
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
	const target = runtimeTarget(location.platform ?? process.platform, location.arch ?? process.arch);
	if (!target) return unavailable('unsupported-platform', 'This platform is not a professional native target.');
	let manifest;
	let reviewPolicy;
	try {
		const [manifestBytes, sourceBytes, reviewPolicyBytes] = await Promise.all([
			readFileImpl(join(location.applicationRoot, PROFESSIONAL_NATIVE_MANIFEST_PATH)),
			readFileImpl(join(location.applicationRoot, NATIVE_SOURCE_MANIFEST_PATH)),
			readFileImpl(runtimeReviewPolicyPath(location, target)),
		]);
		manifest = JSON.parse(String(manifestBytes));
		reviewPolicy = JSON.parse(String(reviewPolicyBytes));
		validateNativeIsolationReviewPolicy(reviewPolicy);
		validateManifest(manifest, JSON.parse(String(sourceBytes)));
	} catch (error) {
		return unavailable('manifest-unreadable', errorMessage(error));
	}
	const selected = manifest.targets.find((entry) => entry.id === target);
	if (!selected || selected.status !== 'built' || selected.payload === null) {
		return unavailable('payload-pending-external', selected?.blockedBy ?? 'No payload is built for this target.');
	}
	const path = location.packaged
		? join(location.resourcesPath, 'runtime', manifest.staging.runtimePrefix, target, manifest.addon.payloadName)
		: join(location.applicationRoot, selected.payload.path);
	let bytes;
	try { bytes = await readFileImpl(path); }
	catch (error) { return unavailable('payload-missing', errorMessage(error)); }
	if (bytes.byteLength !== selected.payload.byteLength || digest(bytes) !== selected.payload.sha256) {
		return unavailable('payload-digest-mismatch', `The professional native payload at ${path} failed authentication.`);
	}
	let productionReadiness = null;
	if (selected.productionReadiness !== null) {
		try {
			productionReadiness = await verifySoundscaperProfessionalReadiness(selected.productionReadiness, {
				target, payload: selected.payload, sourceAuthentication: selected.sourceAuthentication,
				toolchainIdentity: selected.toolchainIdentity,
			}, {
				readEvidence: () => readFileImpl(runtimeReadinessPath(location, manifest, target)),
				resolveReviewPublicKey: (keyId) => resolveNativeIsolationReviewPublicKey(reviewPolicy, {
					usage: 'soundscaper-professional-native-production-readiness', target, keyId,
				}),
			});
		} catch (error) { return unavailable('production-readiness-invalid', errorMessage(error)); }
	}
	return Object.freeze({ status: 'available', descriptor: Object.freeze({
		target, path, byteLength: bytes.byteLength, sha256: selected.payload.sha256,
		addonVersion: manifest.addon.version, napiVersion: manifest.addon.napiVersion,
		toolchainIdentity: selected.toolchainIdentity, sourceAudit: selected.sourceAuthentication,
		productionReadiness,
	}) });
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
			assert(typeof target.toolchainIdentity === 'string' && target.toolchainIdentity.length > 0
				&& target.payload && Number.isSafeInteger(target.payload.byteLength) && target.payload.byteLength > 0
				&& SHA256.test(String(target.payload.sha256))
				&& validIsolation(target, value)
				&& validSourceAuthentication(target.sourceAuthentication, target.id, sourceRegister)
				&& (target.productionReadiness === null || validReadinessReference(target.productionReadiness, target.id)),
			`The professional native ${target.id} built record is invalid.`);
		} else {
			assert(target.sourceAuthentication === null && target.productionReadiness === null
				&& target.pluginPeer === null && target.isolation === null,
				`The pending professional native ${target.id} target cannot claim source authentication.`);
		}
	}
	return value;
}

function validReadinessReference(value, target) {
	try { soundscaperProfessionalReadinessReference(value, target); return true; }
	catch { return false; }
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
	if (!validArtifact(target.pluginPeer, `${root}/${manifest.pluginPeer.payloadName}`)
		|| !target.isolation || !exactKeys(target.isolation,
			['launcher', 'sandboxProfile', 'brokerPolicy', 'entrypointPath', 'runtimeClosure'])
		|| !validArtifact(target.isolation.launcher, `${root}/${manifest.isolation.launcherName}`)
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

function assertReadinessArtifacts(verified, peer, isolation) {
	const launcher = verified.evidence.launcher;
	assert(launcher.peerPayloadSha256 === peer.sha256
		&& launcher.launcherPayloadSha256 === isolation.launcher.sha256
		&& launcher.sandboxProfileSha256 === isolation.sandboxProfile.sha256
		&& launcher.brokerPolicySha256 === isolation.brokerPolicy.sha256
		&& launcher.runtimeClosureSha256
			=== soundscaperProfessionalRuntimeClosureSha256(isolation.runtimeClosure),
	'The signed professional readiness does not bind the exact staged peer/isolation closure.');
}

function summaryArtifact(value) {
	return value === null ? null : Object.freeze({
		path: value.path, byteLength: value.byteLength, sha256: value.sha256,
	});
}

function relativeTargetPath(release, path) {
	const prefix = `native/soundscaper-professional-host/prebuilt/${release.target.id}/`;
	assert(path.startsWith(prefix), 'A professional native artifact escaped its target root.');
	return path.slice(prefix.length);
}

function executableArtifact(release, artifact) {
	return artifact.path === release.pluginPeer.path || artifact.path === release.isolation.launcher.path
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
	for (const artifact of release.payload ? [release.pluginPeer, release.isolation.launcher,
		release.isolation.sandboxProfile, release.isolation.brokerPolicy, ...release.isolation.runtimeClosure] : []) {
		verifyBytes(artifact.bytes, artifact, 'buffered professional native artifact');
	}
	verifyBytes(release.reviewPolicy.bytes, release.reviewPolicy,
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
function runtimeTarget(platform, arch) {
	const id = platform === 'darwin' ? `mac-${arch}` : platform === 'win32' ? `win-${arch}` : `${platform}-${arch}`;
	return PROFESSIONAL_NATIVE_TARGETS.includes(id) ? id : null;
}
function runtimeReadinessPath(location, manifest, target) {
	const name = 'soundscaper-professional-native-readiness.json';
	return location.packaged
		? join(location.resourcesPath, 'runtime', manifest.staging.runtimePrefix, target, name)
		: join(location.applicationRoot, soundscaperProfessionalReadinessEvidenceName(target));
}
function runtimeReviewPolicyPath(location, target) {
	return location.packaged
		? join(location.resourcesPath, 'runtime', PROFESSIONAL_NATIVE_RUNTIME_PREFIX, target,
			PROFESSIONAL_NATIVE_REVIEW_POLICY_NAME)
		: join(location.applicationRoot, MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH);
}
function unavailable(reason, detail) { return Object.freeze({ status: 'unavailable', reason, detail }); }
function parse(bytes, label) {
	try { return JSON.parse(String(bytes)); }
	catch (error) { throw new Error(`${label} is invalid JSON: ${errorMessage(error)}`, { cause: error }); }
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
function assert(condition, message) { if (!condition) throw new Error(message); }

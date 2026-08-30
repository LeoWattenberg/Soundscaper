/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	PROFESSIONAL_NATIVE_MANIFEST_PATH,
	PROFESSIONAL_NATIVE_TARGETS,
	auditSoundscaperProfessionalNativeStablePayloads,
	assertSoundscaperProfessionalNativeStablePackageRelease,
	professionalNativePayloadOutputRoot,
	stageVerifiedSoundscaperProfessionalNativePayload,
	verifySoundscaperProfessionalNativePayload,
	verifyStagedSoundscaperProfessionalNativePayload,
} from '../scripts/lib/soundscaper-professional-native-payload.mjs';
import {
	bindEvidenceReceipt,
	canonicalJson,
	expectedSoundscaperProfessionalNativeInventory,
	requiredSoundscaperProfessionalNativeSelfTestIds,
} from '../scripts/lib/soundscaper-professional-native-candidate-contract.mjs';
import {
	createSoundscaperProfessionalNativeToolchainReceipt,
	soundscaperProfessionalNativeToolchainIdentity,
} from '../scripts/lib/soundscaper-professional-native-toolchain.mjs';
import { describeSoundscaperProfessionalNativePayload } from '../desktop/soundscaper-professional-native-payload.mjs';

const ROOT = resolve(import.meta.dirname, '..');

test('professional payload authority is closed for every unbuilt target', async () => {
	for (const target of PROFESSIONAL_NATIVE_TARGETS) {
		const release = await verifySoundscaperProfessionalNativePayload({ repositoryRoot: ROOT, target });
		assert.equal(release.target.status, 'pending-external');
		assert.equal(release.payload, null);
		assert.match(release.target.blockedBy, /authenticated.*payload.*built/iu);
		assert.doesNotMatch(release.target.blockedBy,
			/licens|review|readiness|signing|notari|qualification|manual|patent|notice/iu);
	}
});

test('stable payload audit reports every valid pending target as typed blocked evidence', async () => {
	const audit = await auditSoundscaperProfessionalNativeStablePayloads({ repositoryRoot: ROOT });
	assert.equal(audit.schemaVersion, 1);
	assert.equal(audit.status, 'blocked');
	assert.deepEqual(audit.targets.map(({ id, status }) => ({ id, status })),
		PROFESSIONAL_NATIVE_TARGETS.map((id) => ({ id, status: 'blocked' })));
	assert.equal(audit.blockers.length, PROFESSIONAL_NATIVE_TARGETS.length);
	for (const [index, target] of audit.targets.entries()) {
		assert.deepEqual(Object.keys(target).sort(), ['blockers', 'id', 'status']);
		assert.equal(target.blockers.length, 1);
		assert.deepEqual(audit.blockers[index], { target: target.id, detail: target.blockers[0] });
		assert.match(target.blockers[0], /authenticated.*payload.*built/iu);
	}
});

test('a verified professional Node bridge stages exactly its manifest and payload', async (context) => {
	const fixture = await builtFixture(context);
	const release = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: fixture.root, target: 'linux-x64',
	});
	const runtimeRoot = join(fixture.root, 'runtime');
	const outputRoot = professionalNativePayloadOutputRoot(runtimeRoot, release);
	const summary = await stageVerifiedSoundscaperProfessionalNativePayload({ release, outputRoot });
	assert.deepEqual((await readdir(outputRoot)).sort(), [
		'milestone-5-native-isolation-review-policy.json',
		'milestone5-native-isolation-launcher',
		'native-isolation-broker-v1.json',
		'native-isolation-profile-v1.json',
		'soundscaper-professional-native-candidate.json',
		'soundscaper-professional-native-payload-manifest.json',
		'soundscaper_delivery_fs',
		'soundscaper_professional.node',
		'soundscaper_professional_peer',
	]);
	assert.equal(summary.payload.sha256, fixture.sha256);
	assert.deepEqual(Object.keys(summary.payloadManifest).sort(), ['byteLength', 'id', 'sha256']);
	assert.deepEqual(Object.keys(summary.reviewPolicy).sort(), ['byteLength', 'name', 'sha256']);
	assert.equal(summary.payloadManifest.byteLength,
		(await readFile(join(fixture.root, PROFESSIONAL_NATIVE_MANIFEST_PATH))).byteLength);
	assert.deepEqual(summary.sourceAuthentication, release.target.sourceAuthentication);
	assert.equal((await verifyStagedSoundscaperProfessionalNativePayload({ release, outputRoot })).status, 'built');
	await writeFile(join(outputRoot, 'soundscaper_professional.node'), 'tampered');
	await assert.rejects(
		() => verifyStagedSoundscaperProfessionalNativePayload({ release, outputRoot }),
		/professional native payload.*(?:byte length|digest)/iu,
	);
});

test('stable packaging rejects preview/pending readiness and admits an authenticated ready release', async (context) => {
	const preview = await builtFixture(context);
	const previewRelease = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: preview.root, target: 'linux-x64',
	});
	assert.throws(() => assertSoundscaperProfessionalNativeStablePackageRelease(previewRelease),
		/non-pending production readiness/iu);
	const stable = await builtFixture(context, { productionReadiness: true });
	const stableRelease = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: stable.root, target: 'linux-x64',
	});
	assert.deepEqual(assertSoundscaperProfessionalNativeStablePackageRelease(stableRelease), {
		id: 'linux-x64', status: 'ready',
		sourceRevision: '1'.repeat(40),
		payloadSha256: stableRelease.payload.sha256,
		buildCandidateSha256: stableRelease.buildCandidate.sha256,
		productionReadinessSha256: stableRelease.productionReadiness.reference.evidence.sha256,
	});
	const resourcesPath = join(stable.root, 'stable-resources');
	await stageVerifiedSoundscaperProfessionalNativePayload({
		release: stableRelease,
		outputRoot: professionalNativePayloadOutputRoot(join(resourcesPath, 'runtime'), stableRelease),
	});
	const packaged = await describeSoundscaperProfessionalNativePayload({
		applicationRoot: stable.root, packaged: true, resourcesPath,
		platform: 'linux', arch: 'x64',
	});
	assert.equal(packaged.status, 'available');
	assert.equal(packaged.descriptor.m9ReleaseReview.status, 'complete');
	assert.equal(packaged.descriptor.m9ReleaseReview.evidence.evidence.buildProvenance.sourceRevision,
		'1'.repeat(40));
});

test('runtime resolution selects only the authenticated professional payload', async (context) => {
	const fixture = await builtFixture(context);
	const release = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: fixture.root, target: 'linux-x64',
	});
	const resourcesPath = join(fixture.root, 'resources');
	await stageVerifiedSoundscaperProfessionalNativePayload({
		release,
		outputRoot: professionalNativePayloadOutputRoot(join(resourcesPath, 'runtime'), release),
	});
	const available = await describeSoundscaperProfessionalNativePayload({
		applicationRoot: fixture.root, packaged: true, resourcesPath,
		platform: 'linux', arch: 'x64',
	});
	assert.equal(available.status, 'available');
	assert.equal(available.descriptor.sha256, fixture.sha256);
	assert.match(available.descriptor.pluginPeer.path, /soundscaper_professional_peer$/u);
	assert.match(available.descriptor.deliveryFilesystem.path, /soundscaper_delivery_fs$/u);
	assert.match(available.descriptor.isolation.launcher.path, /milestone5-native-isolation-launcher$/u);
	assert.equal(available.descriptor.isolation.entrypoint.path, available.descriptor.pluginPeer.path);
	assert.equal(available.descriptor.sourceAudit.status, 'authenticated');
	assert.deepEqual(available.descriptor.m9ReleaseReview, {
		scope: 'stable-1.0-release', status: 'pending',
		detail: 'No independent professional-native review is recorded for stable 1.0 release admission.',
	});
	const pending = await describeSoundscaperProfessionalNativePayload({
		applicationRoot: ROOT, packaged: false, resourcesPath: '',
		platform: 'darwin', arch: 'arm64',
	});
	assert.deepEqual([pending.status, pending.reason], ['unavailable', 'payload-pending-external']);
});

test('a built payload cannot substitute well-shaped source digests for the pinned closure', async (context) => {
	const fixture = await builtFixture(context);
	const manifestPath = join(fixture.root, PROFESSIONAL_NATIVE_MANIFEST_PATH);
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	manifest.targets.find(({ id }) => id === 'linux-x64')
		.sourceAuthentication.sources[0].archiveEvidence.sha256 = '0'.repeat(64);
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	await assert.rejects(() => verifySoundscaperProfessionalNativePayload({
		repositoryRoot: fixture.root, target: 'linux-x64',
	}), /built record is invalid/iu);
});

test('signed review is M9 metadata and cannot disable the machine-authenticated payload', async (context) => {
	const fixture = await builtFixture(context, { productionReadiness: true });
	const release = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: fixture.root, target: 'linux-x64',
	});
	assert.equal(release.m9ReleaseReview.status, 'complete');
	assert.equal(release.m9ReleaseReview.evidence.evidence.evidence.launcher.network, 'denied');
	const evidencePath = join(fixture.root,
		'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper-professional-native-readiness.json');
	await writeFile(evidencePath, `${await readFile(evidencePath)} `);
	const changed = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: fixture.root, target: 'linux-x64',
	});
	assert.equal(changed.payload.sha256, fixture.sha256);
	assert.equal(changed.m9ReleaseReview.status, 'invalid');
});

async function builtFixture(context, options = {}) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-professional-payload-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const manifest = JSON.parse(await readFile(join(ROOT, PROFESSIONAL_NATIVE_MANIFEST_PATH), 'utf8'));
	const bytes = Buffer.from('fixture professional Node-API bridge');
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const target = manifest.targets.find(({ id }) => id === 'linux-x64');
	target.status = 'built';
	target.blockedBy = null;
	target.toolchainIdentity = soundscaperProfessionalNativeToolchainIdentity(
		fixtureToolchainReceipt(target.id),
	);
	target.sourceAuthentication = sourceAuthentication(target.id);
	target.payload = {
		path: 'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper_professional.node',
		byteLength: bytes.byteLength,
		sha256,
	};
	const targetRoot = 'native/soundscaper-professional-host/prebuilt/linux-x64';
	const artifacts = {
		pluginPeer: [`${targetRoot}/soundscaper_professional_peer`, Buffer.from('fixture isolated peer')],
		deliveryFilesystem: [`${targetRoot}/soundscaper_delivery_fs`, Buffer.from('fixture delivery filesystem')],
		launcher: [`${targetRoot}/milestone5-native-isolation-launcher`, Buffer.from('fixture isolation launcher')],
		sandboxProfile: [`${targetRoot}/native-isolation-profile-v1.json`, Buffer.from('{"profile":1}')],
		brokerPolicy: [`${targetRoot}/native-isolation-broker-v1.json`, Buffer.from('{"broker":1}')],
	};
	for (const [key, [path, artifactBytes]] of Object.entries(artifacts)) {
		const descriptor = { path, byteLength: artifactBytes.byteLength, sha256: hash(artifactBytes) };
		if (key === 'pluginPeer' || key === 'deliveryFilesystem') target[key] = descriptor;
		else {
			target.isolation ??= { launcher: null, sandboxProfile: null, brokerPolicy: null,
				entrypointPath: artifacts.pluginPeer[0], runtimeClosure: [] };
			target.isolation[key] = descriptor;
		}
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), artifactBytes);
	}
	const payloadPath = join(root, target.payload.path);
	await mkdir(dirname(payloadPath), { recursive: true });
	await writeFile(payloadPath, bytes);
	const candidateBytes = candidateReceipt(target);
	const candidatePath = `${targetRoot}/soundscaper-professional-native-candidate.json`;
	target.buildCandidate = {
		path: candidatePath, byteLength: candidateBytes.byteLength, sha256: hash(candidateBytes),
	};
	await writeFile(join(root, candidatePath), candidateBytes);
	let policy = JSON.parse(await readFile(join(ROOT,
		'config/milestone-5-native-isolation-review-policy.json'), 'utf8'));
	if (options.productionReadiness === true) {
		const { privateKey, publicKey } = generateKeyPairSync('ed25519');
		policy = { ...policy, trustedKeys: [{
			id: 'fixture-review', status: 'accepted',
			usages: ['soundscaper-professional-native-production-readiness'],
			targets: ['linux-x64'],
			publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
		}] };
		const evidence = readinessEvidence(target);
		const evidenceBytes = Buffer.from(JSON.stringify(evidence));
		const evidencePath = join(root,
			'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper-professional-native-readiness.json');
		await writeFile(evidencePath, evidenceBytes);
		target.productionReadiness = {
			schemaVersion: 1, status: 'reviewed', target: target.id,
			evidence: {
				path: 'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper-professional-native-readiness.json',
				byteLength: evidenceBytes.byteLength, sha256: hash(evidenceBytes),
			},
			signature: {
				algorithm: 'ed25519', reviewKeyId: 'fixture-review',
				valueBase64: sign(null, evidenceBytes, privateKey).toString('base64'),
			},
		};
	}
	const manifestPath = join(root, PROFESSIONAL_NATIVE_MANIFEST_PATH);
	await mkdir(dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	await writeFile(join(root, 'config/milestone-5-native-source-acquisitions.json'),
		await readFile(join(ROOT, 'config/milestone-5-native-source-acquisitions.json')));
	await writeFile(join(root, 'config/milestone-5-native-isolation-review-policy.json'),
		`${JSON.stringify(policy, null, '\t')}\n`);
	return { root, sha256 };
}

function candidateReceipt(target) {
	const local = (descriptor, path) => ({
		path, byteLength: descriptor.byteLength, sha256: descriptor.sha256,
	});
	const payload = local(target.payload, 'payload/soundscaper_professional.node');
	const pluginPeer = local(target.pluginPeer, 'payload/soundscaper_professional_peer');
	const deliveryFilesystem = local(target.deliveryFilesystem, 'payload/soundscaper_delivery_fs');
	const launcher = local(target.isolation.launcher, 'payload/milestone5-native-isolation-launcher');
	const sandboxProfile = local(target.isolation.sandboxProfile, 'payload/native-isolation-profile-v1.json');
	const brokerPolicy = local(target.isolation.brokerPolicy, 'payload/native-isolation-broker-v1.json');
	const files = [payload, pluginPeer, deliveryFilesystem, launcher, sandboxProfile, brokerPolicy];
	const tests = requiredSoundscaperProfessionalNativeSelfTestIds(target.id).map((id) => ({
		id, status: 'passed', commandSha256: hash(Buffer.from(`command:${id}`)),
		outputSha256: hash(Buffer.from(`output:${id}`)),
	}));
	const sourceRevision = '1'.repeat(40);
	const buildPlanSha256 = '2'.repeat(64);
	const toolchainReceipt = fixtureToolchainReceipt(target.id);
	const packagedAppAuthority = {
		schemaVersion: 1,
		kind: 'soundscaper-professional-packaged-electron-authority',
		target: target.id,
		sourceRevision,
		contentManifest: {
			path: 'package/resources/milestone-5-package-content.json',
			byteLength: 1, sha256: '5'.repeat(64), closureSha256: '6'.repeat(64),
		},
		executable: { path: 'package/Soundscaper', byteLength: 1, sha256: '7'.repeat(64) },
		rootFileCount: 2, rootTotalBytes: 2, rootClosureSha256: '8'.repeat(64),
	};
	return canonicalJson({
		schemaVersion: 1, kind: 'soundscaper-professional-native-candidate',
		target: target.id, sourceRevision, buildPlanSha256,
		evidenceReceipts: [
			bindEvidenceReceipt('build', target.id, {
				status: 'passed', sourceRevision, buildPlanSha256, packagedAppAuthority,
				macSigning: null, tests: [],
			}),
			bindEvidenceReceipt('self-test', target.id, {
				status: 'passed', inventory: expectedSoundscaperProfessionalNativeInventory(target.id), tests,
			}),
			bindEvidenceReceipt('toolchain', target.id, {
				identity: target.toolchainIdentity, receipt: toolchainReceipt,
			}),
			bindEvidenceReceipt('source-authentication', target.id, {
				authentication: target.sourceAuthentication,
			}),
			bindEvidenceReceipt('installed-files', target.id, { files }),
			bindEvidenceReceipt('dependency-closure', target.id, {
				status: 'closed', maximumRuntimeFiles: 128,
				inspections: [
					{ architecture: architectureReceipt(target.id), artifactPath: deliveryFilesystem.path,
						imports: [], rpaths: [] },
					{ architecture: architectureReceipt(target.id), artifactPath: launcher.path,
						imports: [], rpaths: [] },
					{ architecture: architectureReceipt(target.id), artifactPath: payload.path,
						imports: [], rpaths: [] },
					{ architecture: architectureReceipt(target.id), artifactPath: pluginPeer.path,
						imports: [], rpaths: ['$ORIGIN/runtime'] },
				].sort((left, right) => left.artifactPath < right.artifactPath ? -1 : 1),
				checks: [
					'ambient-dependency-refusal', 'recursive-inspection', 'rpath-refusal',
					'runtime-file-limit-refusal', 'symlink-refusal', 'undeclared-dependency-refusal',
				],
			}),
		],
		payload, osAudioCodec: null, pluginPeer, deliveryFilesystem,
		isolation: { launcher, sandboxProfile, brokerPolicy, entrypointPath: pluginPeer.path,
			runtimeClosure: [] },
		productionReadiness: null,
	});
}

function fixtureToolchainReceipt(target) {
	const identity = {
		cmakeVersion: '4.2.1', generator: 'Ninja', generatorPlatform: '',
		systemName: 'Linux', systemProcessor: 'x86_64', osxArchitectures: '',
		cCompiler: { id: 'Clang', version: '19.1.0' },
		cxxCompiler: { id: 'Clang', version: '19.1.0' },
	};
	return createSoundscaperProfessionalNativeToolchainReceipt({
		target, professional: identity, isolation: structuredClone(identity), osAudioCodec: null,
	});
}

function architectureReceipt(target) {
	return {
		schemaVersion: 1, target, format: 'elf64-le', architecture: 'x64', machine: 'EM_X86_64',
	};
}

function readinessEvidence(target) {
	return {
		schemaVersion: 2, kind: 'soundscaper-professional-native-production-readiness',
		target: target.id,
		payload: { byteLength: target.payload.byteLength, sha256: target.payload.sha256 },
		buildCandidate: artifactEvidence(target.buildCandidate),
		deliveryFilesystem: artifactEvidence(target.deliveryFilesystem),
		osAudioCodec: target.osAudioCodec === null ? null : artifactEvidence(target.osAudioCodec),
		sourceAuthenticationSha256: hash(Buffer.from(stableJson(target.sourceAuthentication))),
		toolchainIdentity: target.toolchainIdentity,
		buildProvenance: {
			sourceRevision: '1'.repeat(40), buildPlanSha256: '2'.repeat(64),
			nativeHostTreeSha256: '3'.repeat(64), helperAddonTreeSha256: '4'.repeat(64),
		},
		macSigning: null,
		launcher: {
			schemaVersion: 1, target: target.id,
			launcherId: 'soundscaper-linux-landlock-seccomp-namespaces-v1',
			launcherPayloadSha256: target.isolation.launcher.sha256,
			sandboxProfileSha256: target.isolation.sandboxProfile.sha256,
			brokerPolicySha256: target.isolation.brokerPolicy.sha256,
			peerPayloadSha256: target.pluginPeer.sha256,
			runtimeClosureSha256: hash(Buffer.from('[]')), filesystem: 'broker-grant-only',
			network: 'denied', childProcesses: 'denied', dynamicCode: 'admitted-plugin-only',
		},
		osIsolationAttested: true, hostilePluginDenialAttested: true,
		realThirdPartyExecutionAttested: true, reviewedAt: '2026-08-24', reviewer: 'Fixture Reviewer',
	};
}

function artifactEvidence(value) {
	return { byteLength: value.byteLength, sha256: value.sha256 };
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.keys(value).sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
	return JSON.stringify(value);
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function sourceAuthentication(target) {
	const sourceRegister = JSON.parse(readFileSync(join(ROOT,
		'config/milestone-5-native-source-acquisitions.json'), 'utf8'));
	const ids = ['electron-node-api-headers', 'juce', 'clap', 'vst3-sdk',
		...(target.startsWith('win-') ? ['asio-sdk'] : []),
		...(target.startsWith('linux-') ? ['lv2'] : [])];
	return {
		schemaVersion: 1, status: 'authenticated', sources: ids.map((id) => {
			const source = sourceRegister.sources.find((entry) => entry.id === id);
			return {
				id, authenticationStatus: 'authenticated',
				archiveEvidence: { byteLength: source.archive.byteLength, sha256: source.archive.sha256 },
				extractedTreeEvidence: { ...source.extractedTree },
			};
		}),
	};
}

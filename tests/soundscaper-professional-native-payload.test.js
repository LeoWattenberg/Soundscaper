/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	PROFESSIONAL_NATIVE_MANIFEST_PATH,
	PROFESSIONAL_NATIVE_TARGETS,
	assertSoundscaperProfessionalNativePackageInputs,
	professionalNativePayloadOutputRoot,
	stageVerifiedSoundscaperProfessionalNativePayload,
	verifySoundscaperProfessionalNativePayload,
	verifyStagedSoundscaperProfessionalNativePayload,
} from '../scripts/lib/soundscaper-professional-native-payload.mjs';
import {
	bindVerificationCheck,
	canonicalJson,
	expectedSoundscaperProfessionalNativeInventory,
	requiredSoundscaperProfessionalNativeSelfTestIds,
} from '../scripts/lib/soundscaper-professional-native-build-result-contract.mjs';
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

test('package-input verification rejects a target without a matching build result', async () => {
	const release = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: ROOT, target: 'linux-x64',
	});
	assert.throws(
		() => assertSoundscaperProfessionalNativePackageInputs(release),
		/professional build result/iu,
	);
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
		'milestone5-native-isolation-launcher',
		'native-isolation-broker-v1.json',
		'native-isolation-profile-v1.json',
		'soundscaper-professional-native-build-result.json',
		'soundscaper-professional-native-payload-manifest.json',
		'soundscaper_delivery_fs',
		'soundscaper_professional.node',
		'soundscaper_professional_peer',
	]);
	assert.equal(summary.payload.sha256, fixture.sha256);
	assert.deepEqual(Object.keys(summary.payloadManifest).sort(), ['byteLength', 'id', 'sha256']);
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

test('stable packaging consumes neutral inputs from an exact matching build result', async (context) => {
	const stable = await builtFixture(context);
	const stableRelease = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: stable.root, target: 'linux-x64',
	});
	const inputs = assertSoundscaperProfessionalNativePackageInputs(stableRelease);
	assert.deepEqual(inputs, {
		target: 'linux-x64',
		sourceRevision: '1'.repeat(40),
		payloadSha256: stableRelease.payload.sha256,
		buildResultSha256: stableRelease.buildResult.sha256,
	});
	assert.doesNotMatch(JSON.stringify(inputs), /ready|blocked|qualification|admission/iu);
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
	assert.equal(packaged.descriptor.buildAuthority.sourceRevision, '1'.repeat(40));
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
	assert.equal(Object.hasOwn(available.descriptor, 'm9ReleaseReview'), false);
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

async function builtFixture(context) {
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
	const buildResultBytes = buildResultReceipt(target);
	const buildResultPath = `${targetRoot}/soundscaper-professional-native-build-result.json`;
	target.buildResult = {
		path: buildResultPath, byteLength: buildResultBytes.byteLength, sha256: hash(buildResultBytes),
	};
	await writeFile(join(root, buildResultPath), buildResultBytes);
	const manifestPath = join(root, PROFESSIONAL_NATIVE_MANIFEST_PATH);
	await mkdir(dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	await writeFile(join(root, 'config/milestone-5-native-source-acquisitions.json'),
		await readFile(join(ROOT, 'config/milestone-5-native-source-acquisitions.json')));
	return { root, sha256 };
}

function buildResultReceipt(target) {
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
		schemaVersion: 1, kind: 'soundscaper-professional-native-build-result',
		target: target.id, sourceRevision, buildPlanSha256,
		verificationChecks: [
			bindVerificationCheck('build', target.id, {
				status: 'passed', sourceRevision, buildPlanSha256, packagedAppAuthority,
				macCodeSeal: null, tests: [],
			}),
			bindVerificationCheck('self-test', target.id, {
				status: 'passed', inventory: expectedSoundscaperProfessionalNativeInventory(target.id), tests,
			}),
			bindVerificationCheck('toolchain', target.id, {
				identity: target.toolchainIdentity, receipt: toolchainReceipt,
			}),
			bindVerificationCheck('source-authentication', target.id, {
				authentication: target.sourceAuthentication,
			}),
			bindVerificationCheck('installed-files', target.id, { files }),
			bindVerificationCheck('dependency-closure', target.id, {
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

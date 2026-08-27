/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
	cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { access, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { verifyPackagedFramescaperNativeHostResources } from '../scripts/desktop-after-pack.mjs';
import { verifyStagedFramescaperNativeHostsBeforePack } from '../scripts/desktop-before-pack.mjs';
import { deriveFramescaperMediaHostPayloadManifest } from '../scripts/lib/framescaper-media-host-build.mjs';
import { deriveFramescaperOpenFxPayloadManifest } from '../scripts/lib/framescaper-openfx-host-build.mjs';
import {
	framescaperNativeHostPayloadStageSummary,
	stageVerifiedFramescaperNativeHostPayloads,
	verifyFramescaperNativeHostPayloads,
	verifyStagedFramescaperNativeHostPayloads,
} from '../scripts/lib/framescaper-native-host-payload-staging.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const TARGET = 'linux-x64';
const MEDIA_ROOT = 'native/framescaper-media-host';
const OPENFX_ROOT = 'native/framescaper-openfx-host';
const MEDIA_PATH = `${MEDIA_ROOT}/prebuilt/${TARGET}/framescaper-media-host`;
const MEDIA_LAUNCHER_PATH = `${MEDIA_ROOT}/prebuilt/${TARGET}/isolation/milestone5-native-isolation-launcher`;
const MEDIA_PROFILE_PATH = `${MEDIA_ROOT}/prebuilt/${TARGET}/isolation/milestone5-native-isolation-profile.json`;
const MEDIA_BROKER_PATH = `${MEDIA_ROOT}/prebuilt/${TARGET}/isolation/milestone5-native-isolation-broker.json`;
const MEDIA_LIBRARY_PATH = `${MEDIA_ROOT}/prebuilt/${TARGET}/lib/libframescaper-media.so`;
const SCANNER_PATH = `${OPENFX_ROOT}/prebuilt/${TARGET}/bin/framescaper-ofx-scanner`;
const RUNTIME_PATH = `${OPENFX_ROOT}/prebuilt/${TARGET}/bin/framescaper-ofx-runtime-host`;
const LAUNCHER_PATH = `${OPENFX_ROOT}/prebuilt/${TARGET}/isolation/milestone5-native-isolation-launcher`;
const PROFILE_PATH = `${OPENFX_ROOT}/prebuilt/${TARGET}/isolation/milestone5-native-isolation-profile.json`;
const BROKER_PATH = `${OPENFX_ROOT}/prebuilt/${TARGET}/isolation/milestone5-native-isolation-broker.json`;
const LIBRARY_PATH = `${OPENFX_ROOT}/prebuilt/${TARGET}/lib/ld-linux-x86-64.so.2`;
const MEDIA_BYTES = Buffer.from('verified-framescaper-media-host');
const MEDIA_LIBRARY_BYTES = Buffer.from('verified-framescaper-media-runtime-library');
const SCANNER_BYTES = Buffer.from('verified-framescaper-ofx-scanner');
const RUNTIME_BYTES = Buffer.from('verified-framescaper-ofx-runtime-host');
const LAUNCHER_BYTES = Buffer.from('verified-native-isolation-launcher');
const PROFILE_BYTES = Buffer.from('verified-native-isolation-profile');
const BROKER_BYTES = Buffer.from('verified-native-isolation-broker');
const LIBRARY_BYTES = Buffer.from('verified-openfx-runtime-library');

test('pending-external current targets stage no host bytes or target directories', async (context) => {
	const outputRoot = temporaryRoot(context, 'framescaper-pending-host-stage-');
	const repositoryRoot = pendingFixture(context);
	const release = await verifyFramescaperNativeHostPayloads({
		repositoryRoot,
		target: TARGET,
		targetSource: 'build-host',
	});
	assert.equal(release.mediaHost.target.status, 'pending-external');
	assert.equal(release.openFxHost.target.status, 'pending-external');
	const summary = await stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot });
	assert.deepEqual(summary, framescaperNativeHostPayloadStageSummary(release));
	await assertMissing(join(outputRoot, 'native/framescaper-media-host', TARGET));
	await assertMissing(join(outputRoot, 'native/framescaper-openfx-host', TARGET));
	await assert.doesNotReject(() => verifyStagedFramescaperNativeHostPayloads({ release, outputRoot }));
});

test('a built target stages only its exact verified media and two OpenFX executables', async (context) => {
	const repositoryRoot = builtFixture(context);
	writeFileSync(join(repositoryRoot, MEDIA_ROOT, 'prebuilt', TARGET, 'unlisted-helper'), 'never package me');
	writeFileSync(join(repositoryRoot, OPENFX_ROOT, 'prebuilt', TARGET, 'bin', 'unlisted-helper'), 'never package me');
	const outputRoot = temporaryRoot(context, 'framescaper-built-host-stage-');
	const release = await verifyFramescaperNativeHostPayloads({
		repositoryRoot, target: TARGET, targetSource: 'declared',
	});
	const summary = await stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot });
	assert.equal(summary.mediaHost.status, 'built');
	assert.deepEqual(summary.mediaHost.m9ReleaseReview, {
		scope: 'stable-1.0-release', status: 'pending',
		detail: 'No independent media-host review is recorded for stable 1.0 release admission.',
	});
	assert.equal(summary.mediaHost.productionReadiness, null);
	assert.deepEqual(Object.keys(summary.mediaHost.reviewPolicy).sort(), [
		'byteLength', 'name', 'sha256',
	]);
	assert.equal(summary.openFxHost.status, 'built');
	assert.deepEqual(summary.openFxHost.m9ReleaseReview, {
		scope: 'stable-1.0-release', status: 'pending',
		detail: 'No independent OpenFX-host review is recorded for stable 1.0 release admission.',
	});
	assert.equal(summary.openFxHost.productionReadiness, null);
	assert.deepEqual(Object.keys(summary.openFxHost.reviewPolicy).sort(), [
		'byteLength', 'name', 'sha256',
	]);
	const mediaOutput = join(outputRoot, 'native/framescaper-media-host', TARGET);
	const openFxOutput = join(outputRoot, 'native/framescaper-openfx-host', TARGET);
	assert.deepEqual((await readdir(mediaOutput)).sort(), [
		'framescaper-media-host', 'libframescaper-media.so', 'milestone-5-native-isolation-review-policy.json',
		'milestone5-native-isolation-broker.json', 'milestone5-native-isolation-launcher', 'milestone5-native-isolation-profile.json',
	]);
	assert.deepEqual((await readdir(openFxOutput)).sort(), [
		'framescaper-ofx-runtime-host', 'framescaper-ofx-scanner', 'ld-linux-x86-64.so.2',
		'milestone-5-native-isolation-review-policy.json', 'milestone5-native-isolation-broker.json',
		'milestone5-native-isolation-launcher', 'milestone5-native-isolation-profile.json',
	]);
	assert.deepEqual(readFileSync(join(mediaOutput, 'framescaper-media-host')), MEDIA_BYTES);
	assert.deepEqual(readFileSync(join(openFxOutput, 'framescaper-ofx-scanner')), SCANNER_BYTES);
	assert.deepEqual(readFileSync(join(openFxOutput, 'framescaper-ofx-runtime-host')), RUNTIME_BYTES);
	await assert.doesNotReject(() => verifyStagedFramescaperNativeHostPayloads({ release, outputRoot }));
	await assert.rejects(
		() => stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot }),
		/Framescaper (?:media|OpenFX)-host payload root already exists/iu,
	);
});

test('signed OpenFX readiness and its scoped review policy survive exact staging', async (context) => {
	const repositoryRoot = builtFixture(context, 'framescaper-reviewed-host-fixture-');
	attachOpenFxReadiness(repositoryRoot);
	const outputRoot = temporaryRoot(context, 'framescaper-reviewed-host-stage-');
	const release = await verifyFramescaperNativeHostPayloads({
		repositoryRoot, target: TARGET, targetSource: 'declared',
	});
	const summary = await stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot });
	assert.deepEqual(summary.openFxHost.m9ReleaseReview, {
		scope: 'stable-1.0-release', status: 'complete',
		reviewer: 'synthetic OpenFX isolation reviewer', reviewedAt: '2026-08-24',
	});
	assert.equal(summary.openFxHost.productionReadiness.verified.status, 'authenticated');
	assert.equal(summary.openFxHost.productionReadiness.verified.evidence.target, TARGET);
	const openFxOutput = join(outputRoot, 'native/framescaper-openfx-host', TARGET);
	assert.deepEqual((await readdir(openFxOutput)).sort(), [
		'framescaper-ofx-runtime-host', 'framescaper-ofx-scanner',
		'framescaper-openfx-production-readiness.json', 'ld-linux-x86-64.so.2',
		'milestone-5-native-isolation-review-policy.json', 'milestone5-native-isolation-broker.json',
		'milestone5-native-isolation-launcher', 'milestone5-native-isolation-profile.json',
	]);
	await assert.doesNotReject(() => verifyStagedFramescaperNativeHostPayloads({ release, outputRoot }));
	await writeFile(join(openFxOutput, 'framescaper-openfx-production-readiness.json'),
		Buffer.from('changed readiness evidence'));
	await assert.rejects(() => verifyStagedFramescaperNativeHostPayloads({ release, outputRoot }),
		/OpenFX.*production-readiness.*(?:byte length|digest)/iu);
});

test('invalid OpenFX M9 review metadata does not withhold exact isolated host payloads', async (context) => {
	const repositoryRoot = builtFixture(context, 'framescaper-invalid-reviewed-host-fixture-');
	attachOpenFxReadiness(repositoryRoot);
	writeFileSync(join(repositoryRoot, 'config/framescaper-openfx-production-readiness', `${TARGET}.json`),
		Buffer.from('invalidated review evidence'));
	const outputRoot = temporaryRoot(context, 'framescaper-invalid-reviewed-host-stage-');
	const release = await verifyFramescaperNativeHostPayloads({ repositoryRoot, target: TARGET, targetSource: 'declared' });
	const summary = await stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot });
	assert.equal(summary.openFxHost.status, 'built');
	assert.equal(summary.openFxHost.payloads.length, 6);
	assert.equal(summary.openFxHost.productionReadiness, null);
	assert.equal(summary.openFxHost.m9ReleaseReview.scope, 'stable-1.0-release');
	assert.equal(summary.openFxHost.m9ReleaseReview.status, 'invalid');
	assert.match(summary.openFxHost.m9ReleaseReview.detail, /M9 review is invalid/iu);
	await assert.doesNotReject(() => verifyStagedFramescaperNativeHostPayloads({ release, outputRoot }));
});

test('signed media-host readiness and its independent review policy survive exact staging', async (context) => {
	const repositoryRoot = builtFixture(context, 'framescaper-reviewed-media-host-fixture-');
	attachMediaReadiness(repositoryRoot);
	const outputRoot = temporaryRoot(context, 'framescaper-reviewed-media-host-stage-');
	const release = await verifyFramescaperNativeHostPayloads({
		repositoryRoot, target: TARGET, targetSource: 'declared',
	});
	const summary = await stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot });
	assert.deepEqual(summary.mediaHost.m9ReleaseReview, {
		scope: 'stable-1.0-release', status: 'complete',
		reviewer: 'synthetic media isolation reviewer', reviewedAt: '2026-08-24',
	});
	assert.equal(summary.mediaHost.productionReadiness.verified.status, 'authenticated');
	assert.equal(summary.mediaHost.productionReadiness.verified.evidence.target, TARGET);
	const mediaOutput = join(outputRoot, 'native/framescaper-media-host', TARGET);
	assert.ok((await readdir(mediaOutput)).includes('framescaper-media-host-production-readiness.json'));
	await assert.doesNotReject(() => verifyStagedFramescaperNativeHostPayloads({ release, outputRoot }));
});

test('verification rejects tamper, substitution, traversal, symlinks, and incomplete rows before staging', async (context) => {
	for (const [name, mutate, pattern] of [
		['media tamper', (root) => writeFileSync(join(root, MEDIA_PATH), Buffer.from('tampered')), /media-host.*(?:byte length|digest)/iu],
		['OpenFX substitution', (root) => writeFileSync(join(root, SCANNER_PATH), RUNTIME_BYTES), /OpenFX.*(?:bytes disagree|digest)/iu],
		['media traversal', (root) => mutateMediaPayload(root, { path: `${MEDIA_ROOT}/prebuilt/${TARGET}/../escape` }), /media-host.*(?:missing|path|payload)/iu],
		['incomplete OpenFX row', (root) => mutateOpenFxPayloadRow(root, (row) => { delete row.runtimeHostPayload; }), /OpenFX.*(?:manifest|payload|record)/iu],
	]) {
		const root = builtFixture(context, `framescaper-${name.replaceAll(' ', '-')}-`);
		mutate(root);
		await assert.rejects(
			() => verifyFramescaperNativeHostPayloads({ repositoryRoot: root, target: TARGET }),
			pattern,
			name,
		);
	}

	const symlinkRoot = builtFixture(context, 'framescaper-media-symlink-');
	const payload = join(symlinkRoot, MEDIA_PATH);
	const substitute = join(symlinkRoot, 'media-host-substitute');
	writeFileSync(substitute, MEDIA_BYTES);
	rmSync(payload);
	symlinkSync(substitute, payload);
	assert.equal(lstatSync(payload).isSymbolicLink(), true);
	await assert.rejects(
		() => verifyFramescaperNativeHostPayloads({ repositoryRoot: symlinkRoot, target: TARGET }),
		/symbolic link|canonical regular file/iu,
	);
});

test('staged substitution, extra files, and altered stage summaries fail closed', async (context) => {
	const repositoryRoot = builtFixture(context);
	const release = await verifyFramescaperNativeHostPayloads({ repositoryRoot, target: TARGET });
	for (const [name, mutate, pattern] of [
		['payload', (root) => writeFile(join(root, 'native/framescaper-media-host', TARGET, 'framescaper-media-host'), 'changed'), /media-host.*(?:byte length|digest)/iu],
		['inventory', (root) => writeFile(join(root, 'native/framescaper-openfx-host', TARGET, 'extra'), 'extra'), /inventory/iu],
	]) {
		const outputRoot = temporaryRoot(context, `framescaper-staged-${name}-`);
		await stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot });
		await mutate(outputRoot);
		await assert.rejects(
			() => verifyStagedFramescaperNativeHostPayloads({ release, outputRoot }), pattern,
		);
	}
	const outputRoot = temporaryRoot(context, 'framescaper-staged-summary-');
	await stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot });
	const stageManifestPath = join(outputRoot, 'stage-manifest.json');
	await writeFile(stageManifestPath, JSON.stringify({ framescaperNativeHosts: null }));
	await assert.rejects(
		() => verifyStagedFramescaperNativeHostPayloads({ release, outputRoot, stageManifestPath }),
		/stage manifest.*native-host summary/iu,
	);
});

test('beforePack binds staged host bytes to the Framescaper product and packaged target', async (context) => {
	const repositoryRoot = builtFixture(context);
	const release = await verifyFramescaperNativeHostPayloads({ repositoryRoot, target: TARGET });
	const outputRoot = join(repositoryRoot, '.desktop-build/runtime');
	await stageVerifiedFramescaperNativeHostPayloads({ release, outputRoot });
	const applicationRoot = join(repositoryRoot, '.desktop-build/app');
	mkdirSync(join(applicationRoot, 'config'), { recursive: true });
	cpSync(
		join(repositoryRoot, 'config/framescaper-media-host-payload-manifest.json'),
		join(applicationRoot, 'config/framescaper-media-host-payload-manifest.json'),
	);
	cpSync(
		join(repositoryRoot, 'config/framescaper-openfx-host-payload-manifest.json'),
		join(applicationRoot, 'config/framescaper-openfx-host-payload-manifest.json'),
	);
	const stageManifestPath = join(repositoryRoot, '.desktop-build/stage-manifest.json');
	await writeFile(stageManifestPath, JSON.stringify({
		productId: 'framescaper',
		framescaperNativeHosts: framescaperNativeHostPayloadStageSummary(release),
	}));
	await assert.doesNotReject(() => verifyStagedFramescaperNativeHostsBeforePack({
		repositoryRoot, stageManifestPath, packagedTarget: TARGET,
	}));
	await assert.rejects(
		() => verifyStagedFramescaperNativeHostsBeforePack({
			repositoryRoot, stageManifestPath, packagedTarget: 'linux-arm64',
		}),
		/staged Framescaper native hosts target linux-x64.*packing linux-arm64/iu,
	);
	await writeFile(
		join(applicationRoot, 'config/framescaper-media-host-payload-manifest.json'),
		'{}',
	);
	await assert.rejects(
		() => verifyStagedFramescaperNativeHostsBeforePack({
			repositoryRoot, stageManifestPath, packagedTarget: TARGET,
		}),
		/staged Framescaper media-host payload manifest.*verified policy manifest/iu,
	);
	await writeFile(stageManifestPath, JSON.stringify({
		productId: 'soundscaper',
		framescaperNativeHosts: framescaperNativeHostPayloadStageSummary(release),
	}));
	await assert.rejects(
		() => verifyStagedFramescaperNativeHostsBeforePack({
			repositoryRoot, stageManifestPath, packagedTarget: TARGET,
		}),
		/Soundscaper.*cannot carry Framescaper native-host payloads/iu,
	);
});

test('afterPack re-verifies the exact Framescaper native-host resource tree', async (context) => {
	const repositoryRoot = builtFixture(context);
	const resources = join(repositoryRoot, 'packaged-resources');
	const release = await verifyFramescaperNativeHostPayloads({ repositoryRoot, target: TARGET });
	await stageVerifiedFramescaperNativeHostPayloads({
		release,
		outputRoot: join(resources, 'runtime'),
	});
	const packagingContext = {
		electronPlatformName: 'linux',
		arch: 1,
		appOutDir: repositoryRoot,
		packager: {
			appInfo: { productFilename: 'Framescaper' },
			getResourcesDir: () => resources,
		},
	};
	await assert.doesNotReject(() => verifyPackagedFramescaperNativeHostResources(
		packagingContext, { repositoryRoot },
	));
	packagingContext.packager.appInfo.productFilename = 'framescaper';
	await assert.doesNotReject(() => verifyPackagedFramescaperNativeHostResources(
		packagingContext, { repositoryRoot },
	));
	await writeFile(
		join(resources, 'runtime/native/framescaper-openfx-host', TARGET, 'framescaper-ofx-scanner'),
		Buffer.from('signed-or-substituted'),
	);
	await assert.rejects(
		() => verifyPackagedFramescaperNativeHostResources(packagingContext, { repositoryRoot }),
		/packaged Framescaper OpenFX-host.*(?:byte length|digest)/iu,
	);
});

function builtFixture(context, prefix = 'framescaper-built-host-fixture-') {
	const root = sourceFixture(context, prefix);
	mkdirSync(join(root, MEDIA_ROOT, 'prebuilt', TARGET), { recursive: true });
	mkdirSync(join(root, MEDIA_ROOT, 'prebuilt', TARGET, 'isolation'), { recursive: true });
	mkdirSync(join(root, MEDIA_ROOT, 'prebuilt', TARGET, 'lib'), { recursive: true });
	mkdirSync(join(root, OPENFX_ROOT, 'prebuilt', TARGET, 'bin'), { recursive: true });
	mkdirSync(join(root, OPENFX_ROOT, 'prebuilt', TARGET, 'isolation'), { recursive: true });
	mkdirSync(join(root, OPENFX_ROOT, 'prebuilt', TARGET, 'lib'), { recursive: true });
	writeFileSync(join(root, MEDIA_PATH), MEDIA_BYTES);
	writeFileSync(join(root, MEDIA_LAUNCHER_PATH), LAUNCHER_BYTES);
	writeFileSync(join(root, MEDIA_PROFILE_PATH), PROFILE_BYTES);
	writeFileSync(join(root, MEDIA_BROKER_PATH), BROKER_BYTES);
	writeFileSync(join(root, MEDIA_LIBRARY_PATH), MEDIA_LIBRARY_BYTES);
	writeFileSync(join(root, SCANNER_PATH), SCANNER_BYTES);
	writeFileSync(join(root, RUNTIME_PATH), RUNTIME_BYTES);
	writeFileSync(join(root, LAUNCHER_PATH), LAUNCHER_BYTES);
	writeFileSync(join(root, PROFILE_PATH), PROFILE_BYTES);
	writeFileSync(join(root, BROKER_PATH), BROKER_BYTES);
	writeFileSync(join(root, LIBRARY_PATH), LIBRARY_BYTES);

	const mediaSourcePath = join(root, MEDIA_ROOT, 'source-manifest.json');
	const mediaSource = JSON.parse(readFileSync(mediaSourcePath, 'utf8'));
	mediaSource.targets[TARGET] = {
		runtime: TARGET, status: 'built', blockedBy: null,
		toolchainIdentity: digest(Buffer.from('media-toolchain')),
		payload: descriptor(MEDIA_PATH, MEDIA_BYTES),
		isolationPayload: {
			launcherPayload: descriptor(MEDIA_LAUNCHER_PATH, LAUNCHER_BYTES),
			sandboxProfilePayload: descriptor(MEDIA_PROFILE_PATH, PROFILE_BYTES),
			brokerPolicyPayload: descriptor(MEDIA_BROKER_PATH, BROKER_BYTES),
			runtimeLibraryPayloads: [descriptor(MEDIA_LIBRARY_PATH, MEDIA_LIBRARY_BYTES)],
		},
		productionReadiness: null,
	};
	writeJson(mediaSourcePath, mediaSource);
	writeJson(
		join(root, 'config/framescaper-media-host-payload-manifest.json'),
		deriveFramescaperMediaHostPayloadManifest(mediaSource),
	);

	const openFxSourcePath = join(root, OPENFX_ROOT, 'source-manifest.json');
	const openFxSource = JSON.parse(readFileSync(openFxSourcePath, 'utf8'));
	openFxSource.targets[TARGET] = {
		runtime: TARGET, status: 'built', blockedBy: null,
		toolchainIdentity: digest(Buffer.from('openfx-toolchain')),
		scannerPayload: descriptor(SCANNER_PATH, SCANNER_BYTES),
		runtimeHostPayload: descriptor(RUNTIME_PATH, RUNTIME_BYTES),
		isolationPayload: {
			launcherPayload: descriptor(LAUNCHER_PATH, LAUNCHER_BYTES),
			sandboxProfilePayload: descriptor(PROFILE_PATH, PROFILE_BYTES),
			brokerPolicyPayload: descriptor(BROKER_PATH, BROKER_BYTES),
			runtimeLibraryPayloads: [descriptor(LIBRARY_PATH, LIBRARY_BYTES)],
		},
		productionReadiness: null,
	};
	writeJson(openFxSourcePath, openFxSource);
	writeJson(
		join(root, 'config/framescaper-openfx-host-payload-manifest.json'),
		deriveFramescaperOpenFxPayloadManifest(openFxSource),
	);
	return root;
}

function pendingFixture(context) {
	const root = sourceFixture(context, 'framescaper-pending-host-fixture-');
	const media = JSON.parse(readFileSync(join(root, MEDIA_ROOT, 'source-manifest.json'), 'utf8'));
	const openFx = JSON.parse(readFileSync(join(root, OPENFX_ROOT, 'source-manifest.json'), 'utf8'));
	writeJson(join(root, 'config/framescaper-media-host-payload-manifest.json'),
		deriveFramescaperMediaHostPayloadManifest(media));
	writeJson(join(root, 'config/framescaper-openfx-host-payload-manifest.json'),
		deriveFramescaperOpenFxPayloadManifest(openFx));
	return root;
}

function sourceFixture(context, prefix) {
	const root = temporaryRoot(context, prefix);
	mkdirSync(join(root, 'config'), { recursive: true });
	cpSync(join(REPOSITORY_ROOT, MEDIA_ROOT), join(root, MEDIA_ROOT), { recursive: true });
	cpSync(join(REPOSITORY_ROOT, OPENFX_ROOT), join(root, OPENFX_ROOT), { recursive: true });
	cpSync(
		join(REPOSITORY_ROOT, 'config/boost-multiprecision-source-manifest.json'),
		join(root, 'config/boost-multiprecision-source-manifest.json'),
	);
	cpSync(
		join(REPOSITORY_ROOT, 'config/milestone-5-native-isolation-review-policy.json'),
		join(root, 'config/milestone-5-native-isolation-review-policy.json'),
	);
	cpSync(join(REPOSITORY_ROOT, '.gitattributes'), join(root, '.gitattributes'));
	repinFixtureSources(root, MEDIA_ROOT);
	repinFixtureSources(root, OPENFX_ROOT);
	return root;
}

function repinFixtureSources(root, nativeRoot) {
	const manifestPath = join(root, nativeRoot, 'source-manifest.json');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	if (nativeRoot === MEDIA_ROOT) {
		for (const path of ['src/media_host_arguments.cpp', 'src/media_host_arguments.hpp']) {
			if (!manifest.sourceFiles.some((entry) => entry.path === path)) {
				manifest.sourceFiles.push({ path, byteLength: 0, sha256: '' });
			}
		}
		manifest.sourceFiles.sort((left, right) => left.path.localeCompare(right.path, 'en'));
	}
	for (const source of manifest.sourceFiles) {
		const bytes = readFileSync(join(root, nativeRoot, source.path));
		source.byteLength = bytes.byteLength;
		source.sha256 = digest(bytes);
	}
	writeJson(manifestPath, manifest);
}

function attachOpenFxReadiness(root) {
	const sourcePath = join(root, OPENFX_ROOT, 'source-manifest.json');
	const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
	const target = source.targets[TARGET];
	const evidence = {
		schemaVersion: 1,
		kind: 'framescaper-openfx-production-readiness',
		target: TARGET,
		scannerSha256: target.scannerPayload.sha256,
		runtimeHostSha256: target.runtimeHostPayload.sha256,
		qualifiedGpuBackends: ['opengl', 'opencl', 'cuda'],
		runtimeLibraries: target.isolationPayload.runtimeLibraryPayloads.map((library) => ({
			name: library.path.split('/').at(-1),
			byteLength: library.byteLength,
			sha256: library.sha256,
		})),
		launcher: {
			schemaVersion: 1,
			target: TARGET,
			launcherId: 'framescaper-linux-landlock-seccomp-namespaces-v1',
			launcherPayloadSha256: target.isolationPayload.launcherPayload.sha256,
			sandboxProfileSha256: target.isolationPayload.sandboxProfilePayload.sha256,
			brokerPolicySha256: target.isolationPayload.brokerPolicyPayload.sha256,
			filesystem: 'broker-only',
			network: 'denied',
			childProcesses: 'denied',
			dynamicCode: 'admitted-plugin-only',
		},
		openfxVersion: '1.5.1',
		osIsolationAttested: true,
		hostilePluginDenialAttested: true,
		realThirdPartyExecutionAttested: true,
		reviewedAt: '2026-08-24',
		reviewer: 'synthetic OpenFX isolation reviewer',
	};
	const evidenceBytes = Buffer.from(JSON.stringify(evidence));
	const key = generateKeyPairSync('ed25519');
	const keyId = 'synthetic-openfx-isolation-review-v1';
	const evidencePath = `config/framescaper-openfx-production-readiness/${TARGET}.json`;
	mkdirSync(join(root, 'config/framescaper-openfx-production-readiness'), { recursive: true });
	writeFileSync(join(root, evidencePath), evidenceBytes);
	target.productionReadiness = {
		schemaVersion: 2,
		status: 'reviewed',
		target: TARGET,
		evidence: descriptor(evidencePath, evidenceBytes),
		signature: {
			algorithm: 'ed25519',
			reviewKeyId: keyId,
			valueBase64: sign(null, evidenceBytes, key.privateKey).toString('base64'),
		},
	};
	writeJson(sourcePath, source);
	writeJson(
		join(root, 'config/framescaper-openfx-host-payload-manifest.json'),
		deriveFramescaperOpenFxPayloadManifest(source),
	);
	writeJson(join(root, 'config/milestone-5-native-isolation-review-policy.json'), {
		schemaVersion: 1,
		algorithm: 'Ed25519',
		trustedKeys: [{
			id: keyId,
			status: 'accepted',
			usages: ['framescaper-openfx-production-readiness'],
			targets: [TARGET],
			publicKeyPem: key.publicKey.export({ type: 'spki', format: 'pem' }),
		}],
		blockedBy: 'Synthetic tests bind this key only to the exact OpenFX isolation readiness usage and target.',
	});
}

function attachMediaReadiness(root) {
	const sourcePath = join(root, MEDIA_ROOT, 'source-manifest.json');
	const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
	const target = source.targets[TARGET];
	const evidence = {
		schemaVersion: 1,
		kind: 'framescaper-media-host-production-readiness',
		target: TARGET,
		mediaHostSha256: target.payload.sha256,
		runtimeLibraries: target.isolationPayload.runtimeLibraryPayloads.map((library) => ({
			name: library.path.split('/').at(-1),
			byteLength: library.byteLength,
			sha256: library.sha256,
		})),
		launcher: {
			schemaVersion: 1,
			target: TARGET,
			launcherId: 'framescaper-linux-landlock-seccomp-namespaces-v1',
			launcherPayloadSha256: target.isolationPayload.launcherPayload.sha256,
			sandboxProfileSha256: target.isolationPayload.sandboxProfilePayload.sha256,
			brokerPolicySha256: target.isolationPayload.brokerPolicyPayload.sha256,
			filesystem: 'broker-grant-only',
			network: 'denied',
			childProcesses: 'denied',
			dynamicCode: 'denied',
		},
		ffmpegVersion: '9.0.1',
		osIsolationAttested: true,
		hostileMediaDenialAttested: true,
		dualStreamFdRemapAttested: true,
		twoHourContinuityAttested: true,
		reviewedAt: '2026-08-24',
		reviewer: 'synthetic media isolation reviewer',
	};
	const evidenceBytes = Buffer.from(JSON.stringify(evidence));
	const key = generateKeyPairSync('ed25519');
	const keyId = 'synthetic-media-isolation-review-v1';
	const evidencePath = `config/framescaper-media-host-production-readiness/${TARGET}.json`;
	mkdirSync(join(root, 'config/framescaper-media-host-production-readiness'), { recursive: true });
	writeFileSync(join(root, evidencePath), evidenceBytes);
	target.productionReadiness = {
		schemaVersion: 2, status: 'reviewed', target: TARGET,
		evidence: descriptor(evidencePath, evidenceBytes),
		signature: {
			algorithm: 'ed25519', reviewKeyId: keyId,
			valueBase64: sign(null, evidenceBytes, key.privateKey).toString('base64'),
		},
	};
	writeJson(sourcePath, source);
	writeJson(join(root, 'config/framescaper-media-host-payload-manifest.json'),
		deriveFramescaperMediaHostPayloadManifest(source));
	writeJson(join(root, 'config/milestone-5-native-isolation-review-policy.json'), {
		schemaVersion: 1,
		algorithm: 'Ed25519',
		trustedKeys: [{
			id: keyId, status: 'accepted',
			usages: ['framescaper-media-host-production-readiness'], targets: [TARGET],
			publicKeyPem: key.publicKey.export({ type: 'spki', format: 'pem' }),
		}],
		blockedBy: 'Synthetic tests bind this key only to the exact media-host isolation readiness usage and target.',
	});
}

function mutateMediaPayload(root, overrides) {
	const sourcePath = join(root, MEDIA_ROOT, 'source-manifest.json');
	const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
	Object.assign(source.targets[TARGET].payload, overrides);
	writeJson(sourcePath, source);
	writeJson(
		join(root, 'config/framescaper-media-host-payload-manifest.json'),
		deriveFramescaperMediaHostPayloadManifest(source),
	);
}

function mutateOpenFxPayloadRow(root, mutate) {
	const path = join(root, 'config/framescaper-openfx-host-payload-manifest.json');
	const manifest = JSON.parse(readFileSync(path, 'utf8'));
	mutate(manifest.payloads.find(({ id }) => id === TARGET));
	writeJson(path, manifest);
}

function descriptor(path, bytes) {
	return { path, byteLength: bytes.byteLength, sha256: digest(bytes) };
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}

function temporaryRoot(context, prefix) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

async function assertMissing(path) {
	await assert.rejects(() => access(path), /ENOENT/u);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	cpSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { access, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { verifyPackagedFramescaperNativeHostResources } from '../scripts/desktop-after-pack.mjs';
import { verifyStagedFramescaperNativeHostsBeforePack } from '../scripts/desktop-before-pack.mjs';
import {
	deriveFramescaperMediaHostPayloadManifest,
} from '../scripts/lib/framescaper-media-host-build.mjs';
import {
	deriveFramescaperOpenFxPayloadManifest,
} from '../scripts/lib/framescaper-openfx-host-build.mjs';
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
const SCANNER_PATH = `${OPENFX_ROOT}/prebuilt/${TARGET}/bin/framescaper-ofx-scanner`;
const RUNTIME_PATH = `${OPENFX_ROOT}/prebuilt/${TARGET}/bin/framescaper-ofx-runtime-host`;
const MEDIA_BYTES = Buffer.from('verified-framescaper-media-host');
const SCANNER_BYTES = Buffer.from('verified-framescaper-ofx-scanner');
const RUNTIME_BYTES = Buffer.from('verified-framescaper-ofx-runtime-host');

test('pending-external current targets stage no host bytes or target directories', async (context) => {
	const outputRoot = temporaryRoot(context, 'framescaper-pending-host-stage-');
	const release = await verifyFramescaperNativeHostPayloads({
		repositoryRoot: REPOSITORY_ROOT,
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
	assert.equal(summary.openFxHost.status, 'built');
	const mediaOutput = join(outputRoot, 'native/framescaper-media-host', TARGET);
	const openFxOutput = join(outputRoot, 'native/framescaper-openfx-host', TARGET);
	assert.deepEqual(await readdir(mediaOutput), ['framescaper-media-host']);
	assert.deepEqual((await readdir(openFxOutput)).sort(), [
		'framescaper-ofx-runtime-host', 'framescaper-ofx-scanner',
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
	const root = temporaryRoot(context, prefix);
	mkdirSync(join(root, 'config'), { recursive: true });
	cpSync(join(REPOSITORY_ROOT, MEDIA_ROOT), join(root, MEDIA_ROOT), { recursive: true });
	cpSync(join(REPOSITORY_ROOT, OPENFX_ROOT), join(root, OPENFX_ROOT), { recursive: true });
	cpSync(
		join(REPOSITORY_ROOT, 'config/boost-multiprecision-source-manifest.json'),
		join(root, 'config/boost-multiprecision-source-manifest.json'),
	);
	mkdirSync(join(root, MEDIA_ROOT, 'prebuilt', TARGET), { recursive: true });
	mkdirSync(join(root, OPENFX_ROOT, 'prebuilt', TARGET, 'bin'), { recursive: true });
	writeFileSync(join(root, MEDIA_PATH), MEDIA_BYTES);
	writeFileSync(join(root, SCANNER_PATH), SCANNER_BYTES);
	writeFileSync(join(root, RUNTIME_PATH), RUNTIME_BYTES);

	const mediaSourcePath = join(root, MEDIA_ROOT, 'source-manifest.json');
	const mediaSource = JSON.parse(readFileSync(mediaSourcePath, 'utf8'));
	mediaSource.targets[TARGET] = {
		runtime: TARGET, status: 'built', blockedBy: null,
		toolchainIdentity: digest(Buffer.from('media-toolchain')),
		payload: descriptor(MEDIA_PATH, MEDIA_BYTES),
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
		productionReadiness: null,
	};
	writeJson(openFxSourcePath, openFxSource);
	writeJson(
		join(root, 'config/framescaper-openfx-host-payload-manifest.json'),
		deriveFramescaperOpenFxPayloadManifest(openFxSource),
	);
	return root;
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

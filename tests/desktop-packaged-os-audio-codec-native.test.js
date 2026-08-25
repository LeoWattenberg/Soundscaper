/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	chmod, mkdir, mkdtemp, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { verifyPackagedOsAudioCodecNativeResources } from '../scripts/desktop-after-pack.mjs';
import { verifyStagedOsAudioCodecNativeBeforePack } from '../scripts/desktop-before-pack.mjs';
import {
	stageDesktopOsAudioCodecNativeRelease,
} from '../scripts/lib/desktop-os-audio-codec-native-staging.mjs';
import {
	OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME,
	OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX,
	verifyOsAudioCodecNativeBuildResult,
} from '../scripts/lib/os-audio-codec-native-payload.mjs';

const TARGET = 'win-x64';

test('beforePack authenticates the exact built codec-only subtree and its stage evidence', async (context) => {
	const fixture = await stagedTree(context);
	assert.deepEqual(await verifyStagedOsAudioCodecNativeBeforePack({
		repositoryRoot: fixture.root,
		stageManifestPath: fixture.stageManifestPath,
		packagedTarget: TARGET,
	}), fixture.summary);

	const changedSummary = structuredClone(fixture.stage);
	changedSummary.osAudioCodecNative.payload.sha256 = '0'.repeat(64);
	await writeJson(fixture.stageManifestPath, changedSummary);
	await assert.rejects(() => verifyStagedOsAudioCodecNativeBeforePack({
		repositoryRoot: fixture.root,
		stageManifestPath: fixture.stageManifestPath,
		packagedTarget: TARGET,
	}), /stage manifest.*OS audio codec.*evidence/iu);
	changedSummary.osAudioCodecNative = structuredClone(fixture.summary);
	changedSummary.osAudioCodecNative.signing.verificationStatus = 'passed';
	await writeJson(fixture.stageManifestPath, changedSummary);
	await assert.rejects(() => verifyStagedOsAudioCodecNativeBeforePack({
		repositoryRoot: fixture.root,
		stageManifestPath: fixture.stageManifestPath,
		packagedTarget: TARGET,
	}), /stage manifest.*OS audio codec.*evidence/iu);
});

test('beforePack accepts exact null/absence and rejects an unclaimed codec subtree', async (context) => {
	for (const [productId, target] of [
		['soundscaper', TARGET], ['soundscaper', 'linux-x64'], ['framescaper', TARGET],
	]) {
		const fixture = await absentTree(context, productId, target);
		assert.equal(await verifyStagedOsAudioCodecNativeBeforePack({
			repositoryRoot: fixture.root,
			stageManifestPath: fixture.stageManifestPath,
			packagedTarget: target,
		}), null);
	}
	const unexpected = await absentTree(context, 'soundscaper', TARGET);
	await mkdir(join(
		unexpected.root, '.desktop-build/runtime', OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX,
	), { recursive: true });
	await assert.rejects(() => verifyStagedOsAudioCodecNativeBeforePack({
		repositoryRoot: unexpected.root,
		stageManifestPath: unexpected.stageManifestPath,
		packagedTarget: TARGET,
	}), /must be absent|unexpected.*subtree/iu);
});

test('beforePack rejects changed bytes and foreign codec target siblings', async (context) => {
	const changed = await stagedTree(context);
	const payloadPath = join(
		changed.runtimeRoot, OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX, TARGET,
		OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME,
	);
	await chmod(payloadPath, 0o644);
	await writeFile(payloadPath, 'changed');
	await assert.rejects(() => verifyStagedOsAudioCodecNativeBeforePack({
		repositoryRoot: changed.root,
		stageManifestPath: changed.stageManifestPath,
		packagedTarget: TARGET,
	}), /payload.*(?:byte length|digest)/iu);

	const foreign = await stagedTree(context);
	await mkdir(join(
		foreign.runtimeRoot, OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX, 'win-arm64',
	), { recursive: true });
	await assert.rejects(() => verifyStagedOsAudioCodecNativeBeforePack({
		repositoryRoot: foreign.root,
		stageManifestPath: foreign.stageManifestPath,
		packagedTarget: TARGET,
	}), /unexpected.*subtree/iu);
});

test('afterPack authenticates packaged codec bytes and refuses unexpected content', async (context) => {
	const fixture = await packagedTree(context);
	assert.deepEqual(await verifyPackagedOsAudioCodecNativeResources(
		packagingContext(fixture.root, fixture.resourcesRoot, TARGET),
		{ stageManifestPath: fixture.stageManifestPath },
	), fixture.summary);

	const targetRoot = join(
		fixture.runtimeRoot, OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX, TARGET,
	);
	await writeFile(join(targetRoot, 'foreign.node'), 'foreign');
	await assert.rejects(() => verifyPackagedOsAudioCodecNativeResources(
		packagingContext(fixture.root, fixture.resourcesRoot, TARGET),
		{ stageManifestPath: fixture.stageManifestPath },
	), /inventory|unexpected.*subtree/iu);
});

test('afterPack enforces package target/product identity even when the codec tier is absent', async (context) => {
	const fixture = await absentTree(context, 'soundscaper', TARGET);
	const contextValue = packagingContext(fixture.root, fixture.resourcesRoot, 'win-arm64');
	await assert.rejects(() => verifyPackagedOsAudioCodecNativeResources(contextValue, {
		stageManifestPath: fixture.stageManifestPath,
	}), /stage.*target.*win-x64.*win-arm64/iu);
	const framescaper = await absentTree(context, 'framescaper', TARGET);
	const framescaperContext = packagingContext(framescaper.root, framescaper.resourcesRoot, TARGET);
	framescaperContext.packager.appInfo.productFilename = 'Framescaper';
	assert.equal(await verifyPackagedOsAudioCodecNativeResources(framescaperContext, {
		stageManifestPath: framescaper.stageManifestPath,
	}), null);
});

async function stagedTree(context) {
	const fixture = await releaseFixture(context, TARGET);
	const runtimeRoot = join(fixture.root, '.desktop-build/runtime');
	const summary = await stageDesktopOsAudioCodecNativeRelease({
		release: fixture.release, runtimeRoot,
	});
	const stageManifestPath = join(fixture.root, '.desktop-build/stage-manifest.json');
	const stage = stageValue('soundscaper', TARGET, summary);
	await writeJson(stageManifestPath, stage);
	return { ...fixture, runtimeRoot, summary, stage, stageManifestPath };
}

async function packagedTree(context) {
	const fixture = await releaseFixture(context, TARGET);
	const resourcesRoot = join(fixture.root, 'resources');
	const runtimeRoot = join(resourcesRoot, 'runtime');
	const summary = await stageDesktopOsAudioCodecNativeRelease({
		release: fixture.release, runtimeRoot,
	});
	const stageManifestPath = join(fixture.root, 'stage-manifest.json');
	const stage = stageValue('soundscaper', TARGET, summary);
	await writeJson(stageManifestPath, stage);
	return { ...fixture, resourcesRoot, runtimeRoot, summary, stage, stageManifestPath };
}

async function absentTree(context, productId, target) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-packaged-os-codec-absent-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const resourcesRoot = join(root, 'resources');
	const runtimeRoot = join(resourcesRoot, 'runtime');
	await mkdir(runtimeRoot, { recursive: true });
	const stageManifestPath = join(root, 'stage-manifest.json');
	await writeJson(stageManifestPath, stageValue(productId, target, null));
	return { root, resourcesRoot, runtimeRoot, stageManifestPath };
}

async function releaseFixture(context, target) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-packaged-os-codec-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const artifactPath = join(root, 'build', OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME);
	const bytes = Buffer.from('authenticated packaged OS audio codec');
	await mkdir(dirname(artifactPath), { recursive: true });
	await writeFile(artifactPath, bytes);
	const sourceRevision = '3'.repeat(64);
	const buildPlanSha256 = '4'.repeat(64);
	const build = {
		schemaVersion: 1,
		status: 'built',
		target,
		artifact: { path: artifactPath, byteLength: bytes.byteLength, sha256: digest(bytes) },
		electronHeaders: {
			version: '43.1.1',
			archive: {
				byteLength: 344_774,
				sha256: 'b1112989ad4c4807a6bf59bfc96ce8d0f0b16962efe9818fa768e5908cc24d21',
			},
			extractedTree: {
				algorithm: 'framescaper-portable-source-tree-sha256-v1',
				fileCount: 124,
				sha256: '9eae0a9eb7630b1b53f98e4b7c69951aee2a159ff1f564eeed06b78580de62eb',
			},
		},
		sourceIdentity: {
			algorithm: 'soundscaper-os-audio-codec-source-closure-sha256-v1',
			fileCount: 12,
			sha256: sourceRevision,
		},
		sourceRevision,
		buildPlan: {
			algorithm: 'soundscaper-os-audio-codec-build-plan-sha256-v1',
			sha256: buildPlanSha256,
		},
		buildPlanSha256,
		toolchainIdentity: {
			cmake: '3.31.6', generator: 'Visual Studio 17 2022',
			cxxCompilerId: 'MSVC', cxxCompilerVersion: '19.44.35207.1',
			systemName: 'Windows', systemProcessor: 'AMD64',
		},
		nativeCanary: { status: 'passed', testCommand: 'ctest' },
		signing: {
			mode: 'not-applicable', identitySha256: null,
			verificationStatus: 'not-applicable',
		},
	};
	const release = await verifyOsAudioCodecNativeBuildResult({
		build, target, sourceRevision, buildPlanSha256,
	});
	return { root, release };
}

function packagingContext(appOutDir, resourcesRoot, target) {
	const [platform, architecture] = target.split('-');
	return {
		electronPlatformName: { linux: 'linux', mac: 'darwin', win: 'win32' }[platform],
		arch: { x64: 1, arm64: 3 }[architecture],
		appOutDir,
		packager: {
			executableName: 'soundscaper',
			appInfo: { productFilename: 'Soundscaper' },
			getResourcesDir: () => resourcesRoot,
		},
	};
}

function stageValue(productId, target, osAudioCodecNative) {
	const [platform, arch] = target.split('-');
	return { schemaVersion: 1, productId, target: { platform, arch }, osAudioCodecNative };
}

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

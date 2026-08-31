/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME,
	OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME,
	OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX,
	OS_AUDIO_CODEC_NATIVE_TARGETS,
	osAudioCodecNativePayloadOutputRoot,
	osAudioCodecNativePayloadStageSummary,
	stageVerifiedOsAudioCodecNativePayload,
	verifyOsAudioCodecNativeBuildResult,
	verifyStagedOsAudioCodecNativePayload,
} from '../scripts/lib/os-audio-codec-native-payload.mjs';
import {
	createOsAudioCodecNativeVerifier,
	describeOsAudioCodecNativePayload,
	osAudioCodecNativeTargetFor,
} from '../desktop/os-audio-codec-native-payload.mjs';

const TARGET = 'win-x64';
const SOURCE_REVISION = '3'.repeat(64);
const BUILD_PLAN_SHA256 = '4'.repeat(64);

test('the codec-only payload target vocabulary excludes mac x64 and every Linux target', () => {
	assert.deepEqual(OS_AUDIO_CODEC_NATIVE_TARGETS, ['mac-arm64', 'win-x64', 'win-arm64']);
	assert.equal(osAudioCodecNativeTargetFor('darwin', 'arm64'), 'mac-arm64');
	assert.equal(osAudioCodecNativeTargetFor('win32', 'x64'), 'win-x64');
	assert.equal(osAudioCodecNativeTargetFor('win32', 'arm64'), 'win-arm64');
	assert.equal(osAudioCodecNativeTargetFor('darwin', 'x64'), null);
	assert.equal(osAudioCodecNativeTargetFor('linux', 'x64'), null);
	assert.equal(osAudioCodecNativeTargetFor('linux', 'arm64'), null);
});

test('an authenticated target-native build stages one canonical manifest and one addon', async (context) => {
	const fixture = await buildFixture(context);
	const release = await verifiedRelease(fixture);
	const runtimeRoot = join(fixture.root, 'runtime');
	const outputRoot = osAudioCodecNativePayloadOutputRoot(runtimeRoot, release);
	const summary = await stageVerifiedOsAudioCodecNativePayload({ release, outputRoot });
	assert.deepEqual((await readdir(outputRoot)).sort(), [
		OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME,
		OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME,
	]);
	assert.deepEqual(Object.keys(summary).sort(), [
		'buildPlanSha256', 'nativeCanary', 'payload', 'payloadManifest', 'signing',
		'sourceRevision', 'status', 'target',
	]);
	assert.equal(summary.target, TARGET);
	assert.equal(summary.status, 'built');
	assert.equal(summary.payload.sha256, fixture.build.artifact.sha256);
	assert.equal(summary.sourceRevision, SOURCE_REVISION);
	assert.equal(summary.buildPlanSha256, BUILD_PLAN_SHA256);
	assert.equal(summary.nativeCanary, 'passed');
	assert.deepEqual(summary.signing, fixture.build.signing);
	assert.deepEqual(
		await verifyStagedOsAudioCodecNativePayload({ release, outputRoot }),
		osAudioCodecNativePayloadStageSummary(release),
	);
	const manifestBytes = await readFile(join(outputRoot, OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME));
	assert.equal(hash(manifestBytes), summary.payloadManifest.sha256);
	assert.equal(manifestBytes.at(-1), 0x0a);
});

test('runtime resolution reopens the staged regular files and returns only spawn authority', async (context) => {
	const fixture = await stagedFixture(context);
	const location = Object.freeze({
		runtimeRoot: fixture.runtimeRoot, platform: 'win32', arch: 'x64',
	});
	const available = await describeOsAudioCodecNativePayload(location);
	assert.equal(available.status, 'available');
	assert.deepEqual(Object.keys(available.descriptor).sort(), ['path', 'sha256', 'target']);
	assert.equal(available.descriptor.target, TARGET);
	assert.equal(available.descriptor.sha256, fixture.build.artifact.sha256);
	assert.equal(available.descriptor.path, join(
		fixture.runtimeRoot, OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX, TARGET,
		OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME,
	));
	const verify = createOsAudioCodecNativeVerifier(location);
	assert.deepEqual(await verify(), available.descriptor);
});

test('build verification binds target, source, plan, toolchain, headers, canary, and final bytes', async (context) => {
	const fixture = await buildFixture(context);
	const cases = [
		['foreign requested target', fixture.build, { target: 'win-arm64' }, /does not match the requested target/iu],
		['source revision', fixture.build, { sourceRevision: '5'.repeat(64) }, /source revision/iu],
		['build plan', fixture.build, { buildPlanSha256: '6'.repeat(64) }, /build plan/iu],
		['build-result plan alias', mutate(fixture.build, (build) => { build.buildPlanSha256 = '6'.repeat(64); }), {}, /build plan/iu],
		['header archive', mutate(fixture.build, (build) => { build.electronHeaders.archive.sha256 = '7'.repeat(64); }), {}, /Electron.*headers/iu],
		['source identity', mutate(fixture.build, (build) => { build.sourceIdentity.algorithm = 'other'; }), {}, /source identity/iu],
		['toolchain identity', mutate(fixture.build, (build) => { delete build.toolchainIdentity.generator; }), {}, /toolchain identity/iu],
		['native canary', mutate(fixture.build, (build) => { build.nativeCanary.status = 'failed'; }), {}, /native canary/iu],
		['signing evidence', mutate(fixture.build, (build) => { build.signing.mode = 'ad-hoc'; }), {}, /signing/iu],
		['exact schema', mutate(fixture.build, (build) => { build.extra = true; }), {}, /build result.*shape/iu],
	];
	for (const [label, build, overrides, pattern] of cases) {
		await assert.rejects(() => verifyOsAudioCodecNativeBuildResult({
			build, target: TARGET, sourceRevision: SOURCE_REVISION,
			buildPlanSha256: BUILD_PLAN_SHA256, ...overrides,
		}), pattern, label);
	}
	const changed = Buffer.from(await readFile(fixture.build.artifact.path));
	changed[0] ^= 0xff;
	await writeFile(fixture.build.artifact.path, changed);
	await assert.rejects(() => verifiedRelease(fixture), /payload.*digest/iu);
});

test('macOS payload authority requires verified ad-hoc sealing evidence', async (context) => {
	const fixture = await buildFixture(context);
	fixture.build.target = 'mac-arm64';
	fixture.build.toolchainIdentity = {
		cmake: 'cmake version 4.4.0', generator: 'Ninja', cxxCompilerId: 'AppleClang',
		cxxCompilerVersion: '17.0.0', systemName: 'Darwin', systemProcessor: 'arm64',
	};
	fixture.build.signing = {
		mode: 'ad-hoc', identitySha256: '5'.repeat(64), verificationStatus: 'passed',
	};
	const release = await verifyOsAudioCodecNativeBuildResult({
		build: fixture.build, target: 'mac-arm64', sourceRevision: SOURCE_REVISION,
		buildPlanSha256: BUILD_PLAN_SHA256,
	});
	assert.deepEqual(osAudioCodecNativePayloadStageSummary(release).signing,
		fixture.build.signing);
	const unverified = mutate(fixture.build, (build) => {
		build.signing.verificationStatus = 'not-applicable';
	});
	await assert.rejects(() => verifyOsAudioCodecNativeBuildResult({
		build: unverified, target: 'mac-arm64', sourceRevision: SOURCE_REVISION,
		buildPlanSha256: BUILD_PLAN_SHA256,
	}), /signing/iu);
});

test('build verification refuses symlink payloads and unsupported target IDs', async (context) => {
	const fixture = await buildFixture(context);
	const realPath = join(fixture.root, 'real.node');
	await writeFile(realPath, await readFile(fixture.build.artifact.path));
	await unlink(fixture.build.artifact.path);
	await symlink(realPath, fixture.build.artifact.path);
	await assert.rejects(() => verifiedRelease(fixture), /canonical regular file/iu);
	const foreign = mutate(fixture.build, (build) => { build.target = 'mac-x64'; });
	await assert.rejects(() => verifyOsAudioCodecNativeBuildResult({
		build: foreign, target: 'mac-x64', sourceRevision: SOURCE_REVISION,
		buildPlanSha256: BUILD_PLAN_SHA256,
	}), /unsupported.*target/iu);
});

test('staged payload, manifest, inventory, and symlink tampering fail closed', async (context) => {
	for (const kind of ['payload', 'manifest', 'inventory', 'symlink']) {
		const fixture = await stagedFixture(context);
		const outputRoot = fixture.outputRoot;
		if (kind === 'payload') {
			const path = join(outputRoot, OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME);
			await chmod(path, 0o644);
			await writeFile(path, 'tampered');
		}
		if (kind === 'manifest') {
			const path = join(outputRoot, OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME);
			await chmod(path, 0o644);
			await writeFile(path, '{}\n');
		}
		if (kind === 'inventory') await writeFile(join(outputRoot, 'foreign.node'), 'foreign');
		if (kind === 'symlink') {
			const payloadPath = join(outputRoot, OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME);
			const realPath = join(fixture.root, `moved-${OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME}`);
			await writeFile(realPath, await readFile(payloadPath));
			await unlink(payloadPath);
			await symlink(realPath, payloadPath);
		}
		await assert.rejects(
			() => verifyStagedOsAudioCodecNativePayload({ release: fixture.release, outputRoot }),
			/inventory|manifest|payload|canonical regular file/iu,
			kind,
		);
	}
});

test('runtime selection rejects unsupported platforms, foreign manifests, and noncanonical manifests', async (context) => {
	const fixture = await stagedFixture(context);
	for (const [platform, arch] of [['darwin', 'x64'], ['linux', 'x64'], ['linux', 'arm64']]) {
		const unavailable = await describeOsAudioCodecNativePayload({
			runtimeRoot: fixture.runtimeRoot, platform, arch,
		});
		assert.equal(unavailable.status, 'unavailable');
		assert.equal(unavailable.reason, 'unsupported-platform');
	}
	const manifestPath = join(fixture.outputRoot, OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME);
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	manifest.target = 'win-arm64';
	await chmod(manifestPath, 0o644);
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	const foreign = await describeOsAudioCodecNativePayload({
		runtimeRoot: fixture.runtimeRoot, platform: 'win32', arch: 'x64',
	});
	assert.equal(foreign.status, 'unavailable');
	assert.equal(foreign.reason, 'manifest-unreadable');
	assert.match(foreign.detail, /target/iu);

	const second = await stagedFixture(context);
	const secondManifestPath = join(second.outputRoot, OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME);
	await chmod(secondManifestPath, 0o644);
	await writeFile(secondManifestPath, JSON.stringify(JSON.parse(await readFile(secondManifestPath, 'utf8'))));
	const noncanonical = await describeOsAudioCodecNativePayload({
		runtimeRoot: second.runtimeRoot, platform: 'win32', arch: 'x64',
	});
	assert.equal(noncanonical.status, 'unavailable');
	assert.equal(noncanonical.reason, 'manifest-unreadable');
	assert.match(noncanonical.detail, /canonical/iu);
});

test('runtime selection refuses a symlink or altered payload before returning spawn authority', async (context) => {
	const altered = await stagedFixture(context);
	const alteredPath = join(altered.outputRoot, OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME);
	await chmod(alteredPath, 0o644);
	await writeFile(alteredPath, 'altered');
	const mismatch = await describeOsAudioCodecNativePayload({
		runtimeRoot: altered.runtimeRoot, platform: 'win32', arch: 'x64',
	});
	assert.equal(mismatch.status, 'unavailable');
	assert.equal(mismatch.reason, 'payload-digest-mismatch');

	const linked = await stagedFixture(context);
	const payloadPath = join(linked.outputRoot, OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME);
	const realPath = join(linked.root, 'linked-payload.node');
	await writeFile(realPath, await readFile(payloadPath));
	await unlink(payloadPath);
	await symlink(realPath, payloadPath);
	const symlinked = await describeOsAudioCodecNativePayload({
		runtimeRoot: linked.runtimeRoot, platform: 'win32', arch: 'x64',
	});
	assert.equal(symlinked.status, 'unavailable');
	assert.equal(symlinked.reason, 'payload-digest-mismatch');
});

test('only a branded release can be summarized or staged', async (context) => {
	const fixture = await buildFixture(context);
	const release = await verifiedRelease(fixture);
	const forged = { ...release };
	assert.throws(() => osAudioCodecNativePayloadStageSummary(forged), /verified OS audio codec native release/iu);
	await assert.rejects(() => stageVerifiedOsAudioCodecNativePayload({
		release: forged, outputRoot: join(fixture.root, 'never-created'),
	}), /verified OS audio codec native release/iu);
});

async function buildFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-os-codec-payload-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const artifactPath = join(root, 'build', OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME);
	const bytes = Buffer.from('fixture target-native OS audio codec addon');
	await mkdir(dirname(artifactPath), { recursive: true });
	await writeFile(artifactPath, bytes);
	const build = {
		schemaVersion: 1,
		status: 'built',
		target: TARGET,
		artifact: { path: artifactPath, byteLength: bytes.byteLength, sha256: hash(bytes) },
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
			fileCount: 8,
			sha256: SOURCE_REVISION,
		},
		sourceRevision: SOURCE_REVISION,
		buildPlan: {
			algorithm: 'soundscaper-os-audio-codec-build-plan-sha256-v1',
			sha256: BUILD_PLAN_SHA256,
		},
		buildPlanSha256: BUILD_PLAN_SHA256,
		toolchainIdentity: {
			cmake: 'cmake version 4.4.0',
			generator: 'Visual Studio 17 2022',
			cxxCompilerId: 'MSVC',
			cxxCompilerVersion: '19.44.35222.0',
			systemName: 'Windows',
			systemProcessor: 'AMD64',
		},
		nativeCanary: { status: 'passed', testCommand: 'ctest' },
		signing: {
			mode: 'not-applicable', identitySha256: null,
			verificationStatus: 'not-applicable',
		},
	};
	return { root, build, bytes };
}

async function verifiedRelease(fixture) {
	return verifyOsAudioCodecNativeBuildResult({
		build: fixture.build,
		target: TARGET,
		sourceRevision: SOURCE_REVISION,
		buildPlanSha256: BUILD_PLAN_SHA256,
	});
}

async function stagedFixture(context) {
	const fixture = await buildFixture(context);
	const release = await verifiedRelease(fixture);
	const runtimeRoot = join(fixture.root, 'runtime');
	const outputRoot = osAudioCodecNativePayloadOutputRoot(runtimeRoot, release);
	await stageVerifiedOsAudioCodecNativePayload({ release, outputRoot });
	return { ...fixture, release, runtimeRoot, outputRoot };
}

function mutate(value, operation) {
	const copy = structuredClone(value);
	operation(copy);
	return copy;
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

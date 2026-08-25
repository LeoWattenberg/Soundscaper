/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	prepareDesktopOsAudioCodecNativeRelease,
	resolveDesktopOsAudioCodecNativeRequirement,
	stageDesktopOsAudioCodecNativeRelease,
} from '../scripts/lib/desktop-os-audio-codec-native-staging.mjs';
import {
	OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME,
	OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME,
	OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX,
} from '../scripts/lib/os-audio-codec-native-payload.mjs';

test('a target-native build result is authenticated before the desktop build tree is staged', async (context) => {
	const fixture = await buildFixture(context, 'win-arm64');
	const release = await prepareDesktopOsAudioCodecNativeRelease({
		buildResultPath: fixture.resultPath, target: 'win-arm64', required: true,
	});
	assert.ok(release);
	const runtimeRoot = join(fixture.root, 'runtime');
	const summary = await stageDesktopOsAudioCodecNativeRelease({ release, runtimeRoot });
	assert.equal(summary.target, 'win-arm64');
	assert.equal(summary.status, 'built');
	assert.equal(summary.payload.sha256, fixture.build.artifact.sha256);
	const targetRoot = join(runtimeRoot, OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX, 'win-arm64');
	assert.deepEqual(
		(await Promise.all([
			readFile(join(targetRoot, OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME)),
			readFile(join(targetRoot, OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME)),
		])).map((bytes) => bytes.byteLength > 0),
		[true, true],
	);
});

test('optional local builds stay absent while release packaging can require the OS tier', async () => {
	assert.equal(await prepareDesktopOsAudioCodecNativeRelease({
		buildResultPath: null, target: 'win-x64', required: false,
	}), null);
	await assert.rejects(() => prepareDesktopOsAudioCodecNativeRelease({
		buildResultPath: null, target: 'mac-arm64', required: true,
	}), /requires a target-built OS audio codec payload/iu);
	for (const target of ['linux-x64', 'linux-arm64']) {
		assert.equal(await prepareDesktopOsAudioCodecNativeRelease({
			buildResultPath: null, target, required: false,
		}), null);
	}
});

test('Linux rejects a supplied OS payload and supported targets reject foreign results', async (context) => {
	const fixture = await buildFixture(context, 'win-x64');
	await assert.rejects(() => prepareDesktopOsAudioCodecNativeRelease({
		buildResultPath: fixture.resultPath, target: 'linux-x64', required: false,
	}), /Linux.*cannot stage/iu);
	await assert.rejects(() => prepareDesktopOsAudioCodecNativeRelease({
		buildResultPath: fixture.resultPath, target: 'win-arm64', required: true,
	}), /does not match the requested target/iu);
});

test('result-file symlinks, malformed JSON, and unknown requirement values fail closed', async (context) => {
	const fixture = await buildFixture(context, 'win-x64');
	const linked = join(fixture.root, 'linked-result.json');
	await symlink(fixture.resultPath, linked);
	await assert.rejects(() => prepareDesktopOsAudioCodecNativeRelease({
		buildResultPath: linked, target: 'win-x64', required: true,
	}), /canonical regular file/iu);
	const malformed = join(fixture.root, 'malformed.json');
	await writeFile(malformed, '{\n');
	await assert.rejects(() => prepareDesktopOsAudioCodecNativeRelease({
		buildResultPath: malformed, target: 'win-x64', required: true,
	}), /valid JSON/iu);
	await assert.rejects(() => prepareDesktopOsAudioCodecNativeRelease({
		buildResultPath: null, target: 'win-x64', required: 'true',
	}), /required flag/iu);
});

test('the release requirement environment has one closed boolean grammar', () => {
	for (const value of [undefined, null, '', 'false']) {
		assert.equal(resolveDesktopOsAudioCodecNativeRequirement(value), false);
	}
	assert.equal(resolveDesktopOsAudioCodecNativeRequirement('true'), true);
	for (const value of ['TRUE', '0', 'yes', ' true ', 1]) {
		assert.throws(() => resolveDesktopOsAudioCodecNativeRequirement(value), /requirement.*invalid/iu);
	}
});

test('desktop preparation verifies before replacement, stages after it, and records the exact summary', async () => {
	const source = await readFile(new URL('../scripts/desktop-prepare.mjs', import.meta.url), 'utf8');
	const verifyIndex = source.indexOf('prepareDesktopOsAudioCodecNativeRelease({');
	const removeIndex = source.indexOf('await rm(BUILD_ROOT');
	const stageIndex = source.indexOf('stageDesktopOsAudioCodecNativeRelease({');
	assert.ok(verifyIndex >= 0 && verifyIndex < removeIndex,
		'the target-built release must be authenticated before replacing reusable output');
	assert.ok(stageIndex > removeIndex,
		'the authenticated release must be staged into the new runtime tree');
	assert.match(source, /PRODUCT_ID === 'soundscaper'.*prepareDesktopOsAudioCodecNativeRelease/su,
		'only Soundscaper may stage the codec-only native payload');
	assert.match(source, /osAudioCodecNative,.*soundscaperProfessionalNative/su,
		'the stage manifest must bind the exact codec-only payload summary');
});

async function buildFixture(context, target) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-desktop-os-codec-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const artifactPath = join(root, 'build', OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME);
	const artifact = Buffer.from(`native-${target}`);
	await mkdir(dirname(artifactPath), { recursive: true });
	await writeFile(artifactPath, artifact);
	const sourceRevision = '3'.repeat(64);
	const buildPlanSha256 = '4'.repeat(64);
	const arm = target.endsWith('arm64');
	const build = {
		schemaVersion: 1,
		status: 'built',
		target,
		artifact: { path: artifactPath, byteLength: artifact.byteLength, sha256: digest(artifact) },
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
			cmake: '3.31.6',
			generator: target.startsWith('mac-') ? 'Ninja' : 'Visual Studio 17 2022',
			cxxCompilerId: target.startsWith('mac-') ? 'AppleClang' : 'MSVC',
			cxxCompilerVersion: target.startsWith('mac-') ? '16.0.0' : '19.44.35207.1',
			systemName: target.startsWith('mac-') ? 'Darwin' : 'Windows',
			systemProcessor: arm ? 'ARM64' : 'AMD64',
		},
		nativeCanary: { status: 'passed', testCommand: 'ctest' },
		signing: {
			mode: 'not-applicable', identitySha256: null,
			verificationStatus: 'not-applicable',
		},
	};
	const resultPath = join(root, 'build-result.json');
	await writeFile(resultPath, `${JSON.stringify(build, null, 2)}\n`);
	return { root, resultPath, build };
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

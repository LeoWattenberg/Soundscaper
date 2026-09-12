/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import baseManifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import recipe from '../config/assistance-sherpa-win-arm64-build.json' with { type: 'json' };
import { assistanceNativeRuntimeStageSummary } from '../desktop/assistance-native-runtime-payload.mjs';
import {
	assertArm64PortableExecutable,
	desktopSherpaArm64NativeArchiveInvocation,
	desktopSherpaArm64BuildPlan,
	prepareDesktopAssistanceSherpaArm64,
	validateDesktopAssistanceSherpaArm64BuildReceipt,
} from '../scripts/lib/desktop-assistance-sherpa-arm64.mjs';
import { desktopAssistanceNativeManifest } from '../scripts/lib/desktop-assistance-speech-runtime.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const runFile = promisify(execFile);

test('a Windows-style checkout preserves the authenticated Sherpa CMake recipe bytes', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'sherpa-windows-checkout-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = 'native/assistance-sherpa-node-api/CMakeLists.txt';
	await mkdir(dirname(join(root, path)), { recursive: true });
	await copyFile(new URL(`../${path}`, import.meta.url), join(root, path));
	await copyFile(new URL('../.gitattributes', import.meta.url), join(root, '.gitattributes'));
	const git = async (args) => runFile('git', [
		'-c', 'core.autocrlf=true', '-c', 'core.eol=crlf', '-c', 'core.attributesFile=', ...args,
	], { cwd: root, windowsHide: true });
	await git(['init', '--quiet']);
	await git(['add', '--', '.gitattributes', path]);
	await rm(join(root, path));
	await git(['checkout-index', '--force', '--', path]);
	assert.equal(hash(await readFile(join(root, path))), recipe.cmakeSha256,
		'Windows checkout must preserve the reviewed bytes, without normalizing or replacing the source digest');
});

function receipt() {
	const provenance = {
		schemaVersion: 1, recipeId: recipe.recipeId, targetId: 'win-arm64',
		sourceRevision: recipe.sourceRevision, nodeHeadersVersion: recipe.nodeHeadersVersion,
		nodeAddonApiVersion: recipe.nodeAddonApiVersion, cmakeVersion: 'cmake version 3.31.1',
		compiler: { id: 'MSVC', version: '19.43' }, cmakeSha256: recipe.cmakeSha256,
		configureArgs: desktopSherpaArm64BuildPlan({ targetId: 'win-arm64', platform: 'win32' }).configureArgs,
		sources: recipe.sources.map(({ id, url, sha256, byteLength }) => ({ id, url, sha256, byteLength })),
	};
	const files = Object.fromEntries([
		'onnxruntime.dll', 'onnxruntime_providers_shared.dll', 'sherpa-onnx-c-api.dll',
		'sherpa-onnx-cxx-api.dll', 'sherpa-onnx.node', 'SHERPA-LICENSE', 'NODE-ADDON-API-LICENSE',
		'NODE-GYP-LICENSE', 'NODE-LICENSE', 'build-provenance.json',
	].map((path) => {
		const bytes = Buffer.from(path === 'build-provenance.json' ? `${JSON.stringify(provenance, null, '\t')}\n` : 'fixture');
		return [path, { byteLength: bytes.byteLength, sha256: hash(bytes) }];
	}));
	const source = recipe.sources.find(({ id }) => id === 'sherpa-source');
	const native = recipe.sources.find(({ id }) => id === 'sherpa-native');
	const manifest = structuredClone(baseManifest);
	manifest.targets['win-arm64'] = { status: 'built', package: {
		name: 'sherpa-onnx-win-arm64', version: recipe.version, sourceUrl: source.url, integrity: source.integrity,
		sourceBuild: {
			recipeId: recipe.recipeId, sourceRevision: recipe.sourceRevision,
			sourceSha256: source.sha256, nativeAssetSha256: native.sha256,
		}, files,
	} };
	return { schemaVersion: 1, targetId: 'win-arm64', manifest, provenance };
}

test('Sherpa ARM64 build explicitly targets ARM64 from a Windows host', async () => {
	const plan = desktopSherpaArm64BuildPlan({ targetId: 'win-arm64', platform: 'win32' });
	assert.deepEqual(plan.configureArgs.slice(0, 2), ['-A', 'ARM64']);
	assert.ok(plan.buildArgs.includes('sherpa-onnx'));
	assert.throws(() => desktopSherpaArm64BuildPlan({ targetId: 'win-x64', platform: 'win32' }), /win-arm64/u);
	await assert.rejects(prepareDesktopAssistanceSherpaArm64({ targetId: 'win-arm64', platform: 'linux' }), /Windows package runner/u);
});

test('Sherpa ARM64 native extraction uses a relative archive name accepted by BSD and GNU tar', () => {
	assert.deepEqual(
		desktopSherpaArm64NativeArchiveInvocation(
			String.raw`C:\a\_temp\sherpa-native.tar.bz2`,
			String.raw`C:\a\_temp\native`,
		),
		{
			cwd: String.raw`C:\a\_temp`,
			args: [
				'-xf', 'sherpa-native.tar.bz2',
				'-C', String.raw`C:\a\_temp\native`, '--strip-components=1',
			],
		},
	);
});

test('Sherpa ARM64 build receipt preserves every existing package and binds exact source and recipe pins', async () => {
	const value = receipt();
	assert.equal(validateDesktopAssistanceSherpaArm64BuildReceipt(value), value);
	assert.equal(assistanceNativeRuntimeStageSummary(value.manifest, 'win-arm64').status, 'built');
	assert.deepEqual(value.manifest.commonPackage, baseManifest.commonPackage);
	assert.equal(desktopAssistanceNativeManifest({ assistanceNativeBuild: value }, 'win-arm64'), value.manifest);
	assert.equal(desktopAssistanceNativeManifest({ assistanceNativeBuild: null }, 'linux-x64'), baseManifest);
	assert.throws(() => desktopAssistanceNativeManifest({ assistanceNativeBuild: value }, 'linux-x64'), /another target/u);
	assert.equal(hash(await readFile(new URL('../native/assistance-sherpa-node-api/CMakeLists.txt', import.meta.url))), recipe.cmakeSha256);
	for (const mutate of [
		(candidate) => { candidate.manifest.commonPackage.files['addon.js'].sha256 = 'a'.repeat(64); },
		(candidate) => { candidate.manifest.targets['linux-x64'].package.version = 'changed'; },
		(candidate) => { candidate.manifest.targets['win-arm64'].package.sourceBuild.sourceSha256 = 'b'.repeat(64); },
		(candidate) => { candidate.provenance.sources[0].sha256 = 'c'.repeat(64); },
		(candidate) => { candidate.provenance.cmakeSha256 = 'd'.repeat(64); },
		(candidate) => { candidate.manifest.targets['win-arm64'].package.files['build-provenance.json'].sha256 = 'e'.repeat(64); },
	]) {
		const altered = structuredClone(value); mutate(altered);
		assert.throws(() => validateDesktopAssistanceSherpaArm64BuildReceipt(altered), /Sherpa/u);
	}
});

test('runtime manifest accepts only the exact source-built ARM64 package provenance', () => {
	const value = receipt();
	for (const property of ['sourceRevision', 'sourceSha256', 'nativeAssetSha256']) {
		const altered = structuredClone(value.manifest);
		altered.targets['win-arm64'].package.sourceBuild[property] = '0'.repeat(64);
		assert.throws(() => assistanceNativeRuntimeStageSummary(altered, 'win-arm64'), /descriptor is invalid/u);
	}
	const altered = structuredClone(value.manifest);
	altered.targets['win-arm64'].package.sourceUrl = 'https://example.invalid/claimed-build';
	assert.throws(() => assistanceNativeRuntimeStageSummary(altered, 'win-arm64'), /descriptor is invalid/u);
});

test('Sherpa build rejects a native library compiled for the host instead of ARM64', () => {
	const bytes = new Uint8Array(128), view = new DataView(bytes.buffer);
	view.setUint16(0, 0x5a4d, true); view.setUint32(0x3c, 64, true);
	view.setUint32(64, 0x00004550, true); view.setUint16(68, 0xaa64, true);
	assert.doesNotThrow(() => assertArm64PortableExecutable(bytes));
	view.setUint16(68, 0x8664, true);
	assert.throws(() => assertArm64PortableExecutable(bytes), /not a Windows ARM64/u);
	assert.throws(() => assertArm64PortableExecutable(bytes.subarray(0, 10)), /truncated/u);
});

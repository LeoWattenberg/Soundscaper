/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
	desktopSherpaGpuBuildPlan, desktopSherpaGpuRecipeSourceBuild,
	validateSherpaGpuSourceEntry, verifySherpaGpuSource,
} from '../scripts/lib/desktop-assistance-sherpa-gpu-runtime.mjs';

test('every maintained Sherpa target has a GPU-capable build with an independent CPU option', () => {
	for (const [targetId, platform, architecture] of [
		['mac-arm64', 'darwin', 'arm64'], ['linux-x64', 'linux', 'x64'],
		['linux-arm64', 'linux', 'arm64'], ['win-x64', 'win32', 'x64'],
		['win-arm64', 'win32', 'x64'],
	] as const) {
		const plan = desktopSherpaGpuBuildPlan({ targetId, platform, architecture });
		assert.deepEqual(plan.executionProviders, targetId === 'mac-arm64'
			? ['coreml', 'webgpu', 'cpu'] : ['webgpu', 'cpu']);
		assert.ok(plan.configureArgs.includes('-DFETCHCONTENT_FULLY_DISCONNECTED=ON'));
		assert.ok(plan.configureArgs.includes('-DSHERPA_ONNX_ENABLE_SPEAKER_DIARIZATION=ON'));
		assert.ok(plan.configureArgs.includes('-DSHERPA_ONNX_ENABLE_TTS=OFF'));
		assert.ok(plan.configureArgs.includes('-DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF'));
	}
	assert.deepEqual(desktopSherpaGpuBuildPlan({ targetId: 'win-arm64', platform: 'win32', architecture: 'x64' }).generatorArgs, ['-A', 'ARM64']);
});

test('Sherpa builds reject unsupported and foreign native Linux targets', () => {
	for (const [targetId, platform, architecture] of [
		['linux-arm64', 'linux', 'x64'], ['win-x64', 'linux', 'x64'],
		['mac-x64', 'darwin', 'x64'],
	] as const) assert.throws(() => desktopSherpaGpuBuildPlan({ targetId, platform, architecture }), /target|native/iu);
});

test('Sherpa GPU sources reject altered bytes and unsafe archive entries', () => {
	const pin = { id: 'fixture', byteLength: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
	assert.equal(verifySherpaGpuSource(Buffer.from('abc'), pin).toString(), 'abc');
	assert.throws(() => verifySherpaGpuSource(Buffer.from('abd'), pin), /digest/iu);
	assert.throws(() => verifySherpaGpuSource(Buffer.from('abcd'), pin), /length/iu);
	for (const [path, type] of [
		['src/../outside', 'File'], ['/src/a', 'File'], ['src\\a', 'File'],
		['src/a', 'SymbolicLink'], ['src/a', 'Link'], ['src/a', 'FIFO'],
	]) assert.throws(() => validateSherpaGpuSourceEntry({ path, type }), /entry/iu);
	assert.doesNotThrow(() => validateSherpaGpuSourceEntry({ path: 'src/a.cc', type: 'File' }));
});

test('Sherpa source-build identity binds the canonical pinned recipe and native recipe bytes', async () => {
	const recipe = JSON.parse(await readFile(new URL('../config/assistance-sherpa-gpu-build.json', import.meta.url), 'utf8')) as {
		recipeId: string; sources: { id: string; byteLength: number; sha256: string }[];
	};
	const sourceBuild = desktopSherpaGpuRecipeSourceBuild();
	assert.equal(sourceBuild.recipeId, recipe.recipeId);
	assert.match(sourceBuild.recipeSha256, /^[a-f0-9]{64}$/u);
	assert.deepEqual(recipe.sources.map(({ id }) => id), [
		'sherpa-source', 'kaldi-native-fbank', 'kaldi-decoder', 'kaldifst', 'openfst',
		'kissfft', 'eigen', 'simple-sentencepiece', 'json', 'hclust-cpp',
		'node-addon-api', 'node-headers', 'node-arm64-lib', 'node-x64-lib',
		'node-delay-hook', 'node-gyp-license', 'node-license',
	]);
	for (const source of recipe.sources) {
		assert.match(source.sha256, /^[a-f0-9]{64}$/u);
		assert.ok(source.byteLength > 0);
	}
});

test('Sherpa receipts require exact GPU runtime libraries, source proof, and per-target providers', async () => {
	const { createDesktopAssistanceOnnxNativeClosureManifest } = await import('../scripts/lib/desktop-assistance-onnx-native-closure.mjs');
	const { validateDesktopAssistanceSherpaGpuBuildReceipt } = await import('../scripts/lib/desktop-assistance-sherpa-gpu-runtime.mjs');
	const { createHash } = await import('node:crypto');
	const fingerprint = (bytes: Uint8Array) => ({ byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
	const recipe = JSON.parse(await readFile(new URL('../config/assistance-sherpa-gpu-build.json', import.meta.url), 'utf8')) as {
		recipeId: string; sourceRevision: string; nodeHeadersVersion: string; nodeAddonApiVersion: string;
		nativeRecipeFiles: Record<string, string>;
		sources: { id: string; url: string; byteLength: number; sha256: string; integrity?: string }[];
	};
	const native = JSON.parse(await readFile(new URL('../config/assistance-native-runtime-manifest.json', import.meta.url), 'utf8')) as {
		targets: Record<string, unknown>;
	};
	for (const targetId of ['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64']) {
		const closure = createDesktopAssistanceOnnxNativeClosureManifest(targetId);
		const platform = targetId.startsWith('mac-') ? 'darwin' : targetId.startsWith('win-') ? 'win32' : 'linux';
		const architecture = targetId.endsWith('arm64') ? 'arm64' : 'x64';
		const plan = desktopSherpaGpuBuildPlan({ targetId, platform, architecture });
		const provenance = {
			schemaVersion: 1, recipeId: recipe.recipeId, targetId, sourceRevision: recipe.sourceRevision,
			nodeHeadersVersion: recipe.nodeHeadersVersion, nodeAddonApiVersion: recipe.nodeAddonApiVersion,
			sourceDateEpoch: 1786406400, cmakeVersion: 'cmake version 4.2.3', compiler: { id: 'Clang', version: '22.1.0' },
			recipeSourceBuild: desktopSherpaGpuRecipeSourceBuild(), configureArgs: plan.configureArgs, buildArgs: plan.buildArgs,
			nativeRecipeFiles: recipe.nativeRecipeFiles,
			sources: recipe.sources.map(({ id, url, sha256, byteLength }) => ({ id, url, sha256, byteLength })),
			onnxRuntime: closure,
		};
		const extension = targetId.startsWith('mac-') ? 'dylib' : targetId.startsWith('win-') ? 'dll' : 'so';
		const prefix = targetId.startsWith('win-') ? '' : 'lib';
		const files: Record<string, { byteLength: number; sha256: string }> = {};
		for (const { path, byteLength, sha256 } of closure.files) files[path] = { byteLength, sha256 };
		for (const path of [`${prefix}sherpa-onnx-c-api.${extension}`, `${prefix}sherpa-onnx-cxx-api.${extension}`,
			'sherpa-onnx.node', 'SHERPA_NOTICES.txt', `onnx-webgpu-device-probe${targetId.startsWith('win-') ? '.exe' : ''}`]) files[path] = fingerprint(Buffer.from('fixture'));
		files['build-provenance.json'] = fingerprint(Buffer.from(`${JSON.stringify(provenance, null, '\t')}\n`));
		const manifest = structuredClone(native);
		const target = { status: 'built', executionProviders: plan.executionProviders, package: {
			name: `sherpa-onnx-${targetId === 'mac-arm64' ? 'darwin-arm64' : targetId}`, version: '1.13.5',
			sourceUrl: recipe.sources[0]!.url, integrity: recipe.sources[0]!.integrity,
			sourceBuild: desktopSherpaGpuRecipeSourceBuild(), files,
		} };
		manifest.targets[targetId] = target;
		const receipt = { schemaVersion: 1, targetId, manifest, provenance };
		assert.equal(validateDesktopAssistanceSherpaGpuBuildReceipt(receipt), receipt);
		const mutate = (change: (candidate: typeof receipt) => void): void => {
			const candidate = structuredClone(receipt); change(candidate);
			assert.throws(() => validateDesktopAssistanceSherpaGpuBuildReceipt(candidate), /Sherpa GPU/iu);
		};
		mutate((candidate) => { delete candidate.provenance.onnxRuntime.files[0]; });
		mutate((candidate) => { candidate.provenance.recipeSourceBuild.recipeSha256 = '0'.repeat(64); });
		mutate((candidate) => { candidate.manifest.targets['unrelated'] = {}; });
		const original = target.executionProviders;
		target.executionProviders = ['cpu'];
		assert.throws(() => validateDesktopAssistanceSherpaGpuBuildReceipt(receipt), /providers/iu);
		target.executionProviders = original;
		const plugin = closure.files.find(({ path }: { path: string }) => path.includes('providers_webgpu'))!.path;
		const saved = target.package.files[plugin]!;
		delete target.package.files[plugin];
		assert.throws(() => validateDesktopAssistanceSherpaGpuBuildReceipt(receipt), /package/iu);
		target.package.files[plugin] = { ...saved, sha256: '0'.repeat(64) };
		assert.throws(() => validateDesktopAssistanceSherpaGpuBuildReceipt(receipt), /provider library/iu);
		target.package.files[plugin] = saved;
	}
});

test('Sherpa packaging rejects an executable compiled for another target architecture', async () => {
	const { assertSherpaGpuBinaryArchitecture } = await import('../scripts/lib/desktop-assistance-sherpa-gpu-runtime.mjs');
	const linux = (machine: number): Buffer => {
		const bytes = Buffer.alloc(64); bytes.write('\x7fELF'); bytes[4] = 2; bytes[5] = 1; bytes.writeUInt16LE(machine, 18); return bytes;
	};
	assert.doesNotThrow(() => assertSherpaGpuBinaryArchitecture(linux(62), 'linux-x64'));
	assert.doesNotThrow(() => assertSherpaGpuBinaryArchitecture(linux(183), 'linux-arm64'));
	assert.throws(() => assertSherpaGpuBinaryArchitecture(linux(62), 'linux-arm64'), /architecture/iu);
	const windows = (machine: number): Buffer => {
		const bytes = Buffer.alloc(128); bytes.write('MZ'); bytes.writeUInt32LE(64, 0x3c); bytes.write('PE\0\0', 64); bytes.writeUInt16LE(machine, 68); return bytes;
	};
	assert.doesNotThrow(() => assertSherpaGpuBinaryArchitecture(windows(0x8664), 'win-x64'));
	assert.doesNotThrow(() => assertSherpaGpuBinaryArchitecture(windows(0xaa64), 'win-arm64'));
	assert.throws(() => assertSherpaGpuBinaryArchitecture(windows(0x8664), 'win-arm64'), /architecture/iu);
	const mac = Buffer.alloc(64); mac.writeUInt32LE(0xfeedfacf); mac.writeUInt32LE(0x100000c, 4);
	assert.doesNotThrow(() => assertSherpaGpuBinaryArchitecture(mac, 'mac-arm64'));
	assert.throws(() => assertSherpaGpuBinaryArchitecture(mac, 'linux-arm64'), /architecture/iu);
	assert.throws(() => assertSherpaGpuBinaryArchitecture(Buffer.alloc(3), 'linux-x64'), /architecture/iu);
});


test('Sherpa staging rejects corrupt cached sources before invoking a compiler or downloader', async (context) => {
	const { prepareDesktopAssistanceSherpaGpu } = await import('../scripts/lib/desktop-assistance-sherpa-gpu-runtime.mjs');
	const fixture = await mkdtemp(join(tmpdir(), 'sherpa-gpu-cache-'));
	context.after(() => rm(fixture, { recursive: true, force: true }));
	const recipe = JSON.parse(await readFile(new URL('../config/assistance-sherpa-gpu-build.json', import.meta.url), 'utf8')) as {
		sources: { sha256: string }[];
	};
	await mkdir(join(fixture, 'sherpa-gpu-sources'));
	await writeFile(join(fixture, 'sherpa-gpu-sources', recipe.sources[0]!.sha256), 'corrupt');
	await assert.rejects(prepareDesktopAssistanceSherpaGpu({
		repositoryRoot: fileURLToPath(new URL('../', import.meta.url)), targetId: 'linux-x64', cacheRoot: fixture,
		platform: 'linux', architecture: 'x64', fetchImpl: () => { throw new Error('Download must not run'); },
	}), /cached source length/iu);
});

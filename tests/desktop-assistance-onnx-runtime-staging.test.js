/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { create } from 'tar';

import payloads from '../config/assistance-onnx-runtime-payloads.json' with { type: 'json' };
import {
	createDesktopAssistanceOnnxManifest,
	stageDesktopAssistanceOnnxRuntime,
} from '../scripts/lib/desktop-assistance-onnx-runtime.mjs';
import {
	describeAssistanceRuntimeFamilyAvailability,
	validateAssistanceRuntimeFamilyManifestV1,
} from '../desktop/assistance-runtime-family-manifest.ts';

const TARGETS = ['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64'];
const PREFIX = 'assistance/onnxruntime-node/1.29.0';
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => (
	createHash(algorithm).update(bytes).digest(encoding)
);
const descriptor = (path, bytes) => ({ path, byteLength: bytes.length, sha256: hash(bytes) });

async function fixtureBuildWebGpu({ outputRoot, targetId }) {
	const pluginName = targetId.startsWith('win-') ? 'onnxruntime_providers_webgpu.dll'
		: `libonnxruntime_providers_webgpu.${targetId.startsWith('mac-') ? 'dylib' : 'so'}`;
	const probeName = `onnx-webgpu-device-probe${targetId.startsWith('win-') ? '.exe' : ''}`;
	const contents = {
		'onnxruntime_binding.node': Buffer.from('generated GPU bridge'),
		[pluginName]: Buffer.from('authenticated GPU plugin'),
		[probeName]: Buffer.from('isolated device probe'),
		'ONNX-WebGPU-LICENSE': Buffer.from('MIT'),
		'onnx-webgpu-build-provenance.json': Buffer.from('authenticated build provenance'),
	};
	for (const [path, bytes] of Object.entries(contents)) await writeFile(join(outputRoot, path), bytes);
	return {
		files: Object.entries(contents).map(([path, bytes]) => ({
			...descriptor(path, bytes), ...(path === probeName ? { executable: true } : {}),
		})), provenance: { targetId },
	};
}

async function fixture(t, targetId = 'linux-x64') {
	const root = await mkdtemp(join(tmpdir(), 'onnx-runtime-staging-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const [targetOs, architecture] = targetId.split('-');
	const platform = { mac: 'darwin', linux: 'linux', win: 'win32' }[targetOs];
	const nativePrefix = `bin/napi-v6/${platform}/${architecture}`;
	const coreName = targetOs === 'win' ? 'onnxruntime.dll'
		: targetOs === 'mac' ? 'libonnxruntime.1.29.0.dylib' : 'libonnxruntime.so.1';
	const files = {
		'dist/index.js': Buffer.from('module.exports = { version: "1.29.0" };'),
		[`${nativePrefix}/onnxruntime_binding.node`]: Buffer.from('pinned CPU binding'),
		[`${nativePrefix}/${coreName}`]: Buffer.from('pinned CPU runtime'),
		'script/install.js': Buffer.from('throw new Error("must not execute an install hook");'),
	};
	for (const [path, bytes] of Object.entries(files)) {
		const destination = join(root, 'archive', 'package', path);
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, bytes);
	}
	const archivePath = join(root, 'runtime.tgz');
	await create({ file: archivePath, gzip: true, cwd: join(root, 'archive') }, ['package']);
	const archive = await readFile(archivePath);
	const notice = Buffer.from('MIT License for the exact upstream runtime.');
	const sources = [{
		id: 'onnxruntime-node', kind: 'npm-tarball', url: 'https://example.invalid/runtime.tgz',
		integrity: `sha512-${hash(archive, 'sha512', 'base64')}`,
		byteLength: archive.length, sha256: hash(archive), destination: 'node_modules/onnxruntime-node',
		files: [descriptor('dist/index.js', files['dist/index.js'])],
		targetFiles: { [targetId]: Object.entries(files).filter(([path]) => path.startsWith('bin/'))
			.map(([path, bytes]) => descriptor(path, bytes)) },
	}, {
		id: 'license', kind: 'file', url: 'https://example.invalid/LICENSE',
		byteLength: notice.length, sha256: hash(notice), destination: 'licenses/LICENSE',
	}];
	const downloads = new Map([[sources[0].url, archive], [sources[1].url, notice]]);
	const fetched = [];
	return {
		root, downloads, fetched,
		options: {
			targetId, outputRoot: join(root, 'runtime'), cacheRoot: join(root, 'cache'),
			buildWebGpu: fixtureBuildWebGpu,
			payloads: { ...payloads, sources },
			fetchImpl: async (url) => { fetched.push(url); return new Response(downloads.get(url)); },
		},
	};
}

test('every ONNX target requires a generated WebGPU bridge and retains reviewed portable core and license pins', () => {
	assert.equal(payloads.sources[0].integrity,
		'sha512-WjiVVB72riILz8HbYvxvmjKyE/WmkYoSfKY++axo5jAR609HQg8MwiG/HhShpTcJfmmAdzxxmB+MMST3A+SiPA==');
	for (const targetId of TARGETS) {
		const manifest = validateAssistanceRuntimeFamilyManifestV1(createDesktopAssistanceOnnxManifest(targetId));
		const target = manifest.targets.find(({ id }) => id === targetId);
		assert.equal(target.status, 'package-generated');
		assert.match(target.packageBehavior, /WebGPU.*probe.*Node-API/u);
		const files = payloads.sources.flatMap((source) => source.kind === 'file' ? [{ path: source.destination }]
			: [...source.files, ...(source.targetFiles[targetId] ?? [])]
				.map(({ path }) => ({ path: `${source.destination}/${path}` })));
		assert.ok(files.length >= 32);
		assert.ok(files.some(({ path }) => path.endsWith('/dist/cjs/package.json')));
		assert.ok(files.some(({ path }) => path.endsWith('/onnxruntime_binding.node')));
		assert.ok(files.some(({ path }) => path === 'licenses/ONNXRuntime-LICENSE'));
		assert.ok(files.some(({ path }) => path === 'licenses/ONNXRuntime-ThirdPartyNotices.txt'));
		for (const notice of ['LICENSE', 'ThirdPartyNotices.txt', 'ReleaseNotes.md']) {
			assert.ok(files.some(({ path }) => path === `licenses/DirectXShaderCompiler-${notice}`));
		}
		assert.ok(files.every(({ path }) => !/\/script\/|cuda|DirectML/u.test(path)));
		if (targetId.startsWith('win-')) {
			for (const library of ['dxcompiler.dll', 'dxil.dll']) {
				assert.ok(files.some(({ path }) => path.endsWith(`/${library}`)));
			}
		}
		assert.ok(manifest.targets.filter(({ id }) => id !== targetId)
			.every(({ status }) => status === 'package-generated'));
	}
});

test('each generated target authenticates its GPU bridge, plugin and executable device probe before capability publication', async (t) => {
	for (const targetId of TARGETS) {
		const { options } = await fixture(t, targetId);
		const result = await stageDesktopAssistanceOnnxRuntime(options);
		const manifest = validateAssistanceRuntimeFamilyManifestV1(result.manifest);
		const target = manifest.targets.find(({ id }) => id === targetId);
		assert.equal(target.status, 'authenticated');
		assert.deepEqual(target.executionProviders, targetId === 'mac-arm64' ? ['coreml', 'webgpu', 'cpu'] : ['webgpu', 'cpu']);
		assert.ok(target.files.some(({ path, executable }) => path.endsWith(
			`/onnx-webgpu-device-probe${targetId.startsWith('win-') ? '.exe' : ''}`,
		) && executable));
		assert.ok(target.files.some(({ path }) => path.includes('onnxruntime_providers_webgpu.')));
	}
});

test('Linux ARM64 publishes GPU capability only after its plugin bridge build and verifies every generated file', async (t) => {
	const { options } = await fixture(t, 'linux-arm64');
	const builtFiles = {
		'libonnxruntime_providers_webgpu.so': Buffer.from('authenticated WebGPU plugin'),
		'onnxruntime_binding.node': Buffer.from('rebuilt WebGPU binding'),
		'onnx-webgpu-device-probe': Buffer.from('isolated GPU discovery'),
		'ONNX-WebGPU-LICENSE': Buffer.from('MIT'),
		'onnx-webgpu-build-provenance.json': Buffer.from('authenticated source and build recipe'),
	};
	let builds = 0;
	const buildWebGpu = async ({ outputRoot, targetId }) => {
		builds++;
		assert.equal(targetId, 'linux-arm64');
		for (const [path, bytes] of Object.entries(builtFiles)) await writeFile(join(outputRoot, path), bytes);
		return { files: Object.entries(builtFiles).map(([path, bytes]) => ({
			...descriptor(path, bytes), ...(path === 'onnx-webgpu-device-probe' ? { executable: true } : {}),
		})), provenance: { targetId } };
	};
	const result = await stageDesktopAssistanceOnnxRuntime({ ...options, targetId: 'linux-arm64', buildWebGpu });
	assert.equal(builds, 1);
	const target = result.manifest.targets.find(({ id }) => id === 'linux-arm64');
	assert.deepEqual(target.executionProviders, ['webgpu', 'cpu']);
	assert.ok(target.files.some(({ path }) => path.endsWith('/libonnxruntime_providers_webgpu.so')));
	assert.ok(target.files.some(({ path }) => path.endsWith('/onnx-webgpu-build-provenance.json')));
	assert.ok(target.files.some(({ path, executable }) => path.endsWith('/onnx-webgpu-device-probe') && executable));
	const changed = async (args) => {
		const receipt = await buildWebGpu(args);
		receipt.files[0].sha256 = 'a'.repeat(64);
		return receipt;
	};
	await assert.rejects(stageDesktopAssistanceOnnxRuntime({ ...options, targetId: 'linux-arm64', buildWebGpu: changed }), /failed verification/u);
	await assert.rejects(stageDesktopAssistanceOnnxRuntime({
		...options, targetId: 'linux-arm64',
		buildWebGpu: () => ({ files: [], provenance: { targetId: 'linux-arm64' } }),
	}), /build receipt/u);
});

test('DXC license and applicability evidence are pinned to the bundled compiler source revision', () => {
	const base = 'https://raw.githubusercontent.com/microsoft/DirectXShaderCompiler/b4711839eb9a87da7c3436d9b212e0492359fbbd/';
	for (const [id, path] of [
		['directx-shader-compiler-license', 'LICENSE.TXT'],
		['directx-shader-compiler-notices', 'ThirdPartyNotices.txt'],
		['directx-shader-compiler-release-notes', 'docs/ReleaseNotes.md'],
	]) {
		const source = payloads.sources.find((candidate) => candidate.id === id);
		assert.equal(source.kind, 'file');
		assert.equal(source.url, `${base}${path}`);
		assert.match(source.sha256, /^[a-f\d]{64}$/u);
	}
});

test('ONNX staging downloads authenticated sources, extracts only pinned files, and reuses verified cache', async (t) => {
	const { root, options, fetched } = await fixture(t);
	const result = await stageDesktopAssistanceOnnxRuntime(options);
	assert.equal(fetched.length, 2);
	assert.equal(result.summary.status, 'authenticated');
	assert.equal(result.summary.fileCount, 8);
	const availability = await describeAssistanceRuntimeFamilyAvailability({
		familyId: 'onnxruntime-node', manifest: result.manifest, runtimeRoot: options.outputRoot,
		platform: 'linux', architecture: 'x64', totalMemoryBytes: 8 * 1024 ** 3,
	});
	assert.equal(availability.status, 'available');
	assert.equal(availability.descriptor.files.length, 8);
	await assert.rejects(readFile(join(root, 'runtime', PREFIX, 'linux-x64',
		'node_modules/onnxruntime-node/script/install.js')), { code: 'ENOENT' });
	await stageDesktopAssistanceOnnxRuntime({
		...options, fetchImpl: () => { throw new Error('Verified cache must not download again.'); },
	});
});

test('ONNX staging refuses altered download bytes before replacing a usable payload', async (t) => {
	const { options, downloads } = await fixture(t);
	await stageDesktopAssistanceOnnxRuntime(options);
	await rm(options.cacheRoot, { recursive: true });
	const url = options.payloads.sources[0].url;
	downloads.set(url, Buffer.from('corrupt archive'));
	await assert.rejects(stageDesktopAssistanceOnnxRuntime(options), /integrity verification/u);
	assert.equal((await readFile(join(options.outputRoot, PREFIX, 'linux-x64',
		'node_modules/onnxruntime-node/dist/index.js'), 'utf8')), 'module.exports = { version: "1.29.0" };');
});

test('ONNX staging rejects changed file pins and tampered cached sources', async (t) => {
	const { options } = await fixture(t);
	const changed = structuredClone(options.payloads);
	changed.sources[0].files[0].sha256 = 'a'.repeat(64);
	await assert.rejects(stageDesktopAssistanceOnnxRuntime({ ...options, payloads: changed }), /failed verification/u);
	await writeFile(join(options.cacheRoot, options.payloads.sources[0].sha256), 'altered cache');
	await assert.rejects(stageDesktopAssistanceOnnxRuntime(options), /integrity verification/u);
});

test('ONNX staging rejects unsupported targets and traversal paths before creating output', async (t) => {
	const { options } = await fixture(t);
	assert.throws(() => createDesktopAssistanceOnnxManifest('mac-x64'), /unsupported/u);
	const changed = structuredClone(options.payloads);
	changed.sources[0].files[0].path = '../../escape';
	await assert.rejects(stageDesktopAssistanceOnnxRuntime({ ...options, payloads: changed }), /file path/u);
	await assert.rejects(stageDesktopAssistanceOnnxRuntime({ ...options, outputRoot: 'relative' }), /absolute path/u);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { zipSync } from 'fflate';
import { create } from 'tar';

import payloads from '../config/assistance-onnx-runtime-payloads.json' with { type: 'json' };
import pluginRecipe from '../config/assistance-onnx-webgpu-plugin.json' with { type: 'json' };
import {
	createDesktopAssistanceOnnxNativeClosureManifest,
	prepareDesktopAssistanceOnnxNativeClosure,
} from '../scripts/lib/desktop-assistance-onnx-native-closure.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pin = (path, bytes) => ({ path, byteLength: bytes.length, sha256: hash(bytes) });

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), 'onnx-native-closure-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const libPath = 'bin/napi-v6/linux/arm64/libonnxruntime.so.1';
	const core = Buffer.from('authenticated ORT C API'), plugin = Buffer.from('authenticated WebGPU plugin');
	const header = Buffer.from('/* authenticated C API header */'), notice = Buffer.from('MIT notice');
	await mkdir(dirname(join(root, 'archive/package', libPath)), { recursive: true });
	await writeFile(join(root, 'archive/package', libPath), core);
	await create({ file: join(root, 'core.tgz'), gzip: true, cwd: join(root, 'archive') }, ['package']);
	const archive = await readFile(join(root, 'core.tgz'));
	const pluginArchive = Buffer.from(zipSync({ 'runtimes/linux-arm64/native/plugin.so': plugin, LICENSE: notice }));
	const ortSource = {
		id: 'onnxruntime-node', kind: 'npm-tarball', url: 'https://example.invalid/core.tgz',
		byteLength: archive.length, sha256: hash(archive),
		integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
		targetFiles: { 'linux-arm64': [pin(libPath, core)] },
	};
	const recipe = {
		...pluginRecipe,
		archive: { id: 'plugin', url: 'https://example.invalid/plugin.zip', ...pin('plugin.zip', pluginArchive) },
		files: [{ ...pin('ONNX-WebGPU-LICENSE', notice), sourcePath: 'LICENSE' }],
		targets: { 'linux-arm64': { ...pin('libonnxruntime_providers_webgpu.so', plugin), sourcePath: 'runtimes/linux-arm64/native/plugin.so' } },
		headers: [{ id: 'header', url: 'https://example.invalid/header.h', ...pin('include/onnxruntime/core/session/onnxruntime_c_api.h', header) }],
	};
	const downloads = new Map([[ortSource.url, archive], [recipe.archive.url, pluginArchive], [recipe.headers[0].url, header]]);
	const fetched = [];
	return {
		root, downloads, fetched,
		options: {
			targetId: 'linux-arm64', outputRoot: join(root, 'output'), cacheRoot: join(root, 'cache'),
			payloads: { ...payloads, sources: [ortSource] }, pluginRecipe: recipe,
			fetchImpl: async (url) => { fetched.push(url); return new Response(downloads.get(url)); },
		},
	};
}

test('the native ONNX closure gives every target an authenticated WebGPU plugin and preserves its notices', () => {
	for (const targetId of ['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64']) {
		const manifest = createDesktopAssistanceOnnxNativeClosureManifest(targetId);
		assert.ok(manifest.files.some(({ path }) => /onnxruntime_providers_webgpu\.(?:dll|so|dylib)$/u.test(path)));
		assert.ok(manifest.files.some(({ path }) => path === 'ONNX-WebGPU-LICENSE'));
		assert.ok(manifest.files.some(({ path }) => path === 'ONNX-WebGPU-ThirdPartyNotices.txt'));
		assert.ok(manifest.files.some(({ path }) => path === 'ONNXRuntime-LICENSE'));
		assert.ok(manifest.files.every(({ path }) => !/\.h$|DirectML|cuda/u.test(path)));
		assert.equal(manifest.files.filter(({ path }) => /onnxruntime_binding\.node/u.test(path)).length, 0);
		if (targetId.startsWith('win-')) assert.ok(manifest.files.some(({ path }) => path === 'dxcompiler.dll'));
		assert.ok(manifest.sourcePins.every(({ sha256 }) => /^[a-f\d]{64}$/u.test(sha256)));
	}
});

test('native ONNX staging verifies archives and exact files and reuses only verified cache bytes', async (t) => {
	const { options, fetched } = await fixture(t);
	const result = await prepareDesktopAssistanceOnnxNativeClosure(options);
	assert.equal(fetched.length, 3);
	assert.equal(result.files.length, 3);
	assert.equal(await readFile(result.libraryPath, 'utf8'), 'authenticated ORT C API');
	assert.equal(await readFile(result.pluginPath, 'utf8'), 'authenticated WebGPU plugin');
	assert.match(await readFile(join(result.includeRoot, 'onnxruntime_c_api.h'), 'utf8'), /authenticated C API/u);
	assert.ok(result.files.every(({ path }) => !path.endsWith('.h')));
	await prepareDesktopAssistanceOnnxNativeClosure({ ...options, fetchImpl: () => { throw new Error('cache must be reused'); } });
	await writeFile(join(options.cacheRoot, options.pluginRecipe.archive.sha256), 'tampered');
	await assert.rejects(prepareDesktopAssistanceOnnxNativeClosure(options), /integrity/u);
});

test('native ONNX staging rejects changed plugin file pins and traversal before output publication', async (t) => {
	const { options } = await fixture(t);
	const changed = structuredClone(options.pluginRecipe);
	changed.targets['linux-arm64'].sha256 = 'a'.repeat(64);
	await assert.rejects(prepareDesktopAssistanceOnnxNativeClosure({ ...options, pluginRecipe: changed }), /verification/u);
	changed.targets['linux-arm64'].path = '../escape.so';
	await assert.rejects(prepareDesktopAssistanceOnnxNativeClosure({ ...options, pluginRecipe: changed }), /path/u);
	assert.throws(() => createDesktopAssistanceOnnxNativeClosureManifest('linux-ia32'), /unsupported/u);
});

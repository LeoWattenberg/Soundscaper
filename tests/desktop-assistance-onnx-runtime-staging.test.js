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

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), 'onnx-runtime-staging-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const files = {
		'dist/index.js': Buffer.from('module.exports = { version: "1.29.0" };'),
		'bin/napi-v6/linux/x64/onnxruntime_binding.node': Buffer.from('pinned CPU binding'),
		'bin/napi-v6/linux/x64/libonnxruntime.so.1': Buffer.from('pinned CPU runtime'),
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
		targetFiles: { 'linux-x64': Object.entries(files).filter(([path]) => path.startsWith('bin/'))
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
			targetId: 'linux-x64', outputRoot: join(root, 'runtime'), cacheRoot: join(root, 'cache'),
			payloads: { ...payloads, sources },
			fetchImpl: async (url) => { fetched.push(url); return new Response(downloads.get(url)); },
		},
	};
}

test('ONNX upstream pins produce exact CPU manifests for all five desktop targets', () => {
	assert.equal(payloads.sources[0].integrity,
		'sha512-WjiVVB72riILz8HbYvxvmjKyE/WmkYoSfKY++axo5jAR609HQg8MwiG/HhShpTcJfmmAdzxxmB+MMST3A+SiPA==');
	for (const targetId of TARGETS) {
		const manifest = validateAssistanceRuntimeFamilyManifestV1(createDesktopAssistanceOnnxManifest(targetId));
		const target = manifest.targets.find(({ id }) => id === targetId);
		assert.equal(target.status, 'authenticated');
		assert.ok(target.files.length >= 32);
		assert.equal(target.entrypoint, 'node_modules/onnxruntime-node/dist/index.js');
		assert.ok(target.files.some(({ path }) => path.endsWith('/dist/cjs/package.json')));
		assert.ok(target.files.some(({ path }) => path.endsWith('/onnxruntime_binding.node')));
		assert.ok(target.files.some(({ path }) => path === 'licenses/ONNXRuntime-LICENSE'));
		assert.ok(target.files.some(({ path }) => path === 'licenses/ONNXRuntime-ThirdPartyNotices.txt'));
		assert.ok(target.files.every(({ path }) => !/\/script\/|cuda|DirectML|dxcompiler|dxil/u.test(path)));
		assert.ok(manifest.targets.filter(({ id }) => id !== targetId)
			.every(({ status }) => status === 'pending-external'));
	}
});

test('ONNX staging downloads authenticated sources, extracts only pinned files, and reuses verified cache', async (t) => {
	const { root, options, fetched } = await fixture(t);
	const result = await stageDesktopAssistanceOnnxRuntime(options);
	assert.equal(fetched.length, 2);
	assert.equal(result.summary.status, 'authenticated');
	assert.equal(result.summary.fileCount, 4);
	const availability = await describeAssistanceRuntimeFamilyAvailability({
		familyId: 'onnxruntime-node', manifest: result.manifest, runtimeRoot: options.outputRoot,
		platform: 'linux', architecture: 'x64', totalMemoryBytes: 8 * 1024 ** 3,
	});
	assert.equal(availability.status, 'available');
	assert.equal(availability.descriptor.files.length, 4);
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

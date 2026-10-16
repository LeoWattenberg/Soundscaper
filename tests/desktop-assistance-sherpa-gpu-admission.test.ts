/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { gunzipSync } from 'node:zlib';
import base from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import recipe from '../config/assistance-sherpa-gpu-build.json' with { type: 'json' };
import {
	assistanceNativeRuntimeStageSummary, stageAssistanceNativeRuntimePayload, verifyAssistanceNativeRuntimePayload,
} from '../desktop/assistance-native-runtime-payload.mjs';
import { stageDesktopAssistanceSpeechRuntime } from '../scripts/lib/desktop-assistance-speech-runtime.mjs';
import { prepareAssistanceRuntimeDistributionSources } from '../scripts/lib/desktop-assistance-runtime-distribution.mjs';
import { createAssistanceRuntimeArchive } from '../scripts/lib/desktop-assistance-runtime-archive.mjs';

const TARGETS = ['mac-arm64', 'win-x64', 'win-arm64', 'linux-x64', 'linux-arm64'] as const;
const bytes = Buffer.from('authenticated native GPU fixture');
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

function fixture(target: typeof TARGETS[number]) {
	const windows = target.startsWith('win-'), mac = target === 'mac-arm64';
	const prefix = windows ? '' : 'lib', extension = windows ? 'dll' : mac ? 'dylib' : 'so';
	const files = Object.fromEntries(['sherpa-onnx.node', 'build-provenance.json', 'SHERPA_NOTICES.txt',
		`onnx-webgpu-device-probe${windows ? '.exe' : ''}`,
		`${prefix}sherpa-onnx-c-api.${extension}`, `${prefix}sherpa-onnx-cxx-api.${extension}`,
		`${prefix}onnxruntime_providers_webgpu.${extension}`,
		...(windows ? ['onnxruntime.dll', 'dxcompiler.dll', 'dxil.dll']
			: mac ? ['libonnxruntime.1.29.0.dylib', 'libonnxruntime.1.dylib'] : ['libonnxruntime.so.1']),
	].map((name) => [name, { byteLength: bytes.length, sha256: hash(bytes) }]));
	const source = recipe.sources.find(({ id }) => id === 'sherpa-source');
	if (!source) throw new Error('Missing pinned Sherpa source.');
	const entry = { status: 'built', executionProviders: mac ? ['coreml', 'webgpu', 'cpu'] : ['webgpu', 'cpu'],
		package: { name: `sherpa-onnx-${target.replace('mac-', 'darwin-')}`, version: recipe.version,
			sourceUrl: source.url, integrity: source.integrity, files,
			sourceBuild: { recipeId: recipe.recipeId, sourceRevision: recipe.sourceRevision,
				sourceSha256: source.sha256, recipeSha256: hash(JSON.stringify(recipe)) } } };
	return { entry, manifest: { ...base, targets: { ...base.targets, [target]: entry } } };
}

test('every Sherpa target binds GPU providers to a recipe and a complete native GPU closure', () => {
	for (const target of TARGETS) {
		const { entry, manifest } = fixture(target);
		const summary = assistanceNativeRuntimeStageSummary(manifest, target);
		assert.deepEqual(summary.executionProviders, entry.executionProviders);
		assert.equal(summary.status, 'built');
		assert.ok(Object.isFrozen(summary.executionProviders));
	}
});

test('Sherpa GPU metadata refuses altered recipes, missing GPU dependencies, and foreign target packages', () => {
	for (const target of TARGETS) {
		const { manifest, entry } = fixture(target);
		for (const change of [
			{ ...entry, executionProviders: ['cpu'] },
			{ ...entry, executionProviders: ['webgpu'] },
			{ ...entry, executionProviders: ['cuda', 'cpu'] },
			{ ...entry, package: { ...entry.package, name: 'sherpa-onnx-node' } },
			{ ...entry, package: { ...entry.package, sourceBuild: { ...entry.package.sourceBuild,
				recipeSha256: '0'.repeat(64) } } },
			...Object.keys(entry.package.files).map((missing) => ({ ...entry, package: { ...entry.package,
				files: Object.fromEntries(Object.entries(entry.package.files).filter(([name]) => name !== missing)) } })),
		]) {
			assert.throws(() => assistanceNativeRuntimeStageSummary({ ...manifest,
				targets: { ...manifest.targets, [target]: change } }, target), /GPU|provider|package/iu);
		}
	}
});

test('Sherpa GPU files are reauthenticated before capabilities cross into the inference worker', async (context) => {
	const { root, modules, entry, manifest } = await sourceFixture(context, 'linux-x64');
	const outputRoot = join(root, 'runtime');
	await stageAssistanceNativeRuntimePayload({ manifest, targetId: 'linux-x64', nodeModulesRoot: modules, outputRoot });
	const options = { manifest, targetId: 'linux-x64', outputRoot };
	const verified = await verifyAssistanceNativeRuntimePayload(options);
	assert.deepEqual(verified.executionProviders, ['webgpu', 'cpu']);
	await writeFile(join(outputRoot, manifest.runtimePrefix, 'node_modules', entry.package.name,
		'libonnxruntime_providers_webgpu.so'), Buffer.alloc(bytes.length));
	await assert.rejects(verifyAssistanceNativeRuntimePayload(options), /digest/iu);
});

test('speech packaging builds and authenticates a GPU-capable Sherpa closure for every target', async (context) => {
	for (const targetId of TARGETS) {
		const { root, modules, entry, manifest } = await sourceFixture(context, targetId);
		let builds = 0;
		const result = await stageDesktopAssistanceSpeechRuntime({
			repositoryRoot: root, targetId, nodeModulesRoot: modules,
			runtimeRoot: join(root, 'runtime'), cacheRoot: join(root, 'cache'),
			buildRuntime: async (options) => {
				assert.equal(options.targetId, targetId);
				assert.equal(options.nodeModulesRoot, modules);
				builds += 1;
				return { manifest, nodeModulesRoot: modules, summary: { targetId } };
			},
		});
		assert.equal(builds, 1);
		assert.deepEqual(result.summary.executionProviders, entry.executionProviders);
		assert.equal(result.summary.status, 'built');
	}
});

test('new speech packaging refuses to substitute a legacy CPU build when the GPU build is unavailable', async () => {
	await assert.rejects(stageDesktopAssistanceSpeechRuntime({
		repositoryRoot: '/fixture', targetId: 'linux-x64', nodeModulesRoot: '/fixture/modules',
		runtimeRoot: '/fixture/runtime', cacheRoot: '/fixture/cache',
		buildRuntime: async () => ({ manifest: base, nodeModulesRoot: '/fixture/modules', summary: {} }),
	}), /did not provide a GPU option/u);
});

test('distributed Windows GPU probes retain executable archive mode without POSIX source permissions', async (context) => {
	const targetId = 'win-arm64';
	const { root, modules, manifest } = await sourceFixture(context, targetId);
	const runtimeRoot = join(root, 'runtime');
	const speech = { manifest, summary: await stageAssistanceNativeRuntimePayload({
		manifest, targetId, nodeModulesRoot: modules, outputRoot: runtimeRoot,
	}) };
	const familyIds = ['onnxruntime-node', 'whisper-cpp', 'llama-cpp'];
	const file = { path: 'engine', byteLength: bytes.length, sha256: hash(bytes), executable: false };
	const manifests: Record<string, unknown> = {};
	for (const familyId of [...familyIds, 'kokoro-g2p']) {
		const runtimePrefix = `assistance/${familyId}/fixture`;
		await mkdir(join(runtimeRoot, runtimePrefix, targetId), { recursive: true });
		await writeFile(join(runtimeRoot, runtimePrefix, targetId, file.path), bytes);
		manifests[familyId] = { runtimeVersion: 'fixture', runtimePrefix,
			targets: [{ id: targetId, status: 'authenticated', files: [file] }] };
	}
	const prepared = await prepareAssistanceRuntimeDistributionSources({
		targetId, runtimeRoot, assistanceSpeechRuntime: speech, environment: {},
		assistanceRuntimeFamilies: { manifestBytes: Buffer.from(JSON.stringify({ manifests })),
			summary: { targetId, families: familyIds.map((familyId) => ({ familyId, targetId, runtimeVersion: 'fixture' })) } },
		kokoroG2pRuntime: { manifest: { runtimeVersion: 'fixture', runtimePrefix: 'assistance/kokoro-g2p/fixture',
			targetId, executable: 'engine', files: [file] } },
	});
	const probe = prepared.speechFiles.find(({ path }: { path: string }) => path.endsWith('/onnx-webgpu-device-probe.exe'));
	assert.ok(probe);
	assert.equal(probe?.executable, true);
	const archived = await createAssistanceRuntimeArchive({
		familyId: 'sherpa-onnx-node', runtimeVersion: recipe.version, targetId,
		runtimePrefix: manifest.runtimePrefix, installPath: manifest.runtimePrefix,
		files: prepared.speechFiles, runtimeRoot, archiveRoot: join(root, 'archives'),
	});
	const tar = gunzipSync(await readFile(archived.archivePath));
	let found = false;
	for (let offset = 0; tar[offset];) {
		const name = tar.toString('utf8', offset, offset + 100).replaceAll('\0', '');
		if (name === probe.path) {
			assert.equal(Number.parseInt(tar.toString('ascii', offset + 100, offset + 108), 8) & 0o111, 0o111);
			found = true;
		}
		const length = Number.parseInt(tar.toString('ascii', offset + 124, offset + 136), 8);
		offset += 512 + Math.ceil(length / 512) * 512;
	}
	assert.equal(found, true);
});

async function sourceFixture(context: TestContext, targetId: typeof TARGETS[number]) {
	const root = await mkdtemp(join(tmpdir(), 'sherpa-gpu-admission-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const { entry, manifest } = fixture(targetId);
	const modules = join(root, 'source');
	await mkdir(modules);
	await cp(resolve('node_modules', base.commonPackage.name), join(modules, base.commonPackage.name), { recursive: true });
	const native = join(modules, entry.package.name);
	await mkdir(native);
	for (const name of Object.keys(entry.package.files)) await writeFile(join(native, name), bytes);
	return { root, modules, entry, manifest };
}

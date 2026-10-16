/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import candidates from '../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import { describeAssistanceRuntimeFamilyAvailability, validateAssistanceRuntimeFamilyManifestV1 } from '../desktop/assistance-runtime-family-manifest.ts';
import { validateAssistanceRuntimeFamilyDescriptorV1 } from '../desktop/assistance-runtime-family-process-protocol.ts';
import { onnxGpuDescriptorFixture, onnxGpuTargetFixture } from './helpers/desktop-assistance-onnx-gpu-fixture.ts';

const TARGETS = ['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64'];
function manifest(target: ReturnType<typeof onnxGpuTargetFixture>) {
	const base = candidates.manifests['onnxruntime-node'];
	return { ...base, targets: base.targets.map((entry) => entry.id === target.id ? target : entry) };
}

test('every ONNX GPU target admits the actual producer closure and rejects GPU claims on a CPU-only inventory', () => {
	for (const targetId of TARGETS) {
		const target = onnxGpuTargetFixture(targetId);
		assert.doesNotThrow(() => validateAssistanceRuntimeFamilyManifestV1(manifest(target)));
		assert.doesNotThrow(() => validateAssistanceRuntimeFamilyDescriptorV1(onnxGpuDescriptorFixture(targetId)));
		assert.throws(() => validateAssistanceRuntimeFamilyManifestV1(manifest({ ...target, files: target.files.slice(0, 1) })), /WebGPU.*closure/iu);
		for (const file of target.files.slice(1)) {
			assert.throws(() => validateAssistanceRuntimeFamilyManifestV1(manifest({
				...target, files: target.files.filter(({ path }) => path !== file.path),
			})), /WebGPU.*closure/iu, `${targetId}/${file.path}`);
		}
	}
});

test('every committed baseline ONNX snapshot remains admissible with its original capabilities', async () => {
	for (const targetId of TARGETS) {
		const compressed = await readFile(new URL(`../config/desktop-test-assistance-runtime-snapshots/${targetId}.json.gz`, import.meta.url));
		const snapshot = JSON.parse(gunzipSync(compressed).toString()) as { files: Record<string, string> };
		const register = JSON.parse(snapshot.files['config/assistance-runtime-family-supply-candidates.json']!) as {
			manifests: Record<string, unknown>;
		};
		assert.doesNotThrow(() => validateAssistanceRuntimeFamilyManifestV1(register.manifests['onnxruntime-node']), targetId);
	}
});

test('GPU executable probe bytes are authenticated before a usable descriptor is granted', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'onnx-gpu-admission-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const bytes = Buffer.from('authenticated GPU runtime');
	const target = onnxGpuTargetFixture('linux-x64', bytes);
	const value = manifest(target);
	const targetRoot = join(root, value.runtimePrefix, target.id);
	for (const file of target.files) {
		const path = join(targetRoot, file.path);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, bytes, { mode: file.executable ? 0o755 : 0o644 });
	}
	const options = { familyId: 'onnxruntime-node' as const, manifest: value, runtimeRoot: root,
		platform: 'linux', architecture: 'x64', totalMemoryBytes: 8 * 1024 ** 3 };
	const result = await describeAssistanceRuntimeFamilyAvailability(options);
	assert.equal(result.status, 'available');
	if (result.status !== 'available') throw new Error('Expected authenticated GPU runtime.');
	assert.doesNotThrow(() => validateAssistanceRuntimeFamilyDescriptorV1(result.descriptor));
	await writeFile(join(targetRoot, target.files.find(({ executable }) => executable)!.path), 'tampered');
	const changed = await describeAssistanceRuntimeFamilyAvailability(options);
	assert.equal(changed.status, 'unavailable');
	if (changed.status !== 'unavailable') throw new Error('Expected altered GPU runtime rejection.');
	assert.equal(changed.reason, 'payload-digest-mismatch');
});

test('ONNX GPU admission binds executable probes and foreign-platform libraries to the exact target', () => {
	for (const targetId of TARGETS) {
		const target = onnxGpuTargetFixture(targetId);
		const files = target.files.map((file) => file.executable ? { ...file, executable: false } : file);
		assert.throws(() => validateAssistanceRuntimeFamilyManifestV1(manifest({ ...target, files })), /WebGPU.*closure/iu);
		const descriptor = onnxGpuDescriptorFixture(targetId, targetId.startsWith('win-') ? 'C:\\runtime' : '/runtime');
		assert.doesNotThrow(() => validateAssistanceRuntimeFamilyDescriptorV1(descriptor));
		assert.throws(() => validateAssistanceRuntimeFamilyDescriptorV1({
			...descriptor, files: descriptor.files.map((file) => file.relativePath.includes('providers_webgpu')
				? { ...file, path: '/outside/plugin.so' } : file),
		}), /WebGPU.*closure/iu);
		assert.throws(() => validateAssistanceRuntimeFamilyDescriptorV1({
			...descriptor, target: targetId === 'mac-arm64' ? 'linux-x64' : 'mac-arm64',
			executionProviders: ['webgpu', 'cpu'],
		}), /WebGPU.*closure/iu);
	}
});

test('legacy CPU-only and metadata-free ONNX inventories do not require GPU artifacts', () => {
	for (const executionProviders of [undefined, ['cpu']]) {
		const target = { ...onnxGpuTargetFixture('linux-arm64'), executionProviders };
		const legacy = { ...target, files: target.files.slice(0, 1) };
		if (executionProviders === undefined) Reflect.deleteProperty(legacy, 'executionProviders');
		assert.doesNotThrow(() => validateAssistanceRuntimeFamilyManifestV1(manifest(legacy as ReturnType<typeof onnxGpuTargetFixture>)));
	}
});

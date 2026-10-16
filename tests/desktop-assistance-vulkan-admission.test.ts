/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import candidates from '../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import {
	describeAssistanceRuntimeFamilyAvailability,
	validateAssistanceRuntimeFamilyManifestV1,
} from '../desktop/assistance-runtime-family-manifest.ts';
import { validateAssistanceRuntimeFamilyDescriptorV1 } from '../desktop/assistance-runtime-family-process-protocol.ts';
import { authenticateAssistanceRuntimeFamilyDescriptorFilesV1 } from '../desktop/assistance-runtime-family-file-grants.ts';

const BYTES = Buffer.from('authenticated Vulkan executable');
const SHA = createHash('sha256').update(BYTES).digest('hex');
const TARGETS = ['linux-x64', 'linux-arm64', 'win-x64', 'win-arm64'] as const;

function fixture(familyId: 'whisper-cpp' | 'llama-cpp', targetId: string) {
	const template = candidates.manifests[familyId];
	const name = `runtime${targetId.startsWith('win-') ? '.exe' : ''}`;
	const files = [name, `gpu/${name}`].map((path) => ({
		path, byteLength: BYTES.length, sha256: SHA, executable: true,
	}));
	const target = { id: targetId, status: 'authenticated', entrypoint: name,
		executionProviders: ['vulkan', 'cpu'], accelerationEntrypoints: { vulkan: `gpu/${name}` }, files };
	return { target, manifest: { ...template, targets: template.targets.map((t) => t.id === targetId ? target : t) } };
}

test('Whisper and Qwen Vulkan companions are admitted for Windows and Linux on both architectures', () => {
	for (const familyId of ['whisper-cpp', 'llama-cpp'] as const) for (const targetId of TARGETS) {
		const value = fixture(familyId, targetId);
		const admitted = validateAssistanceRuntimeFamilyManifestV1(value.manifest);
		assert.deepEqual(admitted.targets.find(({ id }) => id === targetId), value.target);
	}
});

test('Vulkan requires a separate executable companion and cannot grant another backend or family', () => {
	const { target, manifest } = fixture('whisper-cpp', 'linux-x64');
	for (const changed of [
		{ ...target, accelerationEntrypoints: undefined },
		{ ...target, accelerationEntrypoints: { vulkan: target.entrypoint } },
		{ ...target, accelerationEntrypoints: { vulkan: '../runtime' } },
		{ ...target, accelerationEntrypoints: { vulkan: '/outside/runtime' } },
		{ ...target, accelerationEntrypoints: { vulkan: 'gpu/unlisted' } },
		{ ...target, accelerationEntrypoints: { vulkan: 'gpu/runtime', cuda: 'gpu/runtime' } },
		{ ...target, executionProviders: ['cpu'] },
		{ ...target, files: target.files.slice(0, 1) },
		{ ...target, files: target.files.map((f) => ({ ...f, executable: f.path === target.entrypoint })) },
	]) {
		assert.throws(() => validateAssistanceRuntimeFamilyManifestV1({
			...manifest, targets: manifest.targets.map((t) => t.id === target.id ? changed : t),
		}), /Vulkan|companion|acceleration/iu);
	}
	const onnx = candidates.manifests['onnxruntime-node'];
	assert.throws(() => validateAssistanceRuntimeFamilyManifestV1({
		...onnx, targets: onnx.targets.map((t) => t.id === target.id ? target : t),
	}), /provider|companion|execution/iu);
	const mac = fixture('whisper-cpp', 'mac-arm64');
	assert.throws(() => validateAssistanceRuntimeFamilyManifestV1(mac.manifest), /provider/iu);
});

test('availability authenticates both binaries and passes the bound GPU path across the process wire', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-vulkan-admission-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const { target, manifest } = fixture('llama-cpp', 'linux-x64');
	const targetRoot = join(root, manifest.runtimePrefix, target.id);
	await mkdir(join(targetRoot, 'gpu'), { recursive: true });
	for (const file of target.files) await writeFile(join(targetRoot, file.path), BYTES);
	const options = { familyId: 'llama-cpp' as const, manifest, runtimeRoot: root,
		platform: 'linux', architecture: 'x64', totalMemoryBytes: 32 * 1024 ** 3 };
	const available = await describeAssistanceRuntimeFamilyAvailability(options);
	assert.equal(available.status, 'available');
	const descriptor = validateAssistanceRuntimeFamilyDescriptorV1(available.descriptor);
	assert.deepEqual(await authenticateAssistanceRuntimeFamilyDescriptorFilesV1(descriptor), descriptor);
	assert.deepEqual(Reflect.get(descriptor, 'accelerationEntrypoints'), { vulkan: join(targetRoot, 'gpu/runtime') });
	for (const substitute of [join(targetRoot, 'runtime'), '/outside/runtime']) {
		assert.throws(() => validateAssistanceRuntimeFamilyDescriptorV1({
			...descriptor, accelerationEntrypoints: { vulkan: substitute },
		}), /Vulkan|companion/iu);
	}
	assert.throws(() => validateAssistanceRuntimeFamilyDescriptorV1({ ...descriptor,
		accelerationEntrypoints: { vulkan: join(targetRoot, '..', 'gpu/runtime') },
		files: descriptor.files.map((file) => file.relativePath.startsWith('gpu/')
			? { ...file, path: join(targetRoot, '..', 'gpu/runtime') } : { ...file, relativePath: 'bin/runtime' }),
	}), /Vulkan|companion/iu);
	await writeFile(join(targetRoot, 'gpu/runtime'), 'tampered');
	await assert.rejects(authenticateAssistanceRuntimeFamilyDescriptorFilesV1(descriptor), /length|digest/iu);
	const tampered = await describeAssistanceRuntimeFamilyAvailability(options);
	assert.equal(tampered.status, 'unavailable');
	if (tampered.status === 'unavailable') assert.equal(tampered.reason, 'payload-digest-mismatch');
});

test('Windows descriptor companion paths stay inside their target closure on any validation host', () => {
	const { target } = fixture('whisper-cpp', 'win-arm64');
	const descriptor = { familyId: 'whisper-cpp', runtimeVersion: 'v1.9.3', target: target.id,
		executionProvider: 'cpu', executionProviders: target.executionProviders,
		entrypoint: 'C:\\runtime\\runtime.exe', accelerationEntrypoints: { vulkan: 'C:\\runtime\\gpu\\runtime.exe' },
		files: target.files.map((f) => ({ ...f, relativePath: f.path, path: `C:\\runtime\\${f.path.replaceAll('/', '\\')}` })) };
	assert.deepEqual(validateAssistanceRuntimeFamilyDescriptorV1(descriptor), descriptor);
	assert.throws(() => validateAssistanceRuntimeFamilyDescriptorV1({ ...descriptor,
		files: descriptor.files.map((f) => f.relativePath.startsWith('gpu/')
			? { ...f, path: 'C:\\outside\\runtime.exe' } : f),
		accelerationEntrypoints: { vulkan: 'C:\\outside\\runtime.exe' },
	}), /Vulkan|companion/iu);
	assert.throws(() => validateAssistanceRuntimeFamilyDescriptorV1({ ...descriptor,
		accelerationEntrypoints: { vulkan: 'C:\\gpu\\runtime.exe' },
		files: descriptor.files.map((file) => file.relativePath.startsWith('gpu/')
			? { ...file, path: 'C:\\gpu\\runtime.exe' } : { ...file, relativePath: 'bin/runtime.exe' }),
	}), /Vulkan|companion/iu);
});

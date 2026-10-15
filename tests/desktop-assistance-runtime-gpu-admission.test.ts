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
	type AssistanceRuntimeFamilyId,
} from '../desktop/assistance-runtime-family-manifest.ts';
import { validateAssistanceRuntimeFamilyDescriptorV1 } from '../desktop/assistance-runtime-family-process-protocol.ts';

const BYTES = Buffer.from('authenticated GPU-capable runtime');
const SHA = createHash('sha256').update(BYTES).digest('hex');

function manifest(familyId: AssistanceRuntimeFamilyId, targetId: string, executionProviders?: unknown) {
	const template = candidates.manifests[familyId];
	return {
		...template,
		targets: template.targets.map((target) => target.id !== targetId ? target : {
			id: targetId, status: 'authenticated', entrypoint: 'runtime',
			...(executionProviders === undefined ? {} : { executionProviders }),
			files: [{ path: 'runtime', byteLength: BYTES.byteLength, sha256: SHA,
				executable: familyId !== 'onnxruntime-node' }],
		}),
	};
}

test('GPU capabilities remain bound to the reviewed family and target with a CPU fallback', () => {
	for (const [familyId, targetId, providers] of [
		['onnxruntime-node', 'mac-arm64', ['coreml', 'webgpu', 'cpu']],
		['onnxruntime-node', 'win-arm64', ['dml', 'webgpu', 'cpu']],
		['onnxruntime-node', 'linux-x64', ['webgpu', 'cpu']],
		['whisper-cpp', 'mac-arm64', ['metal', 'cpu']],
		['llama-cpp', 'mac-arm64', ['metal', 'cpu']],
	] as const) {
		const admitted = validateAssistanceRuntimeFamilyManifestV1(manifest(familyId, targetId, providers));
		assert.deepEqual(admitted.targets.find(({ id }) => id === targetId),
			manifest(familyId, targetId, providers).targets.find(({ id }) => id === targetId));
	}
	for (const [familyId, targetId, providers] of [
		['onnxruntime-node', 'linux-arm64', ['webgpu', 'cpu']],
		['onnxruntime-node', 'linux-x64', ['coreml', 'cpu']],
		['onnxruntime-node', 'mac-arm64', ['dml', 'cpu']],
		['whisper-cpp', 'linux-x64', ['metal', 'cpu']],
		['llama-cpp', 'mac-arm64', ['webgpu', 'cpu']],
		['llama-cpp', 'mac-arm64', ['metal']],
		['llama-cpp', 'mac-arm64', ['metal', 'metal', 'cpu']],
		['llama-cpp', 'mac-arm64', []],
		['llama-cpp', 'mac-arm64', 'metal'],
		['llama-cpp', 'mac-arm64', ['unreviewed', 'cpu']],
	] as const) {
		assert.throws(() => validateAssistanceRuntimeFamilyManifestV1(
			manifest(familyId, targetId, providers)), /provider/iu);
	}
});

test('legacy CPU archives cannot acquire GPU capabilities when their manifest omits them', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-gpu-manifest-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const executionProviders of [undefined, ['metal', 'cpu']]) {
		const value = manifest('whisper-cpp', 'mac-arm64', executionProviders);
		const targetRoot = join(root, value.runtimePrefix, 'mac-arm64');
		await mkdir(targetRoot, { recursive: true });
		await writeFile(join(targetRoot, 'runtime'), BYTES);
		const availability = await describeAssistanceRuntimeFamilyAvailability({
			familyId: 'whisper-cpp', manifest: value, runtimeRoot: root,
			platform: 'darwin', architecture: 'arm64', totalMemoryBytes: 32 * 1024 ** 3,
		});
		assert.equal(availability.status, 'available');
		const descriptor = validateAssistanceRuntimeFamilyDescriptorV1(availability.descriptor);
		assert.deepEqual(descriptor, availability.descriptor);
		assert.deepEqual(Reflect.get(descriptor, 'executionProviders'), executionProviders);
		await writeFile(join(targetRoot, 'runtime'), 'tampered');
		const tampered = await describeAssistanceRuntimeFamilyAvailability({
			familyId: 'whisper-cpp', manifest: value, runtimeRoot: root,
			platform: 'darwin', architecture: 'arm64', totalMemoryBytes: 32 * 1024 ** 3,
		});
		assert.equal(tampered.status, 'unavailable');
	}
});

test('process descriptors preserve authenticated GPU capabilities and reject target spoofing', () => {
	const descriptor = {
		familyId: 'onnxruntime-node', runtimeVersion: '1.29.0', target: 'win-x64',
		executionProvider: 'cpu', executionProviders: ['dml', 'webgpu', 'cpu'],
		entrypoint: '/runtime/index.js',
		files: [{ path: '/runtime/index.js', relativePath: 'index.js',
			byteLength: BYTES.byteLength, sha256: SHA, executable: false }],
	};
	assert.deepEqual(validateAssistanceRuntimeFamilyDescriptorV1(descriptor), descriptor);
	assert.throws(() => validateAssistanceRuntimeFamilyDescriptorV1({
		...descriptor, target: 'linux-x64',
	}), /provider/iu);
	assert.throws(() => validateAssistanceRuntimeFamilyDescriptorV1({
		...descriptor, executionProviders: ['dml'],
	}), /provider/iu);
});

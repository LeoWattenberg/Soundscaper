/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS,
	ASSISTANCE_RUNTIME_FAMILY_TARGETS,
	assistanceRuntimeFamilyTargetFor,
	describeAssistanceRuntimeFamilyAvailability,
	validateAssistanceRuntimeFamilyManifestV1,
} from '../desktop/assistance-runtime-family-manifest.ts';

const GIB = 1024 ** 3;
const BYTES = Buffer.from('authenticated runtime payload');
const SHA256 = createHash('sha256').update(BYTES).digest('hex');

function manifest(
	familyId: keyof typeof ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS = 'onnxruntime-node',
	status: 'authenticated' | 'pending-external' = 'authenticated',
) {
	const definition = ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS[familyId];
	return {
		schemaVersion: 1,
		familyId,
		runtimeVersion: definition.runtimeVersion,
		source: { url: definition.sourceUrl, revision: definition.sourceRevision },
		executionProvider: 'cpu',
		runtimePrefix: `assistance/${familyId}/${definition.runtimeVersion}`,
		targets: ASSISTANCE_RUNTIME_FAMILY_TARGETS.map((id) => status === 'authenticated' ? {
			id,
			status,
			entrypoint: definition.loader === 'executable' ? 'bin/runtime' : 'runtime.js',
			files: [{
				path: definition.loader === 'executable' ? 'bin/runtime' : 'runtime.js',
				byteLength: BYTES.byteLength,
				sha256: SHA256,
				executable: definition.loader === 'executable',
			}],
		} : {
			id,
			status,
			blockedBy: `External payload digests for ${familyId} ${id} have not been admitted.`,
		}),
	};
}

test('the added CPU runtime family vocabulary pins versions, sources, and five release targets', () => {
	assert.deepEqual(Object.keys(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS), [
		'onnxruntime-node', 'whisper-cpp', 'llama-cpp',
	]);
	assert.deepEqual(ASSISTANCE_RUNTIME_FAMILY_TARGETS, [
		'mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64',
	]);
	assert.deepEqual(Object.fromEntries(Object.entries(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS)
		.map(([id, value]) => [id, value.runtimeVersion])), {
		'onnxruntime-node': '1.29.0',
		'whisper-cpp': 'v1.9.3',
		'llama-cpp': 'b10509',
	});
	assert.equal(ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS['llama-cpp'].minimumSystemMemoryBytes, 16 * GIB);
	assert.equal(assistanceRuntimeFamilyTargetFor('darwin', 'arm64'), 'mac-arm64');
	assert.equal(assistanceRuntimeFamilyTargetFor('win32', 'arm64'), 'win-arm64');
	assert.equal(assistanceRuntimeFamilyTargetFor('darwin', 'x64'), null);
});

test('manifest admission is closed, CPU-only, complete, and binds every entrypoint to a digest', () => {
	const admitted = validateAssistanceRuntimeFamilyManifestV1(manifest());
	assert.equal(admitted.familyId, 'onnxruntime-node');
	assert.equal(admitted.targets.length, 5);
	assert.equal(admitted.targets[0]!.status, 'authenticated');
	if (admitted.targets[0]!.status === 'authenticated') {
		assert.equal(admitted.targets[0]!.files[0]!.sha256, SHA256);
	}

	const invalid = [
		{ ...manifest(), executionProvider: 'cuda' },
		{ ...manifest(), runtimeVersion: '1.28.0' },
		{ ...manifest(), surprise: true },
		{ ...manifest(), targets: manifest().targets.slice(1) },
		{ ...manifest(), targets: manifest().targets.map((target, index) => index === 0
			? { ...target, entrypoint: 'missing.node' } : target) },
		{ ...manifest(), targets: manifest().targets.map((target, index) => index === 0
			? { ...target, files: [{ ...target.files![0], sha256: '0'.repeat(63) }] } : target) },
		{ ...manifest(), targets: manifest().targets.map((target, index) => index === 0
			? { ...target, files: [{ ...target.files![0], path: '../escape' }] } : target) },
	];
	for (const candidate of invalid) {
		assert.throws(() => validateAssistanceRuntimeFamilyManifestV1(candidate), /manifest|target|file|CPU|entrypoint|version/iu);
	}
});

test('pending targets carry an honest blocker but no invented payload closure', () => {
	const admitted = validateAssistanceRuntimeFamilyManifestV1(manifest('whisper-cpp', 'pending-external'));
	assert.equal(admitted.targets[0]!.status, 'pending-external');
	assert.throws(() => validateAssistanceRuntimeFamilyManifestV1({
		...manifest('whisper-cpp', 'pending-external'),
		targets: manifest('whisper-cpp', 'pending-external').targets.map((target, index) => index === 0
			? { ...target, files: [] } : target),
	}), /pending|target/iu);
});

test('availability is typed for unsupported, missing, pending, and memory-refused families', async () => {
	const unsupported = await describeAssistanceRuntimeFamilyAvailability({
		familyId: 'onnxruntime-node', manifest: manifest(), runtimeRoot: '/runtime',
		platform: 'darwin', architecture: 'x64', totalMemoryBytes: 32 * GIB,
	});
	assert.deepEqual(unsupported, {
		status: 'unavailable', reason: 'unsupported-platform',
		detail: 'darwin-x64 is not a Milestone 7 CPU runtime target.',
	});

	const missing = await describeAssistanceRuntimeFamilyAvailability({
		familyId: 'whisper-cpp', manifest: null, runtimeRoot: '/runtime',
		platform: 'linux', architecture: 'x64', totalMemoryBytes: 32 * GIB,
	});
	assert.equal(missing.status, 'unavailable');
	if (missing.status === 'unavailable') assert.equal(missing.reason, 'manifest-missing');

	const pending = await describeAssistanceRuntimeFamilyAvailability({
		familyId: 'whisper-cpp', manifest: manifest('whisper-cpp', 'pending-external'), runtimeRoot: '/runtime',
		platform: 'linux', architecture: 'x64', totalMemoryBytes: 32 * GIB,
	});
	assert.equal(pending.status, 'unavailable');
	if (pending.status === 'unavailable') assert.equal(pending.reason, 'payload-pending-external');

	const memory = await describeAssistanceRuntimeFamilyAvailability({
		familyId: 'llama-cpp', manifest: manifest('llama-cpp'), runtimeRoot: '/runtime',
		platform: 'linux', architecture: 'x64', totalMemoryBytes: 8 * GIB,
	});
	assert.equal(memory.status, 'unavailable');
	if (memory.status === 'unavailable') assert.equal(memory.reason, 'insufficient-system-memory');
});

test('availability authenticates the exact installed closure before exposing its entrypoint', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-m7-runtime-'));
	context.after(async () => {
		const { rm } = await import('node:fs/promises');
		await rm(root, { recursive: true, force: true });
	});
	const value = manifest();
	const runtimeRoot = join(root, 'runtime');
	const targetRoot = join(runtimeRoot, value.runtimePrefix, 'linux-x64');
	await mkdir(targetRoot, { recursive: true });
	await writeFile(join(targetRoot, 'runtime.js'), BYTES);

	const available = await describeAssistanceRuntimeFamilyAvailability({
		familyId: 'onnxruntime-node', manifest: value, runtimeRoot,
		platform: 'linux', architecture: 'x64', totalMemoryBytes: 32 * GIB,
	});
	assert.equal(available.status, 'available');
	if (available.status === 'available') {
		assert.equal(available.descriptor.target, 'linux-x64');
		assert.equal(available.descriptor.entrypoint, join(targetRoot, 'runtime.js'));
		assert.equal(available.descriptor.files.length, 1);
	}

	await writeFile(join(targetRoot, 'unlisted.dll'), BYTES);
	const extra = await describeAssistanceRuntimeFamilyAvailability({
		familyId: 'onnxruntime-node', manifest: value, runtimeRoot,
		platform: 'linux', architecture: 'x64', totalMemoryBytes: 32 * GIB,
	});
	assert.equal(extra.status, 'unavailable');
	if (extra.status === 'unavailable') assert.equal(extra.reason, 'payload-digest-mismatch');
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import candidates from '../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import {
	type AssistanceRuntimeFamilyId,
	type AssistanceRuntimeFamilyManifestV1,
	validateAssistanceRuntimeFamilyManifestV1,
} from '../desktop/assistance-runtime-family-manifest.ts';
import { stageDesktopAssistanceRuntimeFamilies } from '../scripts/lib/desktop-assistance-runtime-families.mjs';
import { verifyDesktopAssistanceRuntimeFamilyPackage } from '../scripts/lib/desktop-assistance-runtime-family-verification.mjs';

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'assistance-package-'));
	async function stage(familyId: AssistanceRuntimeFamilyId) {
		const manifest = validateAssistanceRuntimeFamilyManifestV1(candidates.manifests[familyId]);
		const entrypoint = familyId === 'onnxruntime-node' ? 'index.js' : 'whisper-cli';
		const bytes = Buffer.from(`test payload for ${familyId}`);
		const targetRoot = join(root, manifest.runtimePrefix, 'linux-x64');
		await mkdir(targetRoot, { recursive: true });
		await writeFile(join(targetRoot, entrypoint), bytes);
		return {
			manifest: {
				...manifest,
				targets: manifest.targets.map((target) => target.id !== 'linux-x64' ? target : {
					id: 'linux-x64', status: 'authenticated', entrypoint,
					files: [{
						path: entrypoint, byteLength: bytes.length,
						sha256: createHash('sha256').update(bytes).digest('hex'),
						executable: familyId !== 'onnxruntime-node',
					}],
				}),
			} satisfies AssistanceRuntimeFamilyManifestV1,
			summary: { source: 'unit-test fixture' },
		};
	}
	return { root, stage, clean: () => rm(root, { recursive: true, force: true }) };
}

test('desktop packaging binds both real-engine inventories to the packaged target and exact bytes', async () => {
	const f = await fixture();
	try {
		const result = await stageDesktopAssistanceRuntimeFamilies({
			targetId: 'linux-x64', runtimeRoot: f.root,
			stageOnnx: () => f.stage('onnxruntime-node'),
			stageWhisper: () => f.stage('whisper-cpp'),
		});
		const packaged = JSON.parse(result.manifestBytes.toString()) as {
			manifests: Record<AssistanceRuntimeFamilyId, unknown>;
		};
		assert.deepEqual(result.summary.families.map((family: { familyId: string }) => family.familyId),
			['onnxruntime-node', 'whisper-cpp']);
		for (const familyId of ['onnxruntime-node', 'whisper-cpp'] as const) {
			const manifest = validateAssistanceRuntimeFamilyManifestV1(packaged.manifests[familyId]);
			assert.equal(manifest.targets.find(({ id }) => id === 'linux-x64')?.status, 'authenticated');
		}
		assert.deepEqual(packaged.manifests['llama-cpp'], candidates.manifests['llama-cpp']);
		assert.equal(result.summary.manifest.sha256,
			createHash('sha256').update(result.manifestBytes).digest('hex'));
		assert.equal(candidates.manifests['onnxruntime-node'].targets[1]?.status, 'pending-external');
		await verifyDesktopAssistanceRuntimeFamilyPackage({
			...result, targetId: 'linux-x64', runtimeRoot: f.root,
		});
		await assert.rejects(verifyDesktopAssistanceRuntimeFamilyPackage({
			...result, targetId: 'win-x64', runtimeRoot: f.root,
		}), /build receipt/u);
		await assert.rejects(verifyDesktopAssistanceRuntimeFamilyPackage({
			...result, manifestBytes: Buffer.from('{}'), targetId: 'linux-x64', runtimeRoot: f.root,
		}), /build receipt/u);
		await writeFile(join(f.root, 'assistance/whisper-cpp/v1.9.3/linux-x64/whisper-cli'), 'replaced');
		await assert.rejects(verifyDesktopAssistanceRuntimeFamilyPackage({
			...result, targetId: 'linux-x64', runtimeRoot: f.root,
		}), /whisper-cpp engine failed authentication/u);
	} finally { await f.clean(); }
});

test('desktop packaging rejects a missing engine instead of shipping an unusable model catalog', async () => {
	const f = await fixture();
	try {
		await assert.rejects(stageDesktopAssistanceRuntimeFamilies({
			targetId: 'linux-x64', runtimeRoot: f.root,
			stageOnnx: () => f.stage('onnxruntime-node'),
			stageWhisper: () => Promise.resolve({ manifest: candidates.manifests['whisper-cpp'] }),
		}), /Cannot package whisper-cpp/u);
	} finally { await f.clean(); }
});

test('desktop packaging authenticates staged bytes instead of trusting the provisioner inventory', async () => {
	const f = await fixture();
	try {
		await assert.rejects(stageDesktopAssistanceRuntimeFamilies({
			targetId: 'linux-x64', runtimeRoot: f.root,
			stageOnnx: async () => {
				const result = await f.stage('onnxruntime-node');
				await writeFile(join(f.root, result.manifest.runtimePrefix, 'linux-x64/index.js'), 'tampered');
				return result;
			},
			stageWhisper: () => f.stage('whisper-cpp'),
		}), /Cannot package onnxruntime-node.*authentication/u);
	} finally { await f.clean(); }
});

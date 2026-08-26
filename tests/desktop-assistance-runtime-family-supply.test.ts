/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import runtimeSupply from '../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import {
	ASSISTANCE_RUNTIME_FAMILY_TARGETS,
	describeAssistanceRuntimeFamilyAvailability,
	type AssistanceRuntimeFamilyId,
	validateAssistanceRuntimeFamilyManifestV1,
} from '../desktop/assistance-runtime-family-manifest.ts';
import {
	validateMilestone7RuntimeSupplyRegister,
} from '../scripts/models/milestone-7-runtime-supply.mjs';

const FAMILY_IDS = Object.freeze([
	'onnxruntime-node', 'whisper-cpp', 'llama-cpp',
] as const satisfies readonly AssistanceRuntimeFamilyId[]);

test('the production register admits every runtime family only as a pending CPU closure', async () => {
	validateMilestone7RuntimeSupplyRegister(runtimeSupply);
	assert.deepEqual(Object.keys(runtimeSupply).sort(), [
		'manifests', 'productionPayloadsChanged', 'provisionTasks', 'registerId',
		'schemaVersion', 'sherpaWindowsArm64',
	]);
	assert.equal(runtimeSupply.schemaVersion, 1);
	assert.equal(runtimeSupply.registerId, 'assistance-runtime-family-supply-candidates-v1');
	assert.equal(runtimeSupply.productionPayloadsChanged, false);
	assert.deepEqual(Object.keys(runtimeSupply.manifests), FAMILY_IDS);

	for (const familyId of FAMILY_IDS) {
		const manifest = validateAssistanceRuntimeFamilyManifestV1(
			runtimeSupply.manifests[familyId],
		);
		assert.equal(manifest.familyId, familyId);
		assert.equal(manifest.executionProvider, 'cpu');
		assert.deepEqual(manifest.targets.map(({ id }) => id),
			ASSISTANCE_RUNTIME_FAMILY_TARGETS);
		assert.ok(manifest.targets.every(({ status }) => status === 'pending-external'));
		assert.ok(manifest.targets.every((target) =>
			target.status === 'pending-external' && !Object.hasOwn(target, 'files')));

		const availability = await describeAssistanceRuntimeFamilyAvailability({
			familyId,
			manifest,
			runtimeRoot: resolve('runtime-family-payload-must-not-be-read'),
			platform: 'linux',
			architecture: 'x64',
			totalMemoryBytes: 32 * 1024 ** 3,
		});
		assert.equal(availability.status, 'unavailable');
		if (availability.status === 'unavailable') {
			assert.equal(availability.reason, 'payload-pending-external');
			assert.match(availability.detail, /closure|inventory|toolchain/iu);
		}
	}
});

test('the runtime register rejects invented payload authority and foreign acceleration', () => {
	const fabricated = structuredClone(runtimeSupply);
	Object.assign(fabricated.provisionTasks[0], { payloadManifestSha256: 'ab'.repeat(32) });
	assert.throws(() => validateMilestone7RuntimeSupplyRegister(fabricated),
		/payload|claim|pending/iu);
	const gpu = structuredClone(runtimeSupply);
	gpu.manifests['onnxruntime-node'].executionProvider = 'cuda' as never;
	assert.throws(() => validateMilestone7RuntimeSupplyRegister(gpu),
		/identity|CPU|payload/iu);
	const smuggledFile = structuredClone(runtimeSupply);
	Object.assign(smuggledFile.manifests['whisper-cpp'].targets[0], {
		entrypoint: 'whisper-cli', files: [],
	});
	assert.throws(() => validateMilestone7RuntimeSupplyRegister(smuggledFile),
		/exact|record|target/iu);
});

test('runtime provision tasks pin upstream identity without claiming build closure', () => {
	assert.deepEqual(runtimeSupply.provisionTasks.map(({ familyId }) => familyId), FAMILY_IDS);
	for (const task of runtimeSupply.provisionTasks) {
		assert.equal(task.schemaVersion, 1);
		assert.match(task.id, /^provision-(?:onnxruntime-node|whisper-cpp|llama-cpp)-/u);
		assert.match(task.source.commit, /^[a-f\d]{40}$/u);
		assert.match(task.source.url, /^https:\/\/(?:github\.com|registry\.npmjs\.org)\//u);
		assert.deepEqual(task.targetIds, ASSISTANCE_RUNTIME_FAMILY_TARGETS);
		assert.equal(task.executionProvider, 'cpu');
		assert.equal(task.toolchain.status, 'lock-pending-external');
		assert.equal(task.toolchain.lockFile, null);
		assert.equal(task.toolchain.sha256, null);
		assert.equal(task.payloadStatus, 'pending-external');
		assert.equal(task.payloadManifestSha256, null);
		assert.match(task.blockedBy, /toolchain|closure|manifest/iu);
		assert.deepEqual(task.steps, [
			'fetch-pinned-source',
			'build-or-extract-cpu-target',
			'inventory-regular-files',
			'sha256-every-file',
			'pack-immutable-runtime-prefix',
			'public-readback',
			'externally-sign-manifest',
		]);
	}
	const onnx = runtimeSupply.provisionTasks[0];
	assert.equal(onnx.source.commit, '2e2543fbe9fae542f921d47a72d21d5a4ef0b710');
	assert.equal(onnx.source.integrity,
		'sha512-WjiVVB72riILz8HbYvxvmjKyE/WmkYoSfKY++axo5jAR609HQg8MwiG/HhShpTcJfmmAdzxxmB+MMST3A+SiPA==');
	assert.equal(runtimeSupply.provisionTasks[1].source.commit,
		'371b5a7561823ab2bb32142d2751e35e7534727b');
	assert.equal(runtimeSupply.provisionTasks[2].source.commit,
		'fe8156f789011f6ea0baf6917ea09f88b89d9554');
});

test('Sherpa Windows ARM64 records the official native input but not a Node payload', () => {
	const candidate = runtimeSupply.sherpaWindowsArm64;
	assert.deepEqual({
		runtimeId: candidate.runtimeId,
		version: candidate.version,
		targetId: candidate.targetId,
		commit: candidate.source.commit,
		payloadStatus: candidate.payloadStatus,
		payloadManifestSha256: candidate.payloadManifestSha256,
	}, {
		runtimeId: 'sherpa-onnx-node',
		version: '1.13.5',
		targetId: 'win-arm64',
		commit: '3dc7c569f31ca2cd4a20ed6f7db780327e6714c5',
		payloadStatus: 'pending-external',
		payloadManifestSha256: null,
	});
	assert.deepEqual(candidate.upstreamNativeAsset, {
		url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.5/sherpa-onnx-v1.13.5-win-arm64-shared-MD-Release-no-tts-lib.tar.bz2',
		fileName: 'sherpa-onnx-v1.13.5-win-arm64-shared-MD-Release-no-tts-lib.tar.bz2',
		byteLength: 6_419_409,
		sha256: '42112e75ca3baf647047929f704960587cf6ed22fbd046643d66d33d7c74c123',
	});
	assert.match(candidate.blockedBy, /Node.*addon.*closure/iu);
});

test('desktop packaging carries the same register that production startup imports', async () => {
	const prepare = await readFile(new URL('../scripts/desktop-prepare.mjs', import.meta.url), 'utf8');
	assert.match(prepare,
		/'config\/assistance-runtime-family-supply-candidates\.json'/u);
});

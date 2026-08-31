/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import runtimeSupply from '../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import checkedCatalog from '../config/local-model-catalog.json' with { type: 'json' };
import executionRegister from '../config/milestone-7-model-conversion-execution.json' with { type: 'json' };
import catalogTasks from '../config/milestone-7-model-catalog-tasks.json' with { type: 'json' };
import parityFixtures from '../config/milestone-7-model-parity-fixtures.json' with { type: 'json' };
import modelSupply from '../config/milestone-7-model-supply-candidates.json' with { type: 'json' };
import {
	validateMilestone7ModelCatalogTaskRegister,
} from '../scripts/models/milestone-7-model-catalog-tasks.mjs';

const FIVE_PLATFORMS = Object.freeze([
	'darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64',
]);

function validate(value = catalogTasks) {
	return validateMilestone7ModelCatalogTaskRegister(value, {
		modelSupply,
		parityFixtures,
		conversionExecution: executionRegister,
		runtimeSupply,
		offeredModelIds: checkedCatalog.entries.map(({ modelId }) => modelId),
	});
}

function clone(value) {
	return structuredClone(value);
}

test('seven pending catalog tasks map every Milestone 7 supply identity exactly', () => {
	const register = validate();
	assert.deepEqual(register.tasks.map(({ catalogModelId }) => catalogModelId), [
		'wav2vec2-base-960h',
		'tiger-dnr',
		'panns-cnn10',
		'beat-this-small0',
		'beat-this-final0',
		'transnetv2',
		'qwen3-4b-q4-k-m',
	]);
	assert.deepEqual(register.tasks.map(({ task }) => task), [
		'word-alignment', 'source-separation', 'audio-tagging', 'beat-tracking',
		'beat-tracking', 'shot-detection', 'editorial-generation',
	]);
	for (const task of register.tasks) {
		assert.deepEqual(task.platforms, FIVE_PLATFORMS);
		assert.equal(task.catalogStatus, 'pending-external');
		assert.equal(task.activationStatus, 'pending-external');
		assert.ok(!task.catalogBlockedBy.includes('licensing-evidence'));
		assert.ok(!Object.keys(task).some((field) => /releaseReview/iu.test(field)));
		assert.ok(task.catalogBlockedBy.includes('immutable-public-readback'));
		assert.ok(task.catalogBlockedBy.includes('external-catalog-signature'));
		assert.ok(task.activationBlockedBy.includes('runtime-target-closure'));
		assert.ok(!checkedCatalog.entries.some(({ modelId }) =>
			modelId === task.catalogModelId));
	}
});

test('direct wav2vec2 and Qwen tasks retain exact immutable artifact pins', () => {
	const register = validate();
	const wav2vec = register.tasks[0];
	assert.deepEqual(wav2vec.supplyBinding, {
		kind: 'direct-pin', supplyId: 'wav2vec2-base-960h-english-alignment',
	});
	assert.deepEqual(wav2vec.artifacts, [{
		role: 'model', sourceFileName: 'onnx/model.onnx',
		distributionFileName: 'model.onnx', byteLength: 377_887_594,
		sha256: 'b73fe60ddcd3fd07f91d65d50b4f10ba99039104c4fb5db5bdafbb27610bb6eb',
	}]);
	const qwen = register.tasks[6];
	assert.equal(qwen.minimumMemoryBytes, 16 * 1024 ** 3);
	assert.equal(qwen.runtimeFamily, 'llama-cpp');
	assert.deepEqual(qwen.artifacts, [{
		role: 'model', sourceFileName: 'Qwen3-4B-Q4_K_M.gguf',
		distributionFileName: 'model.gguf', byteLength: 2_497_280_256,
		sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
	}]);
});

test('derived tasks split grouped conversions into install-safe catalog artifacts', () => {
	const register = validate();
	const byId = new Map(register.tasks.map((entry) => [entry.catalogModelId, entry]));
	assert.deepEqual(byId.get('tiger-dnr').artifacts, [{
		role: 'network', sourceFileName: 'tiger-dnr.onnx',
		distributionFileName: 'network.onnx', byteLength: null, sha256: null,
	}]);
	assert.deepEqual(byId.get('transnetv2').artifacts, [{
		role: 'network', sourceFileName: 'transnetv2.onnx',
		distributionFileName: 'network.onnx', byteLength: null, sha256: null,
	}]);
	assert.deepEqual(byId.get('panns-cnn10').artifacts, [{
		role: 'panns-cnn10', sourceFileName: 'panns-cnn10.onnx',
		distributionFileName: 'panns-cnn10.onnx', byteLength: null, sha256: null,
	}]);
	assert.deepEqual(byId.get('panns-cnn10').sourceAuthorities, [{
		role: 'audioset-class-map',
		fileName: 'class_labels_indices.csv',
		url: 'https://raw.githubusercontent.com/qiuqiangkong/audioset_tagging_cnn/d2f4b8c18eab44737fcc0de1248ae21eb43f6aa4/metadata/class_labels_indices.csv',
		revision: 'd2f4b8c18eab44737fcc0de1248ae21eb43f6aa4',
		byteLength: 14_675,
		integrity: {
			algorithm: 'sha256',
			value: 'cdd1049833c4b86127c2773ac0d14a2754b6a6d0d1798002ed5c66e699708429',
		},
		catalogDistribution: false,
	}]);
	for (const task of register.tasks.filter(({ catalogModelId }) =>
		catalogModelId !== 'panns-cnn10')) {
		assert.deepEqual(task.sourceAuthorities, []);
	}
	assert.equal(byId.get('beat-this-small0').installTier, 'baseline');
	assert.equal(byId.get('beat-this-final0').installTier, 'optional-quality');
	assert.deepEqual([
		byId.get('beat-this-small0').supplyBinding.outputRole,
		byId.get('beat-this-final0').supplyBinding.outputRole,
	], ['small0-network', 'final0-network']);
	for (const id of ['tiger-dnr', 'panns-cnn10', 'beat-this-small0',
		'beat-this-final0', 'transnetv2']) {
		const task = byId.get(id);
		assert.ok(task.catalogBlockedBy.includes('converted-artifact-identity'));
		assert.ok(task.catalogBlockedBy.includes('source-framework-parity'));
		const recipe = executionRegister.recipes.find(({ candidateId }) =>
			candidateId === task.supplyBinding.supplyId);
		for (const blocker of recipe.blockedBy) {
			assert.ok(task.catalogBlockedBy.includes(blocker),
				`${id} must retain its conversion-recipe blocker ${blocker}`);
		}
	}
});

test('task validation rejects optimistic publication, invented outputs, and platform drift', () => {
	const optimistic = clone(catalogTasks);
	optimistic.tasks[0].catalogStatus = 'ready';
	assert.throws(() => validate(optimistic), /catalogStatus|pending|blocker/iu);

	const invented = clone(catalogTasks);
	invented.tasks[1].artifacts[0].sha256 = 'ab'.repeat(32);
	assert.throws(() => validate(invented), /artifact|conversion|identity|pending/iu);

	const substitutedClassMap = clone(catalogTasks);
	substitutedClassMap.tasks[2].sourceAuthorities[0].integrity.value = 'cd'.repeat(32);
	assert.throws(() => validate(substitutedClassMap), /class.map|source|authorit|identity/iu);

	const weakQwen = clone(catalogTasks);
	weakQwen.tasks[6].minimumMemoryBytes = 8 * 1024 ** 3;
	assert.throws(() => validate(weakQwen), /memory|Qwen|identity/iu);

	const extraPlatform = clone(catalogTasks);
	extraPlatform.tasks[2].platforms.push('darwin-x64');
	assert.throws(() => validate(extraPlatform), /platform|target/iu);

	const omittedBlocker = clone(catalogTasks);
	omittedBlocker.tasks[5].activationBlockedBy =
		omittedBlocker.tasks[5].activationBlockedBy.filter((value) =>
			value !== 'runtime-target-closure');
	assert.throws(() => validate(omittedBlocker), /activationBlockedBy|blocker/iu);
});

test('the catalog-task verifier is non-activating and reports every external blocker', () => {
	const result = spawnSync(process.execPath,
		['scripts/models/verify-milestone-7-model-catalog-tasks.mjs'], {
			cwd: new URL('..', import.meta.url), encoding: 'utf8',
		});
	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(report.schemaVersion, 1);
	assert.equal(report.productionCatalogChanged, false);
	assert.equal(report.tasks.length, 7);
	assert.ok(report.tasks.every(({ catalogStatus }) => catalogStatus === 'pending-external'));
	assert.ok(report.tasks.every(({ activationBlockedBy }) =>
		activationBlockedBy.includes('runtime-target-closure')));
});

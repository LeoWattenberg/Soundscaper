/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import parityFixtures from '../config/milestone-7-model-parity-fixtures.json' with { type: 'json' };
import modelSupply from '../config/milestone-7-model-supply-candidates.json' with { type: 'json' };
import {
	canonicalMilestone7ConversionPlan,
	validateMilestone7ModelSupplyRegister,
	validateMilestone7ParityEvidence,
	validateMilestone7ParityFixtureRegister,
} from '../scripts/models/milestone-7-model-supply.mjs';
import {
	createMilestone7ParityFixture,
} from '../scripts/models/milestone-7-parity-fixtures.mjs';

const SHA256 = 'ab'.repeat(32);
const OTHER_SHA256 = 'cd'.repeat(32);
const TOOLCHAIN_SHA256 = 'b6c5359c93248be4a840a7c5b3a59af393a3ec676f8a48787085acaf444d7f3a';
const EXPECTED_PLAN_SHA256 = Object.freeze({
	'tiger-dnr-neural-core': '83c625591151d8c73975ba32022ac7068b73cfd9dfee03eee379d6611d08cb28',
	'panns-cnn10': '03f4d0feb664ac4a409a126b6eb81efc94231475e9d1354fce5d3f725f4724fc',
	'beat-this': '3d9f0a1a130fece450c64c01cfc6393aef9b2ab02a6af9114709e553322b9497',
	transnetv2: '220564344d458cdf44ad5c10e7194e9469609735d4ec63a8617086daed9570eb',
});

function clone(value) {
	return structuredClone(value);
}

function candidate(register, id) {
	return register.candidates.find((entry) => entry.id === id);
}

function directPin(register, id) {
	return register.directPins.find((entry) => entry.id === id);
}

test('derived model supply keeps exact primary-source pins separate from pending conversions', () => {
	const register = validateMilestone7ModelSupplyRegister(modelSupply);
	assert.deepEqual(register.candidates.map(({ id }) => id), [
		'tiger-dnr-neural-core', 'panns-cnn10', 'beat-this', 'transnetv2',
	]);
	assert.deepEqual(register.candidates.map(({ sourceStatus }) => sourceStatus),
		Array(4).fill('source-pinned'));
	assert.deepEqual(register.candidates.map(({ conversion }) => conversion.status),
		Array(4).fill('converted-artifact-pending'));

	const tiger = candidate(register, 'tiger-dnr-neural-core');
	assert.equal(tiger.source.code.revision, '9f18d4a10a7137e1ce8052cfb62215179f1287b6');
	assert.equal(tiger.source.artifacts[0].revision,
		'b7a59560bbca10febbcd46fb01600f868e587f57');
	assert.deepEqual(tiger.conversion.recipe.ownedRuntimeStages,
		['stft', 'istft', 'overlap-add']);
	assert.deepEqual(tiger.conversion.outputs.map(({ role, fileName }) => ({ role, fileName })), [
		{ role: 'network', fileName: 'tiger-dnr.onnx' },
	]);

	const panns = candidate(register, 'panns-cnn10');
	assert.equal(panns.source.code.revision, 'd2f4b8c18eab44737fcc0de1248ae21eb43f6aa4');
	assert.deepEqual(panns.source.artifacts.map(({ role }) => role),
		['cnn10-checkpoint', 'audioset-class-map']);
	assert.deepEqual(panns.source.artifacts[1].integrity, {
		algorithm: 'sha256',
		value: 'cdd1049833c4b86127c2773ac0d14a2754b6a6d0d1798002ed5c66e699708429',
	});
	assert.equal(panns.conversion.recipe.input.sampleRateHz, 32_000);
	assert.equal(panns.conversion.recipe.graph.outputs[0].dimensions[1], 527);

	const beat = candidate(register, 'beat-this');
	assert.equal(beat.source.code.revision, 'ad7974846029835307ba19a3d5cefbf40b243041');
	assert.deepEqual(beat.source.artifacts.map(({ role, required }) => ({ role, required })), [
		{ role: 'small0-checkpoint', required: true },
		{ role: 'final0-checkpoint', required: false },
	]);
	assert.deepEqual(beat.source.artifacts.map(({ revision }) => revision),
		['v1.1.0', 'v1.1.0']);
	assert.deepEqual(beat.conversion.recipe.input, {
		sampleRateHz: 22_050, channels: 'mono', sampleEncoding: 'float32',
	});
	assert.equal(beat.conversion.recipe.graph.inputs[0].dimensions[2], 128);

	const transnet = candidate(register, 'transnetv2');
	assert.equal(transnet.source.code.revision, '85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed');
	assert.deepEqual(transnet.conversion.recipe.graph.inputs[0], {
		name: 'frames', dataType: 'uint8', dimensions: ['batch', 100, 27, 48, 3],
	});
	assert.deepEqual(transnet.conversion.recipe.sourceFrameworks,
		['tensorflow', 'pytorch']);
});

test('every derived recipe is CPU-only ONNX and cannot imply an unbuilt artifact', () => {
	const register = validateMilestone7ModelSupplyRegister(modelSupply);
	for (const row of register.candidates) {
		assert.deepEqual(row.conversion.recipe.onnx, {
			opset: 17,
			executionProvider: 'cpu',
			externalData: false,
			customOperators: false,
			deterministicAlgorithms: true,
		});
		assert.equal(row.conversion.recipe.toolchain.status, 'locked');
		assert.equal(row.conversion.recipe.toolchain.lockFile,
			'scripts/models/milestone-7-conversion-tool/uv.lock');
		assert.equal(row.conversion.recipe.toolchain.sha256, TOOLCHAIN_SHA256);
		for (const output of row.conversion.outputs) {
			assert.equal(output.byteLength, null);
			assert.equal(output.sha256, null);
		}
		assert.equal(canonicalMilestone7ConversionPlan(register, row.id).sha256,
			EXPECTED_PLAN_SHA256[row.id]);
	}

	const gpu = clone(modelSupply);
	gpu.candidates[0].conversion.recipe.onnx.executionProvider = 'cuda';
	assert.throws(() => validateMilestone7ModelSupplyRegister(gpu), /CPU|provider|ONNX/iu);
	const fabricated = clone(modelSupply);
	fabricated.candidates[0].conversion.outputs[0].sha256 = SHA256;
	assert.throws(() => validateMilestone7ModelSupplyRegister(fabricated),
		/pending|digest|artifact/iu);
	const changedSource = clone(modelSupply);
	changedSource.candidates[2].source.artifacts[0].integrity.value = OTHER_SHA256.slice(0, 40);
	assert.throws(() => validateMilestone7ModelSupplyRegister(changedSource),
		/source.*artifact|closure|pin/iu);
});

test('wav2vec and Qwen identity pins remain non-activated direct candidates', () => {
	const register = validateMilestone7ModelSupplyRegister(modelSupply);
	const wav2vec = directPin(register, 'wav2vec2-base-960h-english-alignment');
	assert.equal(wav2vec.revision, '6d2b9ffaac8aabc45934584ee608c5fb5ee34a4e');
	assert.deepEqual(wav2vec.artifact, {
		fileName: 'onnx/model.onnx', byteLength: 377_887_594,
		sha256: 'b73fe60ddcd3fd07f91d65d50b4f10ba99039104c4fb5db5bdafbb27610bb6eb',
	});
	const qwen = directPin(register, 'qwen3-4b-q4-k-m');
	assert.equal(qwen.revision, 'bc640142c66e1fdd12af0bd68f40445458f3869b');
	assert.deepEqual(qwen.artifact, {
		fileName: 'Qwen3-4B-Q4_K_M.gguf', byteLength: 2_497_280_256,
		sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
	});
	assert.equal(qwen.minimumSystemMemoryBytes, 16 * 1024 ** 3);
	assert.ok(register.directPins.every(({ activationStatus }) =>
		activationStatus === 'catalog-publication-pending'));
});

test('parity fixture inputs reproduce exact bytes while evidence remains pending', () => {
	const supply = validateMilestone7ModelSupplyRegister(modelSupply);
	const fixtures = validateMilestone7ParityFixtureRegister(parityFixtures, supply);
	assert.deepEqual(fixtures.fixtures.map(({ candidateId }) => candidateId),
		supply.candidates.map(({ id }) => id));
	for (const fixture of fixtures.fixtures) {
		const bytes = createMilestone7ParityFixture(fixture.generator);
		assert.equal(bytes.byteLength, fixture.input.byteLength);
		assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.input.sha256);
		assert.equal(fixture.evidenceStatus, 'pending-external');
		assert.equal(fixture.evidenceSha256, null);
		assert.ok(fixture.comparisons.length >= 1);
	}
});

test('parity evidence is exact, threshold-bound, and cannot bless pending artifacts', () => {
	const supply = validateMilestone7ModelSupplyRegister(modelSupply);
	const fixtures = validateMilestone7ParityFixtureRegister(parityFixtures, supply);
	const fixture = fixtures.fixtures.find(({ candidateId }) => candidateId === 'panns-cnn10');
	const pending = candidate(supply, fixture.candidateId);
	const evidence = {
		schemaVersion: 1, candidateId: fixture.candidateId, fixtureId: fixture.id,
		recipeVersion: pending.conversion.recipe.version,
		convertedArtifacts: pending.conversion.outputs.map(({ role }) => ({
			role, byteLength: 1, sha256: SHA256,
		})),
		runs: fixture.frameworks.map((framework) => ({
			framework,
			outputs: fixture.outputRoles.map((role) => ({ role, byteLength: 1, sha256: OTHER_SHA256 })),
		})),
		comparisons: fixture.comparisons.map((comparison) => ({ ...comparison, observed: 0 })),
	};
	assert.throws(() => validateMilestone7ParityEvidence(evidence, fixture, pending),
		/pending|converted artifact/iu);
	const ready = clone(pending);
	ready.conversion.status = 'converted-artifact-ready';
	ready.conversion.blockedBy = null;
	ready.conversion.recipe.toolchain = {
		status: 'locked', lockFile: 'toolchains/panns-cnn10.lock', sha256: SHA256,
		blockedBy: null,
	};
	ready.conversion.outputs = evidence.convertedArtifacts.map((output, index) => ({
		...ready.conversion.outputs[index], ...output,
	}));
	assert.equal(validateMilestone7ParityEvidence(evidence, fixture, ready).fixtureId, fixture.id);
	const exceeded = clone(evidence);
	exceeded.comparisons[0].observed = exceeded.comparisons[0].maximum + 1;
	assert.throws(() => validateMilestone7ParityEvidence(exceeded, fixture, ready),
		/threshold|parity/iu);
});

test('the deterministic verifier reports pins and blockers without producing artifacts', () => {
	const result = spawnSync(process.execPath,
		['scripts/models/verify-milestone-7-model-supply.mjs'], {
			cwd: new URL('..', import.meta.url), encoding: 'utf8',
		});
	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(report.schemaVersion, 1);
	assert.deepEqual(report.candidates.map(({ status }) => status),
		Array(4).fill('converted-artifact-pending'));
	assert.equal(report.parityFixtures.every(({ status }) => status === 'pending-external'), true);
	assert.equal(report.productionCatalogChanged, false);
	assert.deepEqual(report.runtimeFamilies.map(({ status }) => status),
		Array(3).fill('pending-external'));
	assert.equal(report.sherpaWindowsArm64.status, 'pending-external');
});

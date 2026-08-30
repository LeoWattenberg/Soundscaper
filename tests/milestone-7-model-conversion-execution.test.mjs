/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import executionRegister from '../config/milestone-7-model-conversion-execution.json' with { type: 'json' };
import parityFixtures from '../config/milestone-7-model-parity-fixtures.json' with { type: 'json' };
import modelSupply from '../config/milestone-7-model-supply-candidates.json' with { type: 'json' };
import {
	canonicalMilestone7ConversionExecutionPlan,
	validateMilestone7ConversionEvidence,
	validateMilestone7ConversionExecutionRegister,
	verifyPinnedConversionEvidenceFiles,
} from '../scripts/models/milestone-7-conversion-execution.mjs';
import { canonicalMilestone7ConversionPlan } from
	'../scripts/models/milestone-7-model-supply.mjs';

const SHA256 = 'ab'.repeat(32);
const OTHER_SHA256 = 'cd'.repeat(32);

function clone(value) {
	return structuredClone(value);
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) =>
			`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

test('conversion execution recipes bind the four pinned supply candidates exactly', () => {
	const register = validateMilestone7ConversionExecutionRegister(
		executionRegister, modelSupply, parityFixtures,
	);

	assert.deepEqual(register.recipes.map(({ candidateId }) => candidateId), [
		'tiger-dnr-neural-core', 'panns-cnn10', 'beat-this', 'transnetv2',
	]);
	for (const recipe of register.recipes) {
		assert.equal(recipe.evidenceStatus, 'pending-external');
		assert.ok(recipe.blockedBy.includes('source-code-archive-identity'));
		assert.equal(recipe.blockedBy.includes('toolchain-lock'), false);
		assert.equal(modelSupply.candidates.find(({ id }) => id === recipe.candidateId)
			.conversion.recipe.toolchain.status, 'locked');
		assert.ok(recipe.blockedBy.includes('converted-output-identity'));
		assert.ok(recipe.blockedBy.includes('source-framework-parity'));
		assert.equal(recipe.sourceCode.archive.byteLength, null);
		assert.equal(recipe.sourceCode.archive.sha256, null);
		assert.equal(recipe.commands.length, 2);
		assert.deepEqual(recipe.commands.map(({ id }) => id), ['convert', 'parity']);
		for (const command of recipe.commands) {
			assert.equal(command.program, 'python3');
			assert.equal(command.shell, false);
			assert.equal(command.network, 'forbidden');
			assert.equal(command.gpu, 'forbidden');
			assert.equal(command.argv.slice(0, 4).join(' '),
				'-I -B -m soundscaper_m7_conversion');
			assert.ok(command.argv.includes(recipe.candidateId));
			assert.ok(command.argv.includes(recipe.conversionPlanSha256));
		}
		assert.match(canonicalMilestone7ConversionExecutionPlan(register, recipe.candidateId).sha256,
			/^[a-f\d]{64}$/u);
	}
});

test('weak upstream checksums require a separately retained SHA-256 readback', () => {
	const register = validateMilestone7ConversionExecutionRegister(
		executionRegister, modelSupply, parityFixtures,
	);
	const panns = register.recipes.find(({ candidateId }) => candidateId === 'panns-cnn10');
	const beats = register.recipes.find(({ candidateId }) => candidateId === 'beat-this');
	const tiger = register.recipes.find(({ candidateId }) =>
		candidateId === 'tiger-dnr-neural-core');

	assert.equal(panns.sourceArtifacts[0].upstreamIntegrity.algorithm, 'md5');
	assert.equal(panns.sourceArtifacts[0].sha256Readback, null);
	assert.ok(panns.blockedBy.includes('source-artifact-sha256-readback'));
	assert.deepEqual(beats.sourceArtifacts.map(({ upstreamIntegrity }) =>
		upstreamIntegrity.algorithm), ['sha1', 'sha1']);
	assert.ok(beats.sourceArtifacts.every(({ sha256Readback }) => sha256Readback === null));
	assert.equal(tiger.sourceArtifacts[0].sha256Readback,
		tiger.sourceArtifacts[0].upstreamIntegrity.value);
});

test('commands, source pins, output manifests, and blockers fail closed on drift', () => {
	const shell = clone(executionRegister);
	shell.recipes[0].commands[0].shell = true;
	assert.throws(() => validateMilestone7ConversionExecutionRegister(
		shell, modelSupply, parityFixtures,
	), /command|shell|deterministic/iu);

	const substituted = clone(executionRegister);
	substituted.recipes[1].sourceArtifacts[1].sha256Readback = OTHER_SHA256;
	assert.throws(() => validateMilestone7ConversionExecutionRegister(
		substituted, modelSupply, parityFixtures,
	), /source artifact|readback|SHA-256/iu);

	const invented = clone(executionRegister);
	invented.recipes[2].outputManifest.artifacts[0].sha256 = SHA256;
	assert.throws(() => validateMilestone7ConversionExecutionRegister(
		invented, modelSupply, parityFixtures,
	), /converted|output|pending|identity/iu);

	const understated = clone(executionRegister);
	understated.recipes[3].blockedBy = understated.recipes[3].blockedBy
		.filter((value) => value !== 'source-framework-parity');
	assert.throws(() => validateMilestone7ConversionExecutionRegister(
		understated, modelSupply, parityFixtures,
	), /blockedBy|blocker/iu);
});

test('today\'s pending register cannot admit fabricated conversion evidence', () => {
	const register = validateMilestone7ConversionExecutionRegister(
		executionRegister, modelSupply, parityFixtures,
	);
	const recipe = register.recipes[0];
	const evidence = {
		schemaVersion: 1,
		candidateId: recipe.candidateId,
		executionPlanSha256:
			canonicalMilestone7ConversionExecutionPlan(register, recipe.candidateId).sha256,
		toolchain: { lockFile: 'toolchains/locked.txt', sha256: SHA256 },
		sourceCodeArchive: {
			path: 'source-code.tar.gz', byteLength: 1, sha256: SHA256,
		},
		sourceArtifacts: recipe.sourceArtifacts.map(({ role, fileName, byteLength }) => ({
			role, path: fileName, byteLength, sha256: SHA256,
		})),
		commandRuns: recipe.commands.map(({ id, sha256 }) => ({
			id, commandSha256: sha256, exitCode: 0,
			stdout: { path: `${id}.stdout`, byteLength: 1, sha256: SHA256 },
			stderr: { path: `${id}.stderr`, byteLength: 1, sha256: SHA256 },
		})),
		convertedArtifacts: recipe.outputManifest.artifacts.map(({ role, fileName }) => ({
			role, path: fileName, byteLength: 1, sha256: SHA256,
		})),
		parityEvidence: {},
	};

	assert.throws(() => validateMilestone7ConversionEvidence(evidence, {
		executionRegister: register,
		modelSupply,
		parityFixtures,
	}), /pending|cannot admit|release evidence/iu);
});

test('complete exact identities admit one bounded retained evidence record', () => {
	const supply = clone(modelSupply);
	const fixtures = clone(parityFixtures);
	const execution = clone(executionRegister);
	const candidate = supply.candidates[1];
	const fixture = fixtures.fixtures[1];
	const recipe = execution.recipes[1];
	const emptySha256 = createHash('sha256').update('').digest('hex');

	candidate.conversion.status = 'converted-artifact-ready';
	candidate.conversion.blockedBy = null;
	candidate.conversion.recipe.toolchain = {
		status: 'locked',
		lockFile: 'toolchains/panns-cnn10.lock',
		sha256: SHA256,
		blockedBy: null,
	};
	candidate.conversion.outputs = candidate.conversion.outputs.map((output, index) => ({
		...output, byteLength: index + 101, sha256: index === 0 ? SHA256 : OTHER_SHA256,
	}));
	const planSha256 = canonicalMilestone7ConversionPlan(supply, candidate.id).sha256;
	recipe.commands = recipe.commands.map((command) => ({
		...command,
		argv: command.argv.map((value) =>
			value === recipe.conversionPlanSha256 ? planSha256 : value),
	}));
	recipe.conversionPlanSha256 = planSha256;
	recipe.sourceCode.archive.byteLength = 123;
	recipe.sourceCode.archive.sha256 = OTHER_SHA256;
	recipe.sourceArtifacts[0].sha256Readback = SHA256;
	recipe.outputManifest.status = 'verified';
	recipe.outputManifest.artifacts = clone(candidate.conversion.outputs);

	const parityEvidence = {
		schemaVersion: 1,
		candidateId: candidate.id,
		fixtureId: fixture.id,
		recipeVersion: candidate.conversion.recipe.version,
		convertedArtifacts: candidate.conversion.outputs.map(({ role, byteLength, sha256 }) => ({
			role, byteLength, sha256,
		})),
		runs: fixture.frameworks.map((framework) => ({
			framework,
			outputs: fixture.outputRoles.map((role) => ({
				role, byteLength: 4, sha256: OTHER_SHA256,
			})),
		})),
		comparisons: fixture.comparisons.map((comparison) => ({
			...comparison, observed: 0,
		})),
	};
	const paritySha256 = createHash('sha256')
		.update(canonicalJson(parityEvidence)).digest('hex');
	fixture.evidenceStatus = 'verified';
	fixture.evidenceSha256 = paritySha256;
	fixture.blockedBy = null;
	recipe.parity.status = 'verified';
	recipe.parity.evidenceSha256 = paritySha256;
	recipe.evidenceStatus = 'verified';
	recipe.blockedBy = [];

	const register = validateMilestone7ConversionExecutionRegister(
		execution, supply, fixtures,
	);
	const admittedRecipe = register.recipes[1];
	const evidence = {
		schemaVersion: 1,
		candidateId: candidate.id,
		executionPlanSha256:
			canonicalMilestone7ConversionExecutionPlan(register, candidate.id).sha256,
		toolchain: { lockFile: 'toolchains/panns-cnn10.lock', sha256: SHA256 },
		sourceCodeArchive: {
			path: recipe.sourceCode.archive.fileName,
			byteLength: recipe.sourceCode.archive.byteLength,
			sha256: recipe.sourceCode.archive.sha256,
		},
		sourceArtifacts: admittedRecipe.sourceArtifacts.map((artifact) => ({
			role: artifact.role,
			path: artifact.fileName,
			byteLength: artifact.byteLength,
			sha256: artifact.sha256Readback,
		})),
		commandRuns: admittedRecipe.commands.map((command) => ({
			id: command.id,
			commandSha256: command.sha256,
			exitCode: 0,
			stdout: { path: `${command.id}.stdout`, byteLength: 0, sha256: emptySha256 },
			stderr: { path: `${command.id}.stderr`, byteLength: 0, sha256: emptySha256 },
		})),
		convertedArtifacts: admittedRecipe.outputManifest.artifacts.map((artifact) => ({
			role: artifact.role,
			path: artifact.fileName,
			byteLength: artifact.byteLength,
			sha256: artifact.sha256,
		})),
		parityEvidence,
	};

	const admitted = validateMilestone7ConversionEvidence(evidence, {
		executionRegister: register,
		modelSupply: supply,
		parityFixtures: fixtures,
	});
	assert.equal(admitted.candidateId, 'panns-cnn10');
	assert.equal(admitted.parityEvidence.comparisons.every(({ observed }) => observed === 0), true);
	assert.equal(admitted.files.length, 1 + 2 + 4 + 1 + 4);
	assert.deepEqual(admitted.parityOutputFiles.map(({ path }) => path), [
		'source-framework-runs/source-pytorch/clipwise-probabilities.f32le',
		'source-framework-runs/source-pytorch/embedding.f32le',
		'source-framework-runs/onnxruntime-cpu/clipwise-probabilities.f32le',
		'source-framework-runs/onnxruntime-cpu/embedding.f32le',
	]);

	const nonzero = clone(evidence);
	nonzero.commandRuns[0].exitCode = 1;
	assert.throws(() => validateMilestone7ConversionEvidence(nonzero, {
		executionRegister: register,
		modelSupply: supply,
		parityFixtures: fixtures,
	}), /command|exit/iu);
});

test('file verification rejects traversal, symlinks, wrong lengths, and wrong digests', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-m7-conversion-'));
	try {
		const bytes = Buffer.from('exact conversion evidence\n', 'utf8');
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		await writeFile(join(root, 'exact.bin'), bytes);
		assert.deepEqual(await verifyPinnedConversionEvidenceFiles(root, [{
			role: 'converted-model', path: 'exact.bin', byteLength: bytes.byteLength, sha256,
		}]), [{ path: 'exact.bin', byteLength: bytes.byteLength, sha256 }]);

		await assert.rejects(() => verifyPinnedConversionEvidenceFiles(root, [{
			path: '../outside.bin', byteLength: bytes.byteLength, sha256,
		}]), /relative|path|root/iu);
		await assert.rejects(() => verifyPinnedConversionEvidenceFiles(root, [{
			path: 'exact.bin', byteLength: bytes.byteLength + 1, sha256,
		}]), /length|size/iu);
		await assert.rejects(() => verifyPinnedConversionEvidenceFiles(root, [{
			path: 'exact.bin', byteLength: bytes.byteLength, sha256: OTHER_SHA256,
		}]), /digest|SHA-256/iu);
		await symlink(join(root, 'exact.bin'), join(root, 'linked.bin'));
		await assert.rejects(() => verifyPinnedConversionEvidenceFiles(root, [{
			path: 'linked.bin', byteLength: bytes.byteLength, sha256,
		}]), /file kind|symbolic|length/iu);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('the repository checker reports external work without manufacturing evidence', async () => {
	const result = spawnSync(process.execPath,
		['scripts/models/verify-milestone-7-conversion-execution.mjs'], {
			cwd: new URL('..', import.meta.url), encoding: 'utf8',
		});
	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(report.schemaVersion, 1);
	assert.equal(report.recipes.length, 4);
	assert.ok(report.recipes.every(({ status }) => status === 'pending-external'));
	assert.ok(report.recipes.every(({ outputArtifacts }) =>
		outputArtifacts.every(({ byteLength, sha256 }) =>
			byteLength === null && sha256 === null)));

	const source = await readFile(new URL(
		'../scripts/models/verify-milestone-7-conversion-execution.mjs', import.meta.url), 'utf8');
	assert.doesNotMatch(source, /https:\/\//u,
		'the checker must not fetch upstream or converted artifacts');
});

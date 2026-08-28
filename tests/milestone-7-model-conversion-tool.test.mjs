/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import executionRegister from '../config/milestone-7-model-conversion-execution.json' with { type: 'json' };
import parityFixtures from '../config/milestone-7-model-parity-fixtures.json' with { type: 'json' };
import { createMilestone7ParityFixture } from
	'../scripts/models/milestone-7-parity-fixtures.mjs';

const TOOL_ROOT = new URL('../scripts/models/milestone-7-conversion-tool/', import.meta.url);
const POLICY_ENVIRONMENT = Object.freeze({
	CUBLAS_WORKSPACE_CONFIG: ':4096:8', CUDA_VISIBLE_DEVICES: '', MKL_NUM_THREADS: '1',
	OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', PYTHONHASHSEED: '0',
	TF_DETERMINISTIC_OPS: '1',
});

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function run(args, cwd) {
	return spawnSync('python3', ['-B', '-m', 'soundscaper_m7_conversion', ...args], {
		cwd, encoding: 'utf8',
		env: { ...process.env, ...POLICY_ENVIRONMENT, PYTHONPATH: fileURLToPath(TOOL_ROOT) },
	});
}

function floats(values) {
	const body = Buffer.alloc(values.length * 4);
	values.forEach((value, index) => body.writeFloatLE(value, index * 4));
	return body;
}

test('the locked conversion frameworks stay outside every open advisory range', () => {
	const result = spawnSync('python3', ['-B', '-c', `
import json
from pathlib import Path
import tomllib

root = Path.cwd()
project = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
lock = tomllib.loads((root / "uv.lock").read_text(encoding="utf-8"))
direct = {}
for dependency in project["project"]["dependencies"]:
    name, separator, version = dependency.partition("==")
    if separator:
        direct[name] = version
locked = {}
for package in lock["package"]:
    locked.setdefault(package["name"], []).append(package["version"])
print(json.dumps({"direct": direct, "locked": locked}, sort_keys=True))
`], {
		cwd: fileURLToPath(TOOL_ROOT), encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr);
	const inventory = JSON.parse(result.stdout);
	assert.deepEqual(Object.fromEntries([
		'onnx', 'protobuf', 'tensorflow-cpu', 'tf2onnx', 'torch', 'torchaudio', 'torchvision',
	].map((name) => [name, inventory.direct[name]])), {
		onnx: '1.22.0',
		protobuf: '5.29.6',
		'tensorflow-cpu': '2.20.0',
		tf2onnx: '1.17.0',
		torch: '2.13.0',
		torchaudio: '2.11.0',
		torchvision: '0.28.0',
	});
	assert.deepEqual(inventory.locked.onnx, ['1.22.0']);
	assert.deepEqual(inventory.locked.protobuf, ['5.29.6']);
	assert.deepEqual(inventory.locked['tensorflow-cpu'], ['2.20.0']);
	assert.deepEqual(inventory.locked.tf2onnx, ['1.17.0']);
	assert.deepEqual(inventory.locked.torch, ['2.13.0', '2.13.0+cpu']);
	assert.deepEqual(inventory.locked.torchaudio, ['2.11.0', '2.11.0+cpu']);
	assert.deepEqual(inventory.locked.torchvision, ['0.28.0', '0.28.0+cpu']);
});

async function pannsParityWorkspace(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-m7-tool-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const fixture = parityFixtures.fixtures.find(({ candidateId }) => candidateId === 'panns-cnn10');
	const recipe = executionRegister.recipes.find(({ candidateId }) => candidateId === 'panns-cnn10');
	const fixtureBytes = createMilestone7ParityFixture(fixture.generator);
	const network = Buffer.from('deterministic fake ONNX graph\n', 'utf8');
	await Promise.all([
		writeFile(join(root, 'parity-fixture.bin'), fixtureBytes),
		writeFile(join(root, 'panns-cnn10.onnx'), network),
	]);
	await writeFile(join(root, 'converted-artifacts.json'), `${JSON.stringify({
		schemaVersion: 1, candidateId: 'panns-cnn10', planSha256: recipe.conversionPlanSha256,
		artifacts: [{ role: 'network', required: true, fileName: 'panns-cnn10.onnx',
			byteLength: network.byteLength, sha256: sha256(network) }],
	})}\n`);
	const outputs = Object.freeze({
		'clipwise-probabilities': floats(Array.from({ length: 527 }, (_, index) => index / 527)),
		embedding: floats(Array.from({ length: 512 }, (_, index) => index / 512 - 0.5)),
	});
	for (const framework of fixture.frameworks) {
		await mkdir(join(root, 'source-framework-runs', framework), { recursive: true });
		await Promise.all(Object.entries(outputs).map(([role, body]) =>
			writeFile(join(root, 'source-framework-runs', framework, `${role}.f32le`), body)));
	}
	return Object.freeze({ root, fixture, recipe, network, outputs });
}

test('the checked-in Python module exposes only the closed conversion protocol', () => {
	const result = run(['--help'], process.cwd());
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /convert/iu);
	assert.match(result.stdout, /parity/iu);
	assert.doesNotMatch(result.stdout, /download|https|shell/iu);
});

test('the Python candidate inventory stays exact with the registered execution plans', () => {
	const result = spawnSync('python3', ['-B', '-c',
		'import json; from soundscaper_m7_conversion.specs import CANDIDATES; '
		+ 'print(json.dumps(CANDIDATES, sort_keys=True, separators=(",", ":")))'], {
		cwd: process.cwd(), encoding: 'utf8',
		env: { ...process.env, PYTHONPATH: fileURLToPath(TOOL_ROOT) },
	});
	assert.equal(result.status, 0, result.stderr);
	const candidates = JSON.parse(result.stdout);
	for (const recipe of executionRegister.recipes) {
		const candidate = candidates[recipe.candidateId];
		const fixture = parityFixtures.fixtures.find(({ id }) => id === recipe.parity.fixtureId);
		assert.equal(candidate.plan, recipe.conversionPlanSha256);
		assert.equal(candidate.revision, recipe.sourceCode.revision);
		assert.equal(candidate.archive, recipe.sourceCode.archive.fileName);
		assert.deepEqual(candidate.artifacts.map(([role, required, fileName, byteLength]) =>
			({ role, required, fileName, byteLength })), recipe.sourceArtifacts.map((artifact) => ({
			role: artifact.role,
			required: recipe.candidateId === 'beat-this'
				? artifact.role === 'small0-checkpoint' : true,
			fileName: artifact.fileName, byteLength: artifact.byteLength,
		})));
		assert.deepEqual(candidate.outputs.map(([role, required, fileName]) =>
			({ role, required, fileName })), recipe.outputManifest.artifacts.map((artifact) => ({
			role: artifact.role, required: artifact.required, fileName: artifact.fileName,
		})));
		assert.deepEqual(candidate.fixture,
			[fixture.id, fixture.input.byteLength, fixture.input.sha256]);
		assert.deepEqual(candidate.frameworks, fixture.frameworks);
		assert.deepEqual(candidate.roles, fixture.outputRoles);
		assert.deepEqual(candidate.comparisons, fixture.comparisons.map((comparison) => [
			comparison.baseline, comparison.candidate, comparison.outputRole,
			comparison.metric, comparison.maximum,
		]));
	}
});

test('parity validates pinned fixture and framework outputs into canonical evidence',
	async (context) => {
		const workspace = await pannsParityWorkspace(context);
		const result = run([
			'parity', '--protocol', 'soundscaper-model-conversion-v1',
			'--candidate', 'panns-cnn10', '--plan-sha256', workspace.recipe.conversionPlanSha256,
			'--fixture', 'parity-fixture.bin', '--source-runs', 'source-framework-runs',
			'--converted-manifest', 'converted-artifacts.json', '--evidence', 'parity-evidence.json',
		], workspace.root);
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(JSON.parse(result.stdout), {
			schemaVersion: 1, candidateId: 'panns-cnn10', status: 'verified',
			evidence: 'parity-evidence.json',
		});
		const evidence = JSON.parse(await readFile(join(workspace.root, 'parity-evidence.json'), 'utf8'));
		assert.equal(evidence.schemaVersion, 1);
		assert.equal(evidence.fixtureId, workspace.fixture.id);
		assert.deepEqual(evidence.convertedArtifacts, [{ role: 'network',
			byteLength: workspace.network.byteLength, sha256: sha256(workspace.network) }]);
		assert.deepEqual(evidence.runs.map(({ framework }) => framework), workspace.fixture.frameworks);
		assert.ok(evidence.runs.every(({ outputs }) => outputs.every(({ role, byteLength, sha256: hash }) => {
			const body = workspace.outputs[role];
			return body !== undefined && byteLength === body.byteLength && hash === sha256(body);
		})));
		assert.ok(evidence.comparisons.every(({ observed }) => observed === 0));
	});

test('parity refuses non-finite output, converted corruption, and evidence overwrite',
	async (context) => {
		const nan = await pannsParityWorkspace(context);
		await writeFile(join(nan.root, 'source-framework-runs', 'onnxruntime-cpu',
			'clipwise-probabilities.f32le'), floats(Array.from({ length: 527 }, (_, index) =>
			index === 0 ? Number.NaN : index / 527)));
		const args = ['parity', '--protocol', 'soundscaper-model-conversion-v1',
			'--candidate', 'panns-cnn10', '--plan-sha256', nan.recipe.conversionPlanSha256,
			'--fixture', 'parity-fixture.bin', '--source-runs', 'source-framework-runs',
			'--converted-manifest', 'converted-artifacts.json', '--evidence', 'parity-evidence.json'];
		const nonfinite = run(args, nan.root);
		assert.notEqual(nonfinite.status, 0);
		assert.match(nonfinite.stderr, /finite|float/iu);

		const corrupt = await pannsParityWorkspace(context);
		await writeFile(join(corrupt.root, 'panns-cnn10.onnx'), Buffer.from('changed'));
		const changed = run(args, corrupt.root);
		assert.notEqual(changed.status, 0);
		assert.match(changed.stderr, /digest|length|artifact/iu);

		const complete = await pannsParityWorkspace(context);
		assert.equal(run(args, complete.root).status, 0);
		const overwrite = run(args, complete.root);
		assert.notEqual(overwrite.status, 0);
		assert.match(overwrite.stderr, /exists|overwrite|evidence/iu);
	});

test('convert authenticates source inputs before importing any exporter framework',
	async (context) => {
		const root = await mkdtemp(join(tmpdir(), 'soundscaper-m7-convert-contract-'));
		context.after(() => rm(root, { recursive: true, force: true }));
		const recipe = executionRegister.recipes.find(({ candidateId }) => candidateId === 'panns-cnn10');
		const archive = Buffer.from('not a source archive');
		const checkpoint = Buffer.from('not a checkpoint');
		const classMap = Buffer.from('not a class map');
		await Promise.all([
			writeFile(join(root, recipe.sourceCode.archive.fileName), archive),
			writeFile(join(root, 'Cnn10_mAP=0.380.pth'), checkpoint),
			writeFile(join(root, 'class_labels_indices.csv'), classMap),
		]);
		await writeFile(join(root, 'source-input-manifest.json'), `${JSON.stringify({
			schemaVersion: 1, protocol: 'soundscaper-model-conversion-v1',
			candidateId: 'panns-cnn10', planSha256: recipe.conversionPlanSha256,
			sourceCodeArchive: { path: recipe.sourceCode.archive.fileName,
				revision: recipe.sourceCode.revision, byteLength: archive.byteLength,
				sha256: sha256(archive) },
			sourceArtifacts: [
				{ role: 'cnn10-checkpoint', path: 'Cnn10_mAP=0.380.pth',
					byteLength: checkpoint.byteLength, sha256: sha256(checkpoint) },
				{ role: 'audioset-class-map', path: 'class_labels_indices.csv',
					byteLength: classMap.byteLength, sha256: sha256(classMap) },
			],
		})}\n`);
		const result = run(['convert', '--protocol', 'soundscaper-model-conversion-v1',
			'--candidate', 'panns-cnn10', '--plan-sha256', recipe.conversionPlanSha256,
			'--source-manifest', 'source-input-manifest.json',
			'--output-manifest', 'converted-artifacts.json'], root);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /byte length|upstream|source artifact/iu);
		assert.doesNotMatch(result.stderr, /torch|onnx|module/iu,
			'source custody must fail before any exporter dependency is imported');
	});

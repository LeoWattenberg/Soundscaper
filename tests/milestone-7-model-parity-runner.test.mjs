/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const TOOL_PATH = fileURLToPath(TOOL_ROOT);
const LOCK_PATH = fileURLToPath(new URL('uv.lock', TOOL_ROOT));
const POLICY_ENVIRONMENT = Object.freeze({
	CUBLAS_WORKSPACE_CONFIG: ':4096:8', CUDA_VISIBLE_DEVICES: '', MKL_NUM_THREADS: '1',
	OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', PYTHONHASHSEED: '0',
	TF_DETERMINISTIC_OPS: '1',
});

function python(args, cwd = process.cwd()) {
	return spawnSync('python3', ['-B', ...args], {
		cwd, encoding: 'utf8',
		env: { ...process.env, ...POLICY_ENVIRONMENT, PYTHONPATH: TOOL_PATH },
	});
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

test('the parity runner inventory is closed over all four conversion candidates', () => {
	const result = python(['-c',
		'import json; from soundscaper_m7_conversion.runner import RUNNER_INVENTORY; '
		+ 'print(json.dumps(RUNNER_INVENTORY, sort_keys=True, separators=(",", ":")))']);
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), {
		'beat-this': {
			fixtureKind: 'float32-wave', sourceFrameworks: ['source-pytorch'],
			onnxFramework: 'onnxruntime-cpu', runner: 'beat-this-small0-v1',
		},
		'panns-cnn10': {
			fixtureKind: 'float32-wave', sourceFrameworks: ['source-pytorch'],
			onnxFramework: 'onnxruntime-cpu', runner: 'panns-cnn10-v1',
		},
		'tiger-dnr-neural-core': {
			fixtureKind: 'float32-wave', sourceFrameworks: ['source-pytorch'],
			onnxFramework: 'onnxruntime-cpu', runner: 'tiger-dnr-neural-core-v1',
		},
		transnetv2: {
			fixtureKind: 'rgb24-vfr', sourceFrameworks: ['source-tensorflow', 'source-pytorch'],
			onnxFramework: 'onnxruntime-cpu', runner: 'transnetv2-v1',
		},
	});
});

test('the checked-in uv lock is digest-bound by the owned runner', async () => {
	const body = await readFile(LOCK_PATH);
	const result = python(['-c',
		'import json; from soundscaper_m7_conversion.toolchain import '
		+ 'TOOLCHAIN_LOCK_SHA256, REQUIRED_DISTRIBUTIONS; '
		+ 'print(json.dumps({"sha256":TOOLCHAIN_LOCK_SHA256,'
		+ '"requirements":REQUIRED_DISTRIBUTIONS},sort_keys=True,separators=(",",":")))']);
	assert.equal(result.status, 0, result.stderr);
	const identity = JSON.parse(result.stdout);
	assert.equal(identity.sha256, sha256(body));
	assert.deepEqual(Object.keys(identity.requirements).sort(), [
		'beat-this', 'panns-cnn10', 'tiger-dnr-neural-core', 'transnetv2',
	]);
	for (const dependencies of Object.values(identity.requirements)) {
		assert.ok(dependencies.length > 1);
		assert.ok(dependencies.every(({ name, version }) =>
			/^[a-z\d][a-z\d.-]*$/u.test(name) && /^\d+(?:\.\d+)+(?:\.post\d+)?(?:\+cpu)?$/u.test(version)));
	}
	assert.match(body.toString('utf8'), /name = "soundscaper-m7-conversion"/u);
	assert.match(body.toString('utf8'), /download\.pytorch\.org\/whl\/cpu/u);
	assert.doesNotMatch(body.toString('utf8'), /name = "(?:nvidia-|triton")/u);
});

test('owned fixture readers admit every pinned fixture and reject non-finite audio',
	async (context) => {
		const root = await mkdtemp(join(tmpdir(), 'soundscaper-m7-runner-fixtures-'));
		context.after(() => rm(root, { recursive: true, force: true }));
		const paths = [];
		for (const fixture of parityFixtures.fixtures) {
			const path = join(root, fixture.input.fileName);
			await writeFile(path, createMilestone7ParityFixture(fixture.generator));
			paths.push([fixture.candidateId, path]);
		}
		const result = python(['-c',
			'import json,sys; from pathlib import Path; '
			+ 'from soundscaper_m7_conversion.runner_io import inspect_fixture; '
			+ 'from soundscaper_m7_conversion.specs import CANDIDATES; '
			+ 'rows=json.loads(sys.argv[1]); print(json.dumps(['
			+ 'inspect_fixture(Path(path), candidate, CANDIDATES[candidate]) '
			+ 'for candidate,path in rows],sort_keys=True,separators=(",",":")))',
			JSON.stringify(paths)]);
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(JSON.parse(result.stdout).map(({ candidateId, frameCount }) =>
			({ candidateId, frameCount })), [
			{ candidateId: 'tiger-dnr-neural-core', frameCount: 88_200 },
			{ candidateId: 'panns-cnn10', frameCount: 64_000 },
			{ candidateId: 'beat-this', frameCount: 176_400 },
			{ candidateId: 'transnetv2', frameCount: 120 },
		]);

		const corrupt = createMilestone7ParityFixture(parityFixtures.fixtures[1].generator);
		corrupt.writeFloatLE(Number.NaN, 44);
		await writeFile(join(root, 'nonfinite.wav'), corrupt);
		const refused = python(['-c',
			'from pathlib import Path; from soundscaper_m7_conversion.runner_io import inspect_fixture; '
			+ 'from soundscaper_m7_conversion.specs import CANDIDATES; '
			+ 'inspect_fixture(Path("nonfinite.wav"),"panns-cnn10",CANDIDATES["panns-cnn10"])'], root);
		assert.notEqual(refused.status, 0);
		assert.match(refused.stderr, /finite|Float32|fixture/iu);
	});

test('owned beat and TransNet postprocessing is stable and source-framework-neutral', () => {
	const result = python(['-c',
		'import json; from soundscaper_m7_conversion.runner_postprocess import '
		+ 'beat_points, transnet_boundaries; '
		+ 'beats=[-2,-2,1,1,-2,-2,-2,-2,3,-2]; '
		+ 'down=[-2,-2,-2,2,-2,-2,-2,-2,-2,-2]; '
		+ 'single=[-10,-10,2,3,-10,-10,-10,1,-10]; '
		+ 'all_head=[-10]*9; print(json.dumps({"beat":beat_points(beats,down),'
		+ '"cuts":transnet_boundaries(single,all_head)},sort_keys=True,separators=(",",":")))']);
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), {
		beat: { beats: [1_103, 3_528], downbeats: [1_103] }, cuts: [3, 7],
	});
});

test('registered parity commands execute authenticated source inputs with the uv lock',
	async () => {
		const lockDigest = sha256(await readFile(LOCK_PATH));
		for (const recipe of executionRegister.recipes) {
			const command = recipe.commands.find(({ id }) => id === 'parity');
			assert.ok(command.argv.includes('--source-manifest'));
			assert.ok(command.argv.includes('source-input-manifest.json'));
			assert.ok(command.argv.includes('--toolchain-lock'));
			assert.ok(command.argv.includes('uv.lock'));
			assert.ok(command.argv.includes('--toolchain-sha256'));
			assert.ok(command.argv.includes(lockDigest));
		}
	});

test('authenticated parity refuses bad source custody before importing model frameworks',
	async (context) => {
		const root = await mkdtemp(join(tmpdir(), 'soundscaper-m7-runner-custody-'));
		context.after(() => rm(root, { recursive: true, force: true }));
		const recipe = executionRegister.recipes.find(({ candidateId }) =>
			candidateId === 'panns-cnn10');
		const fixture = parityFixtures.fixtures.find(({ candidateId }) =>
			candidateId === 'panns-cnn10');
		const graph = Buffer.from('not really onnx\n');
		const files = {
			[recipe.sourceCode.archive.fileName]: Buffer.from('not really tar\n'),
			'Cnn10_mAP=0.380.pth': Buffer.from('not really weights\n'),
			'class_labels_indices.csv': Buffer.from('not really labels\n'),
		};
		for (const [name, body] of Object.entries(files)) await writeFile(join(root, name), body);
		await writeFile(join(root, 'parity-fixture.bin'),
			createMilestone7ParityFixture(fixture.generator));
		await writeFile(join(root, 'panns-cnn10.onnx'), graph);
		await writeFile(join(root, 'converted-artifacts.json'), JSON.stringify({
			schemaVersion: 1, candidateId: 'panns-cnn10',
			planSha256: recipe.conversionPlanSha256,
			artifacts: [{ role: 'network', required: true, fileName: 'panns-cnn10.onnx',
				byteLength: graph.byteLength, sha256: sha256(graph) }],
		}));
		await writeFile(join(root, 'source-input-manifest.json'), JSON.stringify({
			schemaVersion: 1, protocol: 'soundscaper-model-conversion-v1',
			candidateId: 'panns-cnn10', planSha256: recipe.conversionPlanSha256,
			sourceCodeArchive: {
				path: recipe.sourceCode.archive.fileName, revision: recipe.sourceCode.revision,
				byteLength: files[recipe.sourceCode.archive.fileName].byteLength,
				sha256: sha256(files[recipe.sourceCode.archive.fileName]),
			},
			sourceArtifacts: recipe.sourceArtifacts.map(({ role, fileName }) => ({
				role, path: fileName, byteLength: files[fileName].byteLength,
				sha256: sha256(files[fileName]),
			})),
		}));
		await writeFile(join(root, 'uv.lock'), await readFile(LOCK_PATH));
		const command = recipe.commands.find(({ id }) => id === 'parity');
		const result = python(['-m', 'soundscaper_m7_conversion', ...command.argv.slice(4)], root);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /source artifact|byte length|source archive/iu);
		assert.doesNotMatch(result.stderr, /torch|tensorflow|onnxruntime|module/iu);
		assert.equal(existsSync(join(root, 'source-framework-runs')), false);
	});

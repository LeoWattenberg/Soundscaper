/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { canonicalJson, localModelEvidenceSha256 } from '../desktop/local-model-catalog-integrity.ts';
import {
	verifyLocalModelCatalogInclusion,
	verifyLocalModelRecipeRevision,
} from '../scripts/models/local-model-release-bundle.mjs';

const root = resolve(import.meta.dirname, '..');
const read = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
const catalog = await read('config/local-model-catalog.json');
const licensingEvidence = (await read('config/production-licensing-matrix.json')).localModelEvidence;
const tasks = (await read('config/milestone-7-model-catalog-tasks.json')).tasks;
const supply = await read('config/milestone-7-model-supply-candidates.json');
const execution = await read('config/milestone-7-model-conversion-execution.json');
const parityFixtures = await read('config/milestone-7-model-parity-fixtures.json');
const packageMetadata = await read('package.json');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const runFile = promisify(execFile);

async function retainedConversionEvidence(modelId) {
	const task = tasks.find(({ catalogModelId }) => catalogModelId === modelId);
	if (task.supplyBinding.kind === 'direct-pin') return new Map();
	const supplyId = task.supplyBinding.supplyId;
	return new Map([[supplyId,
		await read(`evidence/milestone-7-model-conversion/${supplyId}/conversion-evidence.json`)]]);
}

async function fixture(modelId = 'qwen3-4b-q4-k-m') {
	const options = structuredClone({ catalog, licensingEvidence, tasks, supply, execution, parityFixtures,
		modelIds: [modelId] });
	options.conversionEvidence = await retainedConversionEvidence(modelId);
	const task = options.tasks.find(({ catalogModelId }) => catalogModelId === modelId);
	const artifacts = task.artifacts.map((artifact) => ({ fileName: artifact.distributionFileName,
		byteLength: artifact.byteLength, sha256: artifact.sha256,
		url: `${catalog.publication.publicBaseUrl}${modelId}/${task.version}/${artifact.distributionFileName}` }));
	const proof = Buffer.from(JSON.stringify({ schemaVersion: 1, checkedAt: '2026-09-12T00:00:00.000Z',
		modelId, version: task.version,
		checks: ['public-head', 'byte-range', 'cors', 'full-sha256'], artifacts }));
	options.publications = new Map([[modelId, proof]]);
	task.releaseEvidence.publicReadbackSha256 = digest(proof);
	options.notices = artifacts.map(({ fileName, sha256 }) =>
		`${modelId} ${task.version} | ${fileName} | ${sha256}`).join('\n');
	return options;
}

test('catalog inclusion is derived from checked-in catalog, licensing and publication evidence', async () => {
	const options = await fixture();
	const catalogBefore = canonicalJson(options.catalog);
	const licensingBefore = canonicalJson(options.licensingEvidence);
	const result = verifyLocalModelCatalogInclusion(options);
	assert.equal(result.status, 'catalog-inclusion-verified');
	assert.deepEqual(result.modelIds, ['qwen3-4b-q4-k-m']);
	assert.equal(result.catalogSha256, digest(canonicalJson(options.catalog)));
	assert.deepEqual(result.entries, [{
		modelId: 'qwen3-4b-q4-k-m',
		catalogEntrySha256: options.tasks.find(({ catalogModelId }) =>
			catalogModelId === 'qwen3-4b-q4-k-m').releaseEvidence.catalogEntrySha256,
		publicReadbackSha256: digest(options.publications.get('qwen3-4b-q4-k-m')),
		licensingEvidenceSha256: options.catalog.entries.find(({ modelId }) =>
			modelId === 'qwen3-4b-q4-k-m').licensingEvidence.sha256,
	}]);
	assert.equal(canonicalJson(options.catalog), catalogBefore);
	assert.equal(canonicalJson(options.licensingEvidence), licensingBefore);
});

test('catalog verification rejects inconsistent inputs, license blockers and malformed selections', async () => {
	for (const [change, expected] of [
		[(value) => { value.catalog.entries[0].artifacts[0].sha256 = 'f'.repeat(64); }, /upstream bytes/u],
		[(value) => { value.licensingEvidence.find(({ id }) => id === catalog.entries[0].modelId).summary = 'changed'; }, /evidence|digest/u],
		[(value) => { value.modelIds = []; }, /Select distinct/u],
		[(value) => { value.modelIds.push(value.modelIds[0]); }, /Select distinct/u],
		[(value) => { value.modelIds = ['../qwen']; }, /model|identity/u],
		[(value) => { value.catalog.entries = value.catalog.entries.filter(({ modelId }) => modelId !== value.modelIds[0]); }, /not included/u],
		[(value) => { value.tasks.find(({ catalogModelId }) => catalogModelId === value.modelIds[0]).catalogModelId = 'unknown'; }, /Unknown model task/u],
	]) {
		const options = await fixture(); change(options);
		assert.throws(() => verifyLocalModelCatalogInclusion(options), expected);
	}
	const blocked = await fixture('dereverb-room');
	const row = blocked.licensingEvidence.find(({ id }) => id === 'dereverb-room');
	row.requirements['weights-and-code-license-review'].status = 'pending';
	row.blockedBy = ['weights-and-code-license-review'];
	row.distributionStatus = 'blocked';
	blocked.catalog.entries.find(({ modelId }) => modelId === 'dereverb-room').licensingEvidence.sha256 =
		localModelEvidenceSha256(row);
	assert.throws(() => verifyLocalModelCatalogInclusion(blocked), /publish|licens|blocked/u);
});

test('public full-readback, exact offline notice and source bytes must describe the catalog artifact', async () => {
	for (const [change, expected] of [
		[(value) => value.publications.clear(), /readback/u],
		[(value) => value.publications.set(value.modelIds[0], Buffer.from('{}')), /readback changed/u],
		[(value) => { const proof = JSON.parse(value.publications.get(value.modelIds[0])); proof.schemaVersion = 2;
			const bytes = Buffer.from(JSON.stringify(proof)); value.publications.set(value.modelIds[0], bytes);
			value.tasks.find(({ catalogModelId }) => catalogModelId === value.modelIds[0]).releaseEvidence.publicReadbackSha256 = digest(bytes); }, /schema/u],
		[(value) => { const proof = JSON.parse(value.publications.get(value.modelIds[0])); proof.artifacts[0].url += '?other';
			const bytes = Buffer.from(JSON.stringify(proof)); value.publications.set(value.modelIds[0], bytes);
			value.tasks.find(({ catalogModelId }) => catalogModelId === value.modelIds[0]).releaseEvidence.publicReadbackSha256 = digest(bytes); }, /catalog download/u],
		[(value) => { value.notices = value.notices.replaceAll(' | ', '\n\n'); }, /offline notice/u],
		[(value) => { value.notices = ''; }, /offline notice/u],
		[(value) => { value.supply.directPins.find(({ id }) => id === 'qwen3-4b-q4-k-m').artifact.sha256 = 'f'.repeat(64); }, /source|direct pin/u],
	]) {
		const options = await fixture(); change(options);
		assert.throws(() => verifyLocalModelCatalogInclusion(options), expected);
	}
});

test('converted catalog inclusion binds retained reproduction, parity, source and output identities', async () => {
	const options = await fixture('panns-cnn10');
	const result = verifyLocalModelCatalogInclusion(options);
	assert.equal(result.entries[0].modelId, 'panns-cnn10');
	for (const change of [
		(value) => value.conversionEvidence.clear(),
		(value) => { value.conversionEvidence.get('panns-cnn10').sourceCodeArchive.sha256 = 'a'.repeat(64); },
		(value) => { value.conversionEvidence.get('panns-cnn10').convertedArtifacts[0].sha256 = 'a'.repeat(64); },
		(value) => { value.conversionEvidence.get('panns-cnn10').parityEvidence.comparisons[0].observed = 1; },
		(value) => { value.execution.recipes.find(({ candidateId }) => candidateId === 'panns-cnn10').sourceArtifacts[0].sha256Readback = 'a'.repeat(64); },
	]) {
		const changed = await fixture('panns-cnn10'); change(changed);
		assert.throws(() => verifyLocalModelCatalogInclusion(changed), /evidence|identity|source|artifact|parity|digest/iu);
	}
});

test('the task digest and repository-derived fields both bind the exact catalog entry', async () => {
	const digestDrift = await fixture();
	digestDrift.tasks.find(({ catalogModelId }) => catalogModelId === digestDrift.modelIds[0])
		.releaseEvidence.catalogEntrySha256 = 'f'.repeat(64);
	assert.throws(() => verifyLocalModelCatalogInclusion(digestDrift), /catalog-entry SHA-256/u);

	const fieldDrift = await fixture();
	const entry = fieldDrift.catalog.entries.find(({ modelId }) => modelId === fieldDrift.modelIds[0]);
	entry.minimumMemoryBytes += 1;
	fieldDrift.tasks.find(({ catalogModelId }) => catalogModelId === fieldDrift.modelIds[0])
		.releaseEvidence.catalogEntrySha256 = digest(canonicalJson(entry));
	assert.throws(() => verifyLocalModelCatalogInclusion(fieldDrift), /repository-derived entry/u);

	const revisionDrift = await fixture('panns-cnn10');
	const converted = revisionDrift.catalog.entries.find(({ modelId }) => modelId === revisionDrift.modelIds[0]);
	converted.distribution.revision = 'mutable-label';
	revisionDrift.tasks.find(({ catalogModelId }) => catalogModelId === revisionDrift.modelIds[0])
		.releaseEvidence.catalogEntrySha256 = digest(canonicalJson(converted));
	assert.throws(() => verifyLocalModelCatalogInclusion(revisionDrift), /recipe revision/u);
});

test('recipe revisions are real commits with the exact tracked conversion inventory and inputs', async (context) => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'release-revision-'));
	context.after(() => rm(repositoryRoot, { recursive: true, force: true }));
	const files = new Map([
		['scripts/models/milestone-7-conversion-tool/uv.lock', 'locked\n'],
		['scripts/models/milestone-7-conversion-tool/converter.py', 'print("convert")\n'],
		['scripts/models/milestone-7-conversion-execution.mjs', 'export const execution = true;\n'],
		['scripts/models/milestone-7-parity-fixtures.mjs', 'export const parity = true;\n'],
		['scripts/models/verify-milestone-7-conversion-execution.mjs', 'export const verify = true;\n'],
		['config/milestone-7-model-conversion-execution.json', '{}\n'],
		['config/milestone-7-model-parity-fixtures.json', '{}\n'],
		['config/milestone-7-model-supply-candidates.json',
			JSON.stringify({ candidates: [{ id: 'converted' }], directPins: [{ id: 'old-direct' }] }) + '\n'],
		['evidence/milestone-7-model-conversion/converted/conversion-evidence.json', '{}\n'],
	]);
	for (const [path, bytes] of files) {
		await mkdir(dirname(join(repositoryRoot, path)), { recursive: true });
		await writeFile(join(repositoryRoot, path), bytes);
	}
	const git = (args) => runFile('git', args, { cwd: repositoryRoot });
	await git(['init']);
	await git(['add', '.']);
	await git(['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid',
		'commit', '-m', 'fixture']);
	const recipeRevision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
	const verified = await verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision });
	assert.ok(verified.files.includes('scripts/models/milestone-7-conversion-tool/uv.lock'));
	assert.ok(verified.files.includes('scripts/models/milestone-7-conversion-execution.mjs'));
	await assert.rejects(
		verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision: 'f'.repeat(40) }),
		/not a committed Git object/u,
	);

	await writeFile(join(repositoryRoot, 'scripts/models/milestone-7-conversion-tool/uv.lock'), 'drifted\n');
	await assert.rejects(verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision }), /bytes do not match/u);
	await writeFile(join(repositoryRoot, 'scripts/models/milestone-7-conversion-tool/uv.lock'), 'locked\n');
	const executor = join(repositoryRoot, 'scripts/models/milestone-7-conversion-execution.mjs');
	await writeFile(executor, 'export const execution = false;\n');
	await assert.rejects(verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision }), /bytes do not match/u);
	await writeFile(executor, 'export const execution = true;\n');
	await writeFile(executor, 'export const execution = "staged";\n');
	await git(['add', 'scripts/models/milestone-7-conversion-execution.mjs']);
	await writeFile(executor, 'export const execution = true;\n');
	await assert.rejects(verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision }), /index bytes/u);
	await git(['reset', '--', 'scripts/models/milestone-7-conversion-execution.mjs']);
	await writeFile(join(repositoryRoot, 'scripts/models/milestone-7-conversion-tool/new.py'), 'print("new")\n');
	await assert.rejects(verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision }), /uncommitted files/u);
	await git(['add', 'scripts/models/milestone-7-conversion-tool/new.py']);
	await assert.rejects(verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision }), /inventory/u);

	await git(['reset', '--', 'scripts/models/milestone-7-conversion-tool/new.py']);
	await rm(join(repositoryRoot, 'scripts/models/milestone-7-conversion-tool/new.py'));
	const supplyPath = join(repositoryRoot, 'config/milestone-7-model-supply-candidates.json');
	await writeFile(supplyPath,
		JSON.stringify({ candidates: [{ id: 'changed' }], directPins: [{ id: 'old-direct' }] }) + '\n');
	await assert.rejects(verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision }), /candidate inputs/u);
	await writeFile(supplyPath,
		JSON.stringify({ candidates: [{ id: 'converted' }], directPins: [{ id: 'new-direct' }] }) + '\n');
	assert.equal((await verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision })).recipeRevision,
		recipeRevision, 'Unrelated direct mirrors must not invalidate converted recipe provenance.');
});

test('the repository CLI machine-verifies all release-task catalog entries without review artifacts', async () => {
	assert.equal(packageMetadata.scripts['audit:local-model-release'],
		'node scripts/models/verify-local-model-release.mjs');
	assert.match(packageMetadata.scripts['audit:ci'], /audit:local-model-release/u);
	const { stdout } = await runFile(process.execPath,
		[join(root, 'scripts/models/verify-local-model-release.mjs')], { cwd: root });
	const report = JSON.parse(stdout);
	assert.equal(report.status, 'catalog-inclusion-verified');
	assert.deepEqual(report.modelIds, tasks.map(({ catalogModelId }) => catalogModelId));
	assert.equal(report.entries.length, tasks.length);

	const selected = JSON.parse((await runFile(process.execPath,
		[join(root, 'scripts/models/verify-local-model-release.mjs'), '--models', 'qwen3-4b-q4-k-m'],
		{ cwd: root })).stdout);
	assert.deepEqual(selected.modelIds, ['qwen3-4b-q4-k-m']);
	await assert.rejects(runFile(process.execPath,
		[join(root, 'scripts/models/verify-local-model-release.mjs'), '--output', 'review'], { cwd: root }),
		/accepts only|unknown/u);
});

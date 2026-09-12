/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { canonicalJson, localModelEvidenceSha256 } from '../desktop/local-model-catalog-integrity.ts';
import { prepareLocalModelReleaseBundle, verifyReviewedLocalModelReleaseBundle,
	verifyLocalModelRecipeRevision, writeLocalModelReleaseReview } from '../scripts/models/local-model-release-bundle.mjs';

const root = resolve(import.meta.dirname, '..');
const read = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
const catalog = await read('config/local-model-catalog.json');
const licensingEvidence = (await read('config/production-licensing-matrix.json')).localModelEvidence;
const tasks = (await read('config/milestone-7-model-catalog-tasks.json')).tasks;
const supply = await read('config/milestone-7-model-supply-candidates.json');
const execution = await read('config/milestone-7-model-conversion-execution.json');
const parityFixtures = await read('config/milestone-7-model-parity-fixtures.json');
const conversionEvidence = new Map([['panns-cnn10', await read('evidence/milestone-7-model-conversion/panns-cnn10/conversion-evidence.json')]]);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const runFile = promisify(execFile);

function fixture(modelId = 'qwen3-4b-q4-k-m') {
	const options = structuredClone({ catalog, licensingEvidence, tasks, supply, execution, parityFixtures,
		conversionEvidence, modelIds: [modelId], recipeRevision: '1'.repeat(40) });
	const task = options.tasks.find(({ catalogModelId }) => catalogModelId === modelId);
	const artifacts = task.artifacts.map((artifact) => ({ fileName: artifact.distributionFileName,
		byteLength: artifact.byteLength, sha256: artifact.sha256,
		url: `${catalog.publication.publicBaseUrl}${modelId}/${task.version}/${artifact.distributionFileName}` }));
	const proof = Buffer.from(JSON.stringify({ modelId, version: task.version,
		checks: ['public-head', 'byte-range', 'cors', 'full-sha256'], artifacts }));
	options.publications = new Map([[modelId, proof]]);
	task.releaseEvidence.publicReadbackSha256 = digest(proof);
	options.notices = artifacts.map(({ fileName, sha256 }) => `${modelId} ${task.version} | ${fileName} | ${sha256}`).join('\n');
	return options;
}

test('release preparation preserves the base and derives only reviewed additions and SHA-256 licensing pins', () => {
	const options = fixture();
	const before = canonicalJson(options.catalog);
	const rowsBefore = canonicalJson(options.licensingEvidence);
	const bundle = prepareLocalModelReleaseBundle(options);
	assert.equal(bundle.status, 'awaiting-catalog-review');
	assert.equal(bundle.baseCatalogSha256, digest(before));
	assert.equal(bundle.payloadSha256, digest(canonicalJson(bundle.payload)));
	assert.deepEqual(bundle.payload.entries.slice(0, -1), catalog.entries);
	const added = bundle.payload.entries.at(-1);
	assert.equal(added.modelId, 'qwen3-4b-q4-k-m');
	assert.equal(added.distribution.kind, 'identity-mirrored');
	assert.equal(added.upstream.artifacts[0].sha256, added.artifacts[0].sha256);
	const row = bundle.licensingEvidence.find(({ id }) => id === added.modelId);
	assert.equal(row.distributionStatus, 'permitted');
	assert.deepEqual(row.blockedBy, []);
	assert.equal(added.licensingEvidence.sha256, localModelEvidenceSha256(row));
	assert.equal(canonicalJson(options.catalog), before);
	assert.equal(canonicalJson(options.licensingEvidence), rowsBefore);
});

test('release preparation rejects inconsistent base data, license blockers and malformed explicit selections', () => {
	for (const [change, expected] of [
		[(value) => { value.catalog.entries[0].artifacts[0].sha256 = 'f'.repeat(64); }, /upstream bytes/u],
		[(value) => { value.licensingEvidence.find(({ id }) => id === catalog.entries[0].modelId).summary = 'changed'; }, /evidence|digest/u],
		[(value) => { value.modelIds = []; }, /Select distinct/u],
		[(value) => { value.modelIds.push(value.modelIds[0]); }, /Select distinct/u],
		[(value) => { value.modelIds = ['../qwen']; }, /model|identity/u],
		[(value) => { value.modelIds = [catalog.entries[0].modelId]; }, /already published/u],
		[(value) => { value.tasks.find(({ catalogModelId }) => catalogModelId === value.modelIds[0]).catalogModelId = 'unknown'; }, /Unknown model task/u],
	]) {
		const options = fixture(); change(options);
		assert.throws(() => prepareLocalModelReleaseBundle(options), expected);
	}
	const blocked = fixture('dereverb-room');
	const row = blocked.licensingEvidence.find(({ id }) => id === 'dereverb-room');
	row.requirements['weights-and-code-license-review'].status = 'pending';
	row.blockedBy.push('weights-and-code-license-review');
	assert.throws(() => prepareLocalModelReleaseBundle(blocked), /licens|blocked/u);
});

test('public proof, exact offline notice, and upstream bytes must describe the same artifact', () => {
	for (const [change, expected] of [
		[(value) => value.publications.clear(), /readback/u],
		[(value) => value.publications.set(value.modelIds[0], Buffer.from('{}')), /readback changed/u],
		[(value) => { const proof = JSON.parse(value.publications.get(value.modelIds[0])); proof.artifacts[0].url += '?other';
			const bytes = Buffer.from(JSON.stringify(proof)); value.publications.set(value.modelIds[0], bytes);
			value.tasks.find(({ catalogModelId }) => catalogModelId === value.modelIds[0]).releaseEvidence.publicReadbackSha256 = digest(bytes); }, /proposed download/u],
		[(value) => { value.notices = value.notices.replaceAll(' | ', '\n\n'); }, /offline notice/u],
		[(value) => { value.notices = ''; }, /offline notice/u],
		[(value) => { value.supply.directPins.find(({ id }) => id === 'qwen3-4b-q4-k-m').artifact.sha256 = 'f'.repeat(64); }, /upstream|direct pin/u],
	]) {
		const options = fixture(); change(options);
		assert.throws(() => prepareLocalModelReleaseBundle(options), expected);
	}
});

test('converted release additions bind retained reproduction, parity, source and output identities', () => {
	const options = fixture('panns-cnn10');
	const result = prepareLocalModelReleaseBundle(options).payload.entries.at(-1);
	assert.equal(result.distribution.kind, 'reproducibly-derived');
	assert.equal(result.distribution.revision, options.recipeRevision);
	assert.equal(result.upstream.artifacts[0].sha256, conversionEvidence.get('panns-cnn10').sourceArtifacts[0].sha256);
	for (const change of [
		(value) => value.conversionEvidence.clear(),
		(value) => { value.conversionEvidence.get('panns-cnn10').sourceCodeArchive.sha256 = 'a'.repeat(64); },
		(value) => { value.conversionEvidence.get('panns-cnn10').convertedArtifacts[0].sha256 = 'a'.repeat(64); },
		(value) => { value.conversionEvidence.get('panns-cnn10').parityEvidence.comparisons[0].observed = 1; },
		(value) => { value.execution.recipes.find(({ candidateId }) => candidateId === 'panns-cnn10').sourceArtifacts[0].sha256Readback = 'a'.repeat(64); },
	]) {
		const changed = fixture('panns-cnn10'); change(changed);
		assert.throws(() => prepareLocalModelReleaseBundle(changed), /evidence|identity|source|artifact|parity|digest/iu);
	}
});

test('review verification accepts the unchanged SHA-256 payload and rejects review drift', () => {
	const bundle = { schemaVersion: 1, status: 'awaiting-catalog-review', modelIds: [],
		baseCatalogSha256: digest(canonicalJson(catalog)), payload: catalog,
		payloadSha256: digest(canonicalJson(catalog)), licensingEvidence };
	assert.equal(verifyReviewedLocalModelReleaseBundle(bundle, catalog, catalog).entries.length, catalog.entries.length);
	assert.throws(() => verifyReviewedLocalModelReleaseBundle({ ...bundle, payloadSha256: 'f'.repeat(64) }, catalog, catalog));
	assert.throws(() => verifyReviewedLocalModelReleaseBundle({ ...bundle, payload: { ...catalog, entries: [] } }, catalog, catalog), /release payload/u);
	assert.throws(() => verifyReviewedLocalModelReleaseBundle(bundle, catalog, { ...catalog, extra: 'changed' }), /production catalog changed/u);
});

test('recipe revisions must be real commits with exact tracked converter and config bytes', async (context) => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'release-revision-'));
	context.after(() => rm(repositoryRoot, { recursive: true, force: true }));
	const files = ['scripts/models/milestone-7-conversion-tool/uv.lock',
		'config/milestone-7-model-catalog-tasks.json', 'config/milestone-7-model-supply-candidates.json',
		'config/milestone-7-model-conversion-execution.json', 'config/milestone-7-model-parity-fixtures.json'];
	for (const path of files) { await mkdir(dirname(join(repositoryRoot, path)), { recursive: true }); await writeFile(join(repositoryRoot, path), '{}\n'); }
	const git = (args) => runFile('git', args, { cwd: repositoryRoot });
	await git(['init']); await git(['add', '.']);
	await git(['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', 'fixture']);
	const recipeRevision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
	assert.ok((await verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision })).files.length >= files.length);
	await assert.rejects(verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision: 'f'.repeat(40) }), /committed/u);
	await writeFile(join(repositoryRoot, files[0]), '{}\r\n');
	await assert.rejects(verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision }), /changed|match/u);
	await writeFile(join(repositoryRoot, files[0]), '{}\n');
	await writeFile(join(repositoryRoot, 'scripts/models/new-converter.py'), 'print(1)\n');
	await assert.rejects(verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision }), /uncommitted/u);
	await git(['add', 'scripts/models/new-converter.py']);
	await assert.rejects(verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision }), /inventory|uncommitted/u);
});

test('review files are fresh external artifacts and cannot replace production files through symlinks', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'release-output-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const repositoryRoot = join(directory, 'source');
	await mkdir(repositoryRoot);
	const bundle = prepareLocalModelReleaseBundle(fixture());
	await assert.rejects(writeLocalModelReleaseReview({ repositoryRoot, output: join(repositoryRoot, 'new'), bundle }), /outside/u);
	await assert.rejects(readFile(join(repositoryRoot, 'new', 'release-bundle.json')), /ENOENT/u);
	const output = join(directory, 'review');
	await writeLocalModelReleaseReview({ repositoryRoot, output, bundle });
	assert.deepEqual(JSON.parse(await readFile(join(output, 'catalog.payload.json'), 'utf8')), bundle.payload);
	await assert.rejects(writeLocalModelReleaseReview({ repositoryRoot, output, bundle }), /EEXIST/u);
	const linked = join(directory, 'linked');
	await symlink(repositoryRoot, linked, process.platform === 'win32' ? 'junction' : 'dir');
	await assert.rejects(writeLocalModelReleaseReview({ repositoryRoot, output: join(linked, 'new'), bundle }), /outside/u);
});

test('the CLI rejects nonexistent recipe commits before creating review files', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'release-cli-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const output = join(directory, 'review');
	await assert.rejects(runFile(process.execPath, [join(root, 'scripts/models/prepare-local-model-release.mjs'),
		'--output', output, '--models', 'qwen3-4b-q4-k-m', '--recipe-revision', 'f'.repeat(40)], { cwd: root }), /not a committed/u);
	await assert.rejects(readFile(join(output, 'release-bundle.json')), /ENOENT/u);
	await assert.rejects(runFile(process.execPath, [join(root, 'scripts/models/prepare-local-model-release.mjs'),
		'--output', output, '--verify-catalog', join(root, 'config/local-model-catalog.json'), '--models', 'qwen'], { cwd: root }), /only --output/u);
});

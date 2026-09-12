/* SPDX-License-Identifier: AGPL-3.0-only */

/** Prepare reviewable release data without changing production trust or admission. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { canonicalJson, localModelEvidenceSha256 } from '../../desktop/local-model-catalog-integrity.ts';
import { validateLocalModelCatalog } from '../../desktop/local-model-catalog.ts';
import { assertPublishable } from '../lib/local-model-mirror.mjs';
import { validateMilestone7ConversionEvidence } from './milestone-7-conversion-execution.mjs';

const CHECKS = ['public-head', 'byte-range', 'cors', 'full-sha256'];
const NOTICE_REQUIREMENT = 'versioned-download-notices-and-hashes';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const runFile = promisify(execFile);
const RECIPE_CONFIGS = ['config/milestone-7-model-catalog-tasks.json', 'config/milestone-7-model-supply-candidates.json',
	'config/milestone-7-model-conversion-execution.json', 'config/milestone-7-model-parity-fixtures.json'];
const RECIPE_PATHS = ['scripts/models/', ...RECIPE_CONFIGS, 'evidence/milestone-7-model-conversion/'];

export function prepareLocalModelReleaseBundle({ catalog, licensingEvidence, tasks, supply, execution,
	publications, modelIds, recipeRevision, notices, parityFixtures, conversionEvidence = new Map() }) {
	validateLocalModelCatalog(catalog, { licensingEvidence });
	assert.match(recipeRevision, /^[a-f\d]{40}$/u, 'Pin the committed conversion recipe revision.');
	assert.ok(Array.isArray(modelIds) && modelIds.length > 0 && new Set(modelIds).size === modelIds.length, 'Select distinct models for publication.');
	assert.ok(modelIds.every((id) => typeof id === 'string' && /^[a-z\d][a-z\d.-]*[a-z\d]$/u.test(id)), 'Invalid publication model identity.');
	assert.equal(new Set(tasks.map(({ catalogModelId }) => catalogModelId)).size, tasks.length, 'Duplicate candidate model tasks.');
	assert.equal(new Set(licensingEvidence.map(({ id }) => id)).size, licensingEvidence.length, 'Duplicate licensing evidence rows.');
	const rows = structuredClone(licensingEvidence);
	const entries = structuredClone(catalog.entries);
	for (const modelId of modelIds) {
		assert.ok(!entries.some((entry) => entry.modelId === modelId), `${modelId} is already published.`);
		assertPublishable(rows, modelId);
		const task = tasks.find(({ catalogModelId }) => catalogModelId === modelId);
		assert.ok(task, `Unknown model task: ${modelId}`);
		const proofBytes = publications.get(modelId);
		assert.ok(proofBytes, `${modelId} has no retained public readback.`);
		assert.equal(digest(proofBytes), task.releaseEvidence.publicReadbackSha256, `${modelId} public readback changed.`);
		const proof = JSON.parse(Buffer.from(proofBytes).toString('utf8'));
		assert.equal(proof.modelId, modelId);
		assert.equal(proof.version, task.version);
		assert.deepEqual(proof.checks, CHECKS);
		const artifacts = task.artifacts.map((artifact) => ({ fileName: artifact.distributionFileName,
			byteLength: artifact.byteLength, sha256: artifact.sha256,
			url: `${catalog.publication.publicBaseUrl}${modelId}/${task.version}/${artifact.distributionFileName}` }));
		assert.deepEqual(proof.artifacts, artifacts, `${modelId} readback does not bind the proposed download.`);
		for (const artifact of artifacts) {
			assert.match(artifact.sha256, /^[a-f\d]{64}$/u);
			assert.ok(Number.isSafeInteger(artifact.byteLength) && artifact.byteLength > 0);
			assert.match(artifact.fileName, /^[A-Za-z\d][A-Za-z\d._-]*$/u);
			assert.ok(notices.split(/\n\s*\n|\n(?=\s*[-*] )/u).some((paragraph) =>
				paragraph.includes(artifact.sha256) && paragraph.includes(artifact.fileName)), `${modelId} has no exact offline notice.`);
		}
		const row = rows.find(({ id }) => id === modelId);
		assert.ok(Object.entries(row.requirements).every(([id, requirement]) =>
			id === NOTICE_REQUIREMENT || requirement.status === 'recorded'), `${modelId} still needs licensing evidence.`);
		row.requirements[NOTICE_REQUIREMENT] = { status: 'recorded',
			summary: `Version ${task.version} artifacts and their exact hashes are listed in THIRD_PARTY_LICENSES.md. `
				+ `Public HEAD, byte-range, CORS, and full SHA-256 readback are retained in evidence/local-model-publication/${modelId}.json. `
				+ 'The release catalog binds this complete evidence row and those download identities by SHA-256.' };
		row.blockedBy = row.blockedBy.filter((id) => id !== NOTICE_REQUIREMENT);
		row.distributionStatus = 'permitted';
		const { upstream, distribution } = provenance(task, supply, execution, recipeRevision, parityFixtures, conversionEvidence);
		entries.push({ modelId, version: task.version, task: task.task, platforms: task.platforms,
			minimumMemoryBytes: task.minimumMemoryBytes,
			licensingEvidence: { id: modelId, sha256: localModelEvidenceSha256(row) }, upstream, distribution, artifacts });
	}
	const proposed = { ...catalog, entries };
	return { schemaVersion: 1, status: 'awaiting-catalog-review', modelIds: [...modelIds],
		baseCatalogSha256: digest(canonicalJson(catalog)), recipeRevision,
		payloadSha256: digest(canonicalJson(proposed)), payload: proposed, licensingEvidence: rows };
}

function provenance(task, supply, execution, recipeRevision, parityFixtures, conversionEvidence) {
	const binding = task.supplyBinding;
	assert.equal(task.artifacts.length, 1, 'A release task must bind its one reviewed model artifact.');
	if (binding.kind === 'direct-pin') {
		const pin = supply.directPins.find(({ id }) => id === binding.supplyId);
		assert.ok(pin, 'Unknown direct model pin.');
		assert.equal(task.artifacts[0].sha256, pin.artifact.sha256, 'The proposed bytes differ from the upstream direct pin.');
		assert.equal(task.artifacts[0].byteLength, pin.artifact.byteLength, 'The proposed length differs from the upstream direct pin.');
		assert.equal(task.artifacts[0].sourceFileName, pin.artifact.fileName, 'The proposed source file differs from the upstream direct pin.');
		return { distribution: { kind: 'identity-mirrored' }, upstream: { source: pin.repository, revision: pin.revision,
			artifacts: [{ fileName: task.artifacts[0].distributionFileName, byteLength: pin.artifact.byteLength,
				sha256: pin.artifact.sha256, url: `${pin.repository}/resolve/${pin.revision}/${pin.artifact.fileName}` }] } };
	}
	assert.equal(binding.kind, 'converted-output', 'Unknown model supply binding.');
	const candidate = supply.candidates.find(({ id }) => id === binding.supplyId);
	const recipe = execution.recipes.find(({ candidateId }) => candidateId === binding.supplyId);
	assert.equal(candidate?.conversion.status, 'converted-artifact-ready');
	assert.equal(recipe?.outputManifest.status, 'verified');
	assert.deepEqual(recipe.blockedBy, [], 'Conversion evidence is incomplete.');
	const retained = conversionEvidence.get(binding.supplyId);
	assert.ok(retained, 'Retained conversion evidence is missing.');
	validateMilestone7ConversionEvidence(retained, { executionRegister: execution, modelSupply: supply, parityFixtures });
	const converted = candidate.conversion.outputs.find(({ role }) => role === binding.outputRole);
	assert.equal(converted?.sha256, task.artifacts[0].sha256);
	assert.equal(converted?.byteLength, task.artifacts[0].byteLength);
	const reproduced = recipe.outputManifest.artifacts.find(({ role }) => role === binding.outputRole);
	assert.equal(reproduced?.sha256, converted.sha256, 'Converted output differs from reproduced artifact identity.');
	assert.equal(reproduced?.byteLength, converted.byteLength, 'Converted output length differs from reproduced artifact identity.');
	const sourceArtifacts = candidate.source.artifacts.map((source) => {
		const readback = recipe.sourceArtifacts.find(({ role }) => role === source.role);
		assert.match(readback?.sha256Readback, /^[a-f\d]{64}$/u);
		return { fileName: source.fileName.replace(/[^A-Za-z\d._-]/gu, '-'), byteLength: source.byteLength,
			sha256: readback.sha256Readback, url: source.url };
	});
	return { distribution: { kind: 'reproducibly-derived', recipe: 'config/milestone-7-model-conversion-execution.json',
		revision: recipeRevision, environmentSha256: candidate.conversion.recipe.toolchain.sha256 },
		upstream: { source: candidate.source.code.url, revision: candidate.source.code.revision, artifacts: sourceArtifacts } };
}

/** Verifies that a reviewed catalog is the exact digest-pinned release payload. */
export function verifyReviewedLocalModelReleaseBundle(bundle, reviewedCatalog, currentCatalog) {
	assert.equal(bundle.schemaVersion, 1);
	assert.equal(bundle.status, 'awaiting-catalog-review');
	assert.equal(digest(canonicalJson(currentCatalog)), bundle.baseCatalogSha256, 'The production catalog changed after preparation.');
	validateLocalModelCatalog(currentCatalog, { licensingEvidence: bundle.licensingEvidence });
	assert.equal(canonicalJson(reviewedCatalog), canonicalJson(bundle.payload), 'The reviewed catalog differs from the release payload.');
	assert.equal(digest(canonicalJson(reviewedCatalog)), bundle.payloadSha256);
	return validateLocalModelCatalog(reviewedCatalog, { licensingEvidence: bundle.licensingEvidence });
}

/** A revision label is evidence only if the current conversion inputs equal that committed tree. */
export async function verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision }) {
	assert.match(recipeRevision, /^[a-f\d]{40}$/u, 'Pin the committed conversion recipe revision.');
	const git = async (args) => (await runFile('git', args, { cwd: repositoryRoot, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 })).stdout;
	let committed;
	try { committed = (await git(['rev-parse', '--verify', `${recipeRevision}^{commit}`])).toString().trim(); }
	catch (error) { throw new Error('The conversion recipe revision is not a committed Git object.', { cause: error }); }
	assert.equal(committed, recipeRevision, 'Pin the exact committed conversion recipe.');
	const untracked = await git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...RECIPE_PATHS]);
	assert.equal(untracked.length, 0, 'The conversion recipe contains uncommitted files.');
	const files = (await git(['ls-tree', '-r', '--name-only', '-z', recipeRevision, '--', ...RECIPE_PATHS])).toString().split('\0').filter(Boolean);
	const tracked = (await git(['ls-files', '-z', '--', ...RECIPE_PATHS])).toString().split('\0').filter(Boolean);
	assert.deepEqual(tracked.toSorted(), files.toSorted(), 'The tracked conversion inventory contains uncommitted additions or removals.');
	for (const required of [...RECIPE_CONFIGS, 'scripts/models/milestone-7-conversion-tool/uv.lock']) {
		assert.ok(files.includes(required), `${required} is absent from the committed conversion recipe.`);
	}
	for (const path of files) {
		const actualPath = resolve(repositoryRoot, path);
		const stat = await lstat(actualPath);
		assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${path} changed from its committed recipe file.`);
		assert.equal(digest(await readFile(actualPath)), digest(await git(['show', `${recipeRevision}:${path}`])), `${path} bytes do not match the committed recipe.`);
	}
	return { recipeRevision, files };
}

/** Emit a fresh external review directory without following file links or replacing source files. */
export async function writeLocalModelReleaseReview({ repositoryRoot, output, bundle }) {
	let ancestor = resolve(output);
	const suffix = [];
	for (;;) {
		try { ancestor = await realpath(ancestor); break; }
		catch (error) {
			if (error.code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
			suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor);
		}
	}
	const actualOutput = resolve(ancestor, ...suffix);
	const fromRoot = relative(await realpath(repositoryRoot), actualOutput);
	if (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`)) {
		throw new Error('Choose a review output directory outside the production source checkout.');
	}
	await mkdir(actualOutput, { recursive: true });
	await writeFile(resolve(actualOutput, 'release-bundle.json'), JSON.stringify(bundle, null, '\t') + '\n', { flag: 'wx' });
	await writeFile(resolve(actualOutput, 'catalog.payload.json'), JSON.stringify(bundle.payload, null, '\t') + '\n', { flag: 'wx' });
}

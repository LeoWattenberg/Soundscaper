/* SPDX-License-Identifier: AGPL-3.0-only */

/** Machine-verifies catalog inclusion from repository-owned release evidence. */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { canonicalJson, localModelEvidenceSha256 } from '../../desktop/local-model-catalog-integrity.ts';
import { validateLocalModelCatalog } from '../../desktop/local-model-catalog.ts';
import { assertPublishable } from '../lib/local-model-mirror.mjs';
import { validateMilestone7ConversionEvidence } from './milestone-7-conversion-execution.mjs';

const CHECKS = ['public-head', 'byte-range', 'cors', 'full-sha256'];
const SHA256 = /^[a-f\d]{64}$/u;
const COMMIT = /^[a-f\d]{40}$/u;
const MODEL_ID = /^[a-z\d][a-z\d.-]*[a-z\d]$/u;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const runFile = promisify(execFile);
const RECIPE_PATHS = Object.freeze([
	'scripts/models/milestone-7-conversion-tool/',
	'scripts/models/milestone-7-conversion-execution.mjs',
	'scripts/models/milestone-7-parity-fixtures.mjs',
	'scripts/models/verify-milestone-7-conversion-execution.mjs',
	'config/milestone-7-model-conversion-execution.json',
	'config/milestone-7-model-parity-fixtures.json',
	'evidence/milestone-7-model-conversion/',
]);
const RECIPE_REQUIRED = Object.freeze([
	'scripts/models/milestone-7-conversion-tool/uv.lock',
	'scripts/models/milestone-7-conversion-execution.mjs',
	'scripts/models/milestone-7-parity-fixtures.mjs',
	'scripts/models/verify-milestone-7-conversion-execution.mjs',
	'config/milestone-7-model-conversion-execution.json',
	'config/milestone-7-model-parity-fixtures.json',
]);
const RECIPE_CANDIDATES = 'config/milestone-7-model-supply-candidates.json';

/**
 * Proves that a catalog recipe revision is a real commit and that the current
 * converter, execution records, parity fixtures, and retained conversion
 * evidence have exactly that commit's tracked inventory and bytes.
 *
 * The supply register also contains unrelated identity-mirrored models, so its
 * converted candidate records are compared semantically without pinning later
 * direct-mirror status changes to this conversion revision.
 */
export async function verifyLocalModelRecipeRevision({ repositoryRoot, recipeRevision }) {
	assert.match(recipeRevision, COMMIT, 'Pin the committed conversion recipe revision.');
	const git = async (args) => (await runFile('git', args, {
		cwd: repositoryRoot,
		encoding: 'buffer',
		maxBuffer: 16 * 1024 * 1024,
	})).stdout;
	let committed;
	try {
		committed = (await git(['rev-parse', '--verify', `${recipeRevision}^{commit}`])).toString().trim();
	} catch (error) {
		throw new Error('The conversion recipe revision is not a committed Git object.', { cause: error });
	}
	assert.equal(committed, recipeRevision, 'Pin the exact committed conversion recipe.');
	const untracked = await git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...RECIPE_PATHS]);
	assert.equal(untracked.length, 0, 'The conversion recipe contains uncommitted files.');
	const files = splitGitPaths(await git([
		'ls-tree', '-r', '--name-only', '-z', recipeRevision, '--', ...RECIPE_PATHS,
	]));
	const tracked = splitGitPaths(await git(['ls-files', '-z', '--', ...RECIPE_PATHS]));
	assert.deepEqual(tracked.toSorted(), files.toSorted(),
		'The tracked conversion inventory contains uncommitted additions or removals.');
	for (const required of RECIPE_REQUIRED) {
		assert.ok(files.includes(required), `${required} is absent from the committed conversion recipe.`);
	}
	for (const path of files) {
		const actualPath = resolve(repositoryRoot, path);
		const stat = await lstat(actualPath);
		assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${path} changed from its committed recipe file.`);
		const committedBytes = await git(['show', `${recipeRevision}:${path}`]);
		assert.equal(digest(await readFile(actualPath)), digest(committedBytes),
			`${path} bytes do not match the committed conversion recipe.`);
		assert.equal(digest(await git(['show', `:${path}`])), digest(committedBytes),
			`${path} index bytes do not match the committed conversion recipe.`);
	}
	const candidateTracked = splitGitPaths(await git(['ls-files', '-z', '--', RECIPE_CANDIDATES]));
	assert.deepEqual(candidateTracked, [RECIPE_CANDIDATES],
		'The converted candidate input register is not a tracked recipe file.');
	const candidateStat = await lstat(resolve(repositoryRoot, RECIPE_CANDIDATES));
	assert.ok(candidateStat.isFile() && !candidateStat.isSymbolicLink(),
		'The converted candidate input register changed from a regular recipe file.');
	const currentSupply = JSON.parse(await readFile(resolve(repositoryRoot, RECIPE_CANDIDATES), 'utf8'));
	const committedSupply = JSON.parse((await git(['show', `${recipeRevision}:${RECIPE_CANDIDATES}`])).toString('utf8'));
	assert.deepEqual(currentSupply.candidates, committedSupply.candidates,
		'The converted candidate inputs do not match the committed conversion recipe.');
	const indexedSupply = JSON.parse((await git(['show', `:${RECIPE_CANDIDATES}`])).toString('utf8'));
	assert.deepEqual(indexedSupply.candidates, committedSupply.candidates,
		'The converted candidate index inputs do not match the committed conversion recipe.');
	return Object.freeze({ recipeRevision, files: Object.freeze(files) });
}

function splitGitPaths(bytes) {
	return bytes.toString().split('\0').filter(Boolean);
}

/**
 * Verifies that each selected catalog entry is the exact result described by
 * its checked-in source, conversion, licensing, notice, and public-readback
 * evidence. This function does not write catalog data or publish artifacts.
 */
export function verifyLocalModelCatalogInclusion({ catalog, licensingEvidence, tasks, supply, execution,
	publications, modelIds, notices, parityFixtures, conversionEvidence = new Map() }) {
	validateLocalModelCatalog(catalog, { licensingEvidence });
	assert.ok(Array.isArray(modelIds) && modelIds.length > 0
		&& new Set(modelIds).size === modelIds.length, 'Select distinct models for catalog verification.');
	assert.ok(modelIds.every((id) => typeof id === 'string' && MODEL_ID.test(id)),
		'Invalid model identity selected for catalog verification.');
	assert.ok(Array.isArray(tasks), 'Catalog verification needs the model task register.');
	assert.equal(new Set(tasks.map(({ catalogModelId }) => catalogModelId)).size, tasks.length,
		'Duplicate candidate model tasks.');
	assert.equal(new Set(licensingEvidence.map(({ id }) => id)).size, licensingEvidence.length,
		'Duplicate licensing evidence rows.');
	assert.ok(publications instanceof Map, 'Catalog verification needs retained public readbacks.');
	assert.ok(conversionEvidence instanceof Map, 'Catalog verification needs retained conversion evidence.');
	assert.equal(typeof notices, 'string', 'Catalog verification needs the exact offline notices.');

	const verified = [];
	for (const modelId of modelIds) {
		const entry = catalog.entries.find((candidate) => candidate.modelId === modelId);
		assert.ok(entry, `${modelId} is not included in the production catalog.`);
		const task = tasks.find(({ catalogModelId }) => catalogModelId === modelId);
		assert.ok(task, `Unknown model task: ${modelId}`);
		assert.match(task.releaseEvidence?.catalogEntrySha256, SHA256,
			`${modelId} needs an exact catalog-entry SHA-256.`);
		assert.match(task.releaseEvidence?.publicReadbackSha256, SHA256,
			`${modelId} needs an exact public-readback SHA-256.`);

		const proofBytes = publications.get(modelId);
		assert.ok(proofBytes, `${modelId} has no retained public readback.`);
		assert.equal(digest(proofBytes), task.releaseEvidence.publicReadbackSha256,
			`${modelId} public readback changed.`);
		const proof = JSON.parse(Buffer.from(proofBytes).toString('utf8'));
		assert.equal(proof.schemaVersion, 1, `${modelId} public-readback schema is unsupported.`);
		assert.equal(proof.modelId, modelId);
		assert.equal(proof.version, task.version);
		assert.deepEqual(proof.checks, CHECKS);
		const artifacts = catalogArtifacts(catalog, task);
		assert.deepEqual(proof.artifacts, artifacts,
			`${modelId} public readback does not bind the catalog download.`);
		verifyNotices(modelId, artifacts, notices);

		const licensingRow = assertPublishable(licensingEvidence, modelId);
		assert.ok(Object.values(licensingRow.requirements).every(({ status }) => status === 'recorded'),
			`${modelId} still needs licensing evidence.`);
		assert.deepEqual(licensingRow.blockedBy, [], `${modelId} licensing evidence is blocked.`);
		assert.equal(licensingRow.distributionStatus, 'permitted',
			`${modelId} licensing evidence does not permit distribution.`);
		const licensingEvidenceSha256 = localModelEvidenceSha256(licensingRow);
		assert.equal(entry.licensingEvidence.sha256, licensingEvidenceSha256,
			`${modelId} catalog entry does not bind its exact licensing evidence.`);

		let recipeRevision;
		if (task.supplyBinding.kind === 'converted-output') {
			assert.equal(entry.distribution.kind, 'reproducibly-derived',
				`${modelId} converted bytes need reproducible distribution provenance.`);
			assert.match(entry.distribution.revision, COMMIT,
				`${modelId} conversion recipe revision must be one exact commit.`);
			recipeRevision = entry.distribution.revision;
		}
		const { upstream, distribution } = provenance(
			task, supply, execution, recipeRevision, parityFixtures, conversionEvidence,
		);
		const expectedEntry = {
			modelId,
			version: task.version,
			task: task.task,
			platforms: task.platforms,
			minimumMemoryBytes: task.minimumMemoryBytes,
			licensingEvidence: { id: modelId, sha256: licensingEvidenceSha256 },
			upstream,
			distribution,
			artifacts,
		};
		assert.equal(canonicalJson(entry), canonicalJson(expectedEntry),
			`${modelId} catalog entry differs from the repository-derived entry.`);
		const catalogEntrySha256 = digest(canonicalJson(entry));
		assert.equal(catalogEntrySha256, task.releaseEvidence.catalogEntrySha256,
			`${modelId} catalog-entry SHA-256 does not match the offered entry.`);
		verified.push(Object.freeze({ modelId, catalogEntrySha256,
			publicReadbackSha256: digest(proofBytes), licensingEvidenceSha256 }));
	}

	return Object.freeze({
		schemaVersion: 1,
		status: 'catalog-inclusion-verified',
		modelIds: Object.freeze([...modelIds]),
		catalogSha256: digest(canonicalJson(catalog)),
		entries: Object.freeze(verified),
	});
}

function catalogArtifacts(catalog, task) {
	return task.artifacts.map((artifact) => {
		assert.match(artifact.sha256, SHA256);
		assert.ok(Number.isSafeInteger(artifact.byteLength) && artifact.byteLength > 0);
		assert.match(artifact.distributionFileName, /^[A-Za-z\d][A-Za-z\d._-]*$/u);
		return {
			fileName: artifact.distributionFileName,
			byteLength: artifact.byteLength,
			sha256: artifact.sha256,
			url: `${catalog.publication.publicBaseUrl}${task.catalogModelId}/${task.version}/${artifact.distributionFileName}`,
		};
	});
}

function verifyNotices(modelId, artifacts, notices) {
	for (const artifact of artifacts) {
		assert.ok(notices.split(/\n\s*\n|\n(?=\s*[-*] )/u).some((paragraph) =>
			paragraph.includes(artifact.sha256) && paragraph.includes(artifact.fileName)),
		`${modelId} has no exact offline notice.`);
	}
}

function provenance(task, supply, execution, recipeRevision, parityFixtures, conversionEvidence) {
	const binding = task.supplyBinding;
	assert.equal(task.artifacts.length, 1, 'A release task must bind its one catalog model artifact.');
	if (binding.kind === 'direct-pin') {
		const pin = supply.directPins.find(({ id }) => id === binding.supplyId);
		assert.ok(pin, 'Unknown direct model pin.');
		assert.equal(task.artifacts[0].sha256, pin.artifact.sha256,
			'The catalog bytes differ from the direct source pin.');
		assert.equal(task.artifacts[0].byteLength, pin.artifact.byteLength,
			'The catalog length differs from the direct source pin.');
		assert.equal(task.artifacts[0].sourceFileName, pin.artifact.fileName,
			'The catalog source file differs from the direct source pin.');
		return {
			distribution: { kind: 'identity-mirrored' },
			upstream: {
				source: pin.repository,
				revision: pin.revision,
				artifacts: [{
					fileName: task.artifacts[0].distributionFileName,
					byteLength: pin.artifact.byteLength,
					sha256: pin.artifact.sha256,
					url: `${pin.repository}/resolve/${pin.revision}/${pin.artifact.fileName}`,
				}],
			},
		};
	}
	assert.equal(binding.kind, 'converted-output', 'Unknown model supply binding.');
	const candidate = supply.candidates.find(({ id }) => id === binding.supplyId);
	const recipe = execution.recipes.find(({ candidateId }) => candidateId === binding.supplyId);
	assert.equal(candidate?.conversion.status, 'converted-artifact-ready');
	assert.equal(recipe?.outputManifest.status, 'verified');
	assert.deepEqual(recipe.blockedBy, [], 'Conversion evidence is incomplete.');
	const retained = conversionEvidence.get(binding.supplyId);
	assert.ok(retained, 'Retained conversion evidence is missing.');
	validateMilestone7ConversionEvidence(retained, {
		executionRegister: execution,
		modelSupply: supply,
		parityFixtures,
	});
	const converted = candidate.conversion.outputs.find(({ role }) => role === binding.outputRole);
	assert.equal(converted?.sha256, task.artifacts[0].sha256);
	assert.equal(converted?.byteLength, task.artifacts[0].byteLength);
	const reproduced = recipe.outputManifest.artifacts.find(({ role }) => role === binding.outputRole);
	assert.equal(reproduced?.sha256, converted.sha256,
		'Converted output differs from reproduced artifact identity.');
	assert.equal(reproduced?.byteLength, converted.byteLength,
		'Converted output length differs from reproduced artifact identity.');
	const sourceArtifacts = candidate.source.artifacts.map((source) => {
		const readback = recipe.sourceArtifacts.find(({ role }) => role === source.role);
		assert.match(readback?.sha256Readback, SHA256);
		return {
			fileName: source.fileName.replace(/[^A-Za-z\d._-]/gu, '-'),
			byteLength: source.byteLength,
			sha256: readback.sha256Readback,
			url: source.url,
		};
	});
	return {
		distribution: {
			kind: 'reproducibly-derived',
			recipe: 'config/milestone-7-model-conversion-execution.json',
			revision: recipeRevision,
			environmentSha256: candidate.conversion.recipe.toolchain.sha256,
		},
		upstream: {
			source: candidate.source.code.url,
			revision: candidate.source.code.revision,
			artifacts: sourceArtifacts,
		},
	};
}

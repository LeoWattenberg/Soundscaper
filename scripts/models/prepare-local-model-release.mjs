#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareLocalModelReleaseBundle, verifyReviewedLocalModelReleaseBundle,
	verifyLocalModelRecipeRevision, writeLocalModelReleaseReview } from './local-model-release-bundle.mjs';

const root = resolve(import.meta.dirname, '../..');
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
	const flag = process.argv[index];
	const value = process.argv[index + 1];
	if (!['--output', '--models', '--recipe-revision', '--verify-catalog'].includes(flag) || !value || options.has(flag)) {
		throw new Error('Use --output directory --models comma-separated-ids --recipe-revision committed-sha, or --output directory --verify-catalog file.');
	}
	options.set(flag, value);
}
if (!options.has('--output')) throw new Error('Choose an --output directory for the review bundle.');
const output = resolve(options.get('--output'));
const read = async (file) => JSON.parse(await readFile(resolve(root, file), 'utf8'));
const catalog = await read('config/local-model-catalog.json');
if (options.has('--verify-catalog')) {
	if (options.size !== 2) throw new Error('Catalog verification accepts only --output and --verify-catalog.');
	const bundle = JSON.parse(await readFile(resolve(output, 'release-bundle.json'), 'utf8'));
	const reviewed = JSON.parse(await readFile(resolve(options.get('--verify-catalog')), 'utf8'));
	const result = verifyReviewedLocalModelReleaseBundle(bundle, reviewed, catalog);
	console.log(`Verified the reviewed catalog and its exact SHA-256-pinned payload (${result.entries.length} models). Production files were not changed.`);
} else {
	if (!options.has('--models') || !options.has('--recipe-revision')) throw new Error('Preparation requires --models and --recipe-revision.');
	await verifyLocalModelRecipeRevision({ repositoryRoot: root, recipeRevision: options.get('--recipe-revision') });
	const modelIds = options.get('--models').split(',');
	const tasks = (await read('config/milestone-7-model-catalog-tasks.json')).tasks;
	const candidateIds = [...new Set(modelIds.map((modelId) => tasks.find(({ catalogModelId }) => catalogModelId === modelId))
		.filter((task) => task?.supplyBinding.kind === 'converted-output').map((task) => task.supplyBinding.supplyId))];
	const conversionEvidence = new Map(await Promise.all(candidateIds.map(async (id) => [id,
		await read(`evidence/milestone-7-model-conversion/${id}/conversion-evidence.json`)])));
	const publications = new Map(await Promise.all(modelIds.map(async (modelId) => {
		if (!/^[a-z\d][a-z\d.-]+$/u.test(modelId)) throw new Error('Invalid model identity.');
		return [modelId, await readFile(resolve(root, `evidence/local-model-publication/${modelId}.json`))];
	})));
	const bundle = prepareLocalModelReleaseBundle({ catalog, modelIds, publications,
		licensingEvidence: (await read('config/production-licensing-matrix.json')).localModelEvidence,
		tasks, conversionEvidence,
		parityFixtures: await read('config/milestone-7-model-parity-fixtures.json'),
		supply: await read('config/milestone-7-model-supply-candidates.json'),
		execution: await read('config/milestone-7-model-conversion-execution.json'),
		notices: await readFile(resolve(root, 'THIRD_PARTY_LICENSES.md'), 'utf8'),
		recipeRevision: options.get('--recipe-revision') });
	await writeLocalModelReleaseReview({ repositoryRoot: root, output, bundle });
	console.log(`Prepared ${modelIds.length} catalog additions for review. Payload SHA-256: ${bundle.payloadSha256}. Production files were not changed.`);
}

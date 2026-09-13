#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Verify local-model catalog release evidence without writing or publishing. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateMilestone7ModelCatalogTaskRegister } from './milestone-7-model-catalog-tasks.mjs';
import {
	verifyLocalModelCatalogInclusion,
	verifyLocalModelRecipeRevision,
} from './local-model-release-bundle.mjs';

const root = resolve(import.meta.dirname, '../..');
if (process.argv.length !== 2
	&& !(process.argv.length === 4 && process.argv[2] === '--models' && process.argv[3] !== '')) {
	throw new Error('The local-model release verifier accepts only an optional --models comma-separated-list.');
}

const read = async (file) => JSON.parse(await readFile(resolve(root, file), 'utf8'));
const catalog = await read('config/local-model-catalog.json');
const taskRegister = await read('config/milestone-7-model-catalog-tasks.json');
const supply = await read('config/milestone-7-model-supply-candidates.json');
const execution = await read('config/milestone-7-model-conversion-execution.json');
const parityFixtures = await read('config/milestone-7-model-parity-fixtures.json');
const admittedTasks = validateMilestone7ModelCatalogTaskRegister(taskRegister, {
	modelSupply: supply,
	parityFixtures,
	conversionExecution: execution,
	runtimeSupply: await read('config/assistance-runtime-family-supply-candidates.json'),
	catalogEntries: catalog.entries,
}).tasks;
const modelIds = process.argv.length === 4
	? process.argv[3].split(',')
	: admittedTasks.map(({ catalogModelId }) => catalogModelId);
const selectedTasks = modelIds.map((modelId) => {
	const task = admittedTasks.find(({ catalogModelId }) => catalogModelId === modelId);
	if (!task) throw new Error(`Unknown catalog release task: ${modelId}`);
	return task;
});
const convertedSupplyIds = [...new Set(selectedTasks
	.filter(({ supplyBinding }) => supplyBinding.kind === 'converted-output')
	.map(({ supplyBinding }) => supplyBinding.supplyId))];
const conversionEvidence = new Map(await Promise.all(convertedSupplyIds.map(async (id) => [id,
	await read(`evidence/milestone-7-model-conversion/${id}/conversion-evidence.json`)])));
const publications = new Map(await Promise.all(modelIds.map(async (modelId) => [modelId,
	await readFile(resolve(root, `evidence/local-model-publication/${modelId}.json`))])));

const report = verifyLocalModelCatalogInclusion({
	catalog,
	modelIds,
	publications,
	licensingEvidence: (await read('config/production-licensing-matrix.json')).localModelEvidence,
	tasks: admittedTasks,
	conversionEvidence,
	parityFixtures,
	supply,
	execution,
	notices: await readFile(resolve(root, 'THIRD_PARTY_LICENSES.md'), 'utf8'),
});
const recipeRevisions = new Set(selectedTasks
	.filter(({ supplyBinding }) => supplyBinding.kind === 'converted-output')
	.map(({ catalogModelId }) => catalog.entries.find(({ modelId }) => modelId === catalogModelId)
		.distribution.revision));
for (const recipeRevision of recipeRevisions) {
	await verifyLocalModelRecipeRevision({ repositoryRoot: root, recipeRevision });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

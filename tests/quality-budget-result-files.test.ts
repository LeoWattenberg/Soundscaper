import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	verifyQualityBudgetResultFiles,
} from '../scripts/verify-quality-budget-result.mjs';

const SOURCE_REVISION = 'c'.repeat(40);

function qualityConfig() {
	return {
		measurementPolicy: { benchmarkRetries: 0 },
		environments: [{
			id: 'reference-linux-node-01',
			status: 'active',
			qualificationEligible: true,
			rendererRequirement: 'any',
			eligibleWorkloadIds: ['m2-direct-output-memory'],
			fingerprint: {
				architecture: 'x64',
				nodeVersion: '26.5.0',
				osImage: 'debian-13.1',
			},
		}],
		workloads: [{
			id: 'm2-direct-output-memory',
			fixtureIds: ['m2-direct-output-v1'],
			environmentIds: ['reference-linux-node-01'],
			thresholds: [{
				metricId: 'output.maximumOwnedBytes',
				comparison: 'lte',
				value: 64 * 1024 * 1024,
				unit: 'bytes',
			}],
		}],
	};
}

function sha256(bytes: string | Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-quality-result-'));
	const configPath = join(directory, 'quality-budgets.json');
	const resultPath = join(directory, 'accepted-summary.json');
	const rawPath = join(directory, 'raw-measurement.json');
	const configBytes = `${JSON.stringify(qualityConfig(), null, '\t')}\n`;
	const rawBytes = '{"samples":[50331648]}\n';
	const result = {
		schemaVersion: 1,
		workloadId: 'm2-direct-output-memory',
		fixtureIds: ['m2-direct-output-v1'],
		environmentId: 'reference-linux-node-01',
		environmentFingerprint: {
			architecture: 'x64',
			nodeVersion: '26.5.0',
			osImage: 'debian-13.1',
		},
		rendererClass: 'unknown',
		budgetSha256: sha256(configBytes),
		sourceRevision: SOURCE_REVISION,
		attemptCount: 1,
		retryCount: 0,
		rawEvidence: {
			artifactName: 'raw-measurement.json',
			byteLength: Buffer.byteLength(rawBytes),
			sha256: sha256(rawBytes),
		},
		metrics: { 'output.maximumOwnedBytes': 48 * 1024 * 1024 },
	};
	await Promise.all([
		writeFile(configPath, configBytes),
		writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`),
		writeFile(rawPath, rawBytes),
	]);
	return { configPath, directory, rawPath, result, resultPath };
}

test('file verification hashes exact budget, raw evidence, and source revision bytes', async () => {
	const files = await fixture();
	const evaluation = await verifyQualityBudgetResultFiles({
		configPath: files.configPath,
		resultPath: files.resultPath,
		expectedSourceRevision: SOURCE_REVISION,
	});

	assert.equal(evaluation.passed, true);
	assert.deepEqual(evaluation.failures, []);
	assert.equal(Object.isFrozen(evaluation), true);
	assert.equal(Object.isFrozen(evaluation.failures), true);
});

test('tampered budget, evidence, and source revision each refuse the result', async () => {
	const cases: readonly [string, (files: Awaited<ReturnType<typeof fixture>>) => Promise<void>, RegExp][] = [
		['budget', async ({ configPath }) => {
			const config = JSON.parse(await readFile(configPath, 'utf8')) as ReturnType<typeof qualityConfig>;
			config.workloads[0].thresholds[0].value += 1;
			await writeFile(configPath, `${JSON.stringify(config, null, '\t')}\n`);
		}, /budget digest/iu],
		['evidence body', async ({ rawPath }) => {
			await writeFile(rawPath, '{"samples":[1]}\n');
		}, /raw evidence.*(?:byte length|digest)/iu],
		['source revision', async () => {}, /source revision/iu],
	];

	for (const [label, mutate, expectedFailure] of cases) {
		const files = await fixture();
		await mutate(files);
		const evaluation = await verifyQualityBudgetResultFiles({
			configPath: files.configPath,
			resultPath: files.resultPath,
			expectedSourceRevision: label === 'source revision' ? 'd'.repeat(40) : SOURCE_REVISION,
		});
		assert.equal(evaluation.passed, false, label);
		assert.match(evaluation.failures.join('\n'), expectedFailure, label);
	}
});

test('missing, escaping, and self-referential raw evidence is refused', async () => {
	for (const artifactName of ['missing.json', '../outside.json', 'accepted-summary.json']) {
		const files = await fixture();
		files.result.rawEvidence.artifactName = artifactName;
		await writeFile(files.resultPath, `${JSON.stringify(files.result, null, '\t')}\n`);
		const evaluation = await verifyQualityBudgetResultFiles({
			configPath: files.configPath,
			resultPath: files.resultPath,
			expectedSourceRevision: SOURCE_REVISION,
		});
		assert.equal(evaluation.passed, false, artifactName);
		assert.match(evaluation.failures.join('\n'), /raw evidence/iu, artifactName);
	}
});

test('ambiguous workload and environment descriptors fail before evaluation', async () => {
	for (const collection of ['workloads', 'environments'] as const) {
		const files = await fixture();
		const config = JSON.parse(await readFile(files.configPath, 'utf8')) as ReturnType<typeof qualityConfig>;
		config[collection].push(structuredClone(config[collection][0]) as never);
		const configBytes = `${JSON.stringify(config, null, '\t')}\n`;
		files.result.budgetSha256 = sha256(configBytes);
		await Promise.all([
			writeFile(files.configPath, configBytes),
			writeFile(files.resultPath, `${JSON.stringify(files.result, null, '\t')}\n`),
		]);

		const evaluation = await verifyQualityBudgetResultFiles({
			configPath: files.configPath,
			resultPath: files.resultPath,
			expectedSourceRevision: SOURCE_REVISION,
		});
		assert.equal(evaluation.passed, false, collection);
		assert.match(evaluation.failures.join('\n'), /exactly one.*descriptor/iu, collection);
	}
});

test('an eligible environment cannot evaluate an out-of-scope workload', async () => {
	const files = await fixture();
	const config = JSON.parse(await readFile(files.configPath, 'utf8')) as ReturnType<typeof qualityConfig>;
	config.environments[0].eligibleWorkloadIds = ['another-workload'];
	const configBytes = `${JSON.stringify(config, null, '\t')}\n`;
	files.result.budgetSha256 = sha256(configBytes);
	await Promise.all([
		writeFile(files.configPath, configBytes),
		writeFile(files.resultPath, `${JSON.stringify(files.result, null, '\t')}\n`),
	]);

	const evaluation = await verifyQualityBudgetResultFiles({
		configPath: files.configPath,
		resultPath: files.resultPath,
		expectedSourceRevision: SOURCE_REVISION,
	});
	assert.equal(evaluation.passed, false);
	assert.match(evaluation.failures.join('\n'), /environment.*not eligible.*workload/iu);
});

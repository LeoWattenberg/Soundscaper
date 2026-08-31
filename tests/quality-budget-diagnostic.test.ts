import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	writeStructuralQualityBudgetDiagnostic,
} from '../scripts/quality-budget-diagnostic.mjs';

const SOURCE_REVISION = 'c'.repeat(40);

interface CollectorRuntime {
	readonly architecture: string;
	readonly gitStatus: string;
	readonly nodeVersion: string;
	readonly npmVersion: string;
	readonly platform: string;
	readonly sourceRevision: string;
}

const runtime: CollectorRuntime = Object.freeze({
	architecture: 'x64',
	gitStatus: '',
	nodeVersion: '26.5.0',
	npmVersion: '12.0.1',
	platform: 'linux',
	sourceRevision: SOURCE_REVISION,
});

async function outputDirectory(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'soundscaper-quality-diagnostic-'));
}

function options(directory: string) {
	return {
		configPath: new URL('../config/quality-budgets.json', import.meta.url),
		outputDirectory: directory,
		workloadId: 'm2-direct-wav-385mib-v1',
		metrics: {
			'directWav.maximumPathOwnedBinaryBytes': 41_943_384,
			'directWav.maximumDestinationWriteBytes': 4_194_304,
			'directWav.retainedOutputPayloadBytes': 0,
			'directWav.oversizePreflightBytesRead': 0,
			'directWav.partialPublishedOutputs': 0,
		},
		observations: {
			outputFileBytes: 403_701_804,
			outputSha256: 'f1978598e11527049bcafae0f1d4847238e5322e11fddf714cc9f298bf12f9fe',
			renderPackets: 193,
		},
	};
}

test('one clean structural run writes and re-verifies raw and result diagnostics', async () => {
	const directory = await outputDirectory();
	const written = await writeStructuralQualityBudgetDiagnostic(options(directory), runtime);

	assert.equal(written.evaluation.passed, true);
	assert.equal(written.rawPath, join(directory, 'm2-direct-wav-385mib-v1.raw.json'));
	assert.equal(written.resultPath, join(directory, 'm2-direct-wav-385mib-v1.result.json'));
	const [raw, result] = await Promise.all([
		readFile(written.rawPath, 'utf8').then(JSON.parse),
		readFile(written.resultPath, 'utf8').then(JSON.parse),
	]);
	assert.deepEqual(raw, {
		schemaVersion: 1,
		workloadId: 'm2-direct-wav-385mib-v1',
		environmentId: 'portable-node-structural-26.5.0',
		environmentFingerprint: {
			platform: 'linux',
			architecture: 'x64',
			nodeVersion: '26.5.0',
			npmVersion: '12.0.1',
			measurementClass: 'first-party-owned-structural-counters',
		},
		sourceRevision: SOURCE_REVISION,
		attemptCount: 1,
		retryCount: 0,
		metrics: options(directory).metrics,
		observations: options(directory).observations,
	});
	assert.equal(result.sourceRevision, SOURCE_REVISION);
	assert.equal(result.rawArtifact.artifactName, 'm2-direct-wav-385mib-v1.raw.json');
	assert.deepEqual(result.metrics, raw.metrics);
});

test('dirty source, environment drift, and failed metrics refuse before writing', async () => {
	const cases: readonly [string, typeof runtime, (value: ReturnType<typeof options>) => void, RegExp][] = [
		['dirty', { ...runtime, gitStatus: ' M src/file.ts' }, () => {}, /clean checkout/iu],
		['npm drift', { ...runtime, npmVersion: '12.0.2' }, () => {}, /environment fingerprint/iu],
		['failed metric', runtime, (value) => {
			value.metrics['directWav.maximumPathOwnedBinaryBytes'] = 67_108_865;
		}, /expected lte/iu],
	];

	for (const [label, actualRuntime, mutate, expectedFailure] of cases) {
		const directory = await outputDirectory();
		const value = options(directory);
		mutate(value);
		await assert.rejects(
			writeStructuralQualityBudgetDiagnostic(value, actualRuntime),
			expectedFailure,
			label,
		);
		await assert.rejects(readFile(join(directory, 'm2-direct-wav-385mib-v1.raw.json')), label);
	}
});

test('existing diagnostics are never overwritten', async () => {
	const directory = await outputDirectory();
	const first = await writeStructuralQualityBudgetDiagnostic(options(directory), runtime);
	const originalRaw = await readFile(first.rawPath);

	await assert.rejects(
		writeStructuralQualityBudgetDiagnostic(options(directory), runtime),
		/already exists/iu,
	);
	assert.deepEqual(await readFile(first.rawPath), originalRaw);
});

test('collector inputs must be immutable own-data snapshots without invoked accessors', async () => {
	for (const property of ['metrics', 'observations'] as const) {
		const directory = await outputDirectory();
		const value = options(directory) as unknown as Record<string, unknown>;
		const original = value[property];
		let reads = 0;
		Object.defineProperty(value, property, {
			enumerable: true,
			get() {
				reads += 1;
				return original;
			},
		});
		await assert.rejects(
			writeStructuralQualityBudgetDiagnostic(value as never, runtime),
			/own data properties/iu,
			property,
		);
		assert.equal(reads, 0, property);
	}
});

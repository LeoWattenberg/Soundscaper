/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateQualityBudgetResult } from '../scripts/quality-budget-result.mjs';

const BUDGET_SHA256 = 'a'.repeat(64);
const EVIDENCE_SHA256 = 'b'.repeat(64);
const SOURCE_REVISION = 'c'.repeat(40);
interface DiagnosticResult {
	schemaVersion: number;
	workloadId: string;
	fixtureIds: string[];
	environmentId: string;
	environmentFingerprint: Record<string, string>;
	rendererClass: string;
	budgetSha256: string;
	sourceRevision: string;
	attemptCount: number;
	retryCount: number;
	rawArtifact: { artifactName: string; byteLength: number; sha256: string };
	metrics: Record<string, number>;
}
const workload = Object.freeze({
	id: 'm2-direct-output-memory',
	fixtureIds: Object.freeze(['m2-direct-output-v1']),
	thresholds: Object.freeze([
		Object.freeze({
			metricId: 'output.maximumOwnedBytes', behavior: 'observational',
			comparison: 'lte', value: 64 * 1024 * 1024, unit: 'bytes',
		}),
		Object.freeze({
			metricId: 'output.partialPublishedOutputs', behavior: 'blocking',
			comparison: 'eq', value: 0, unit: 'count',
		}),
	]),
});

function diagnosticResult(): DiagnosticResult {
	return {
		schemaVersion: 1,
		workloadId: workload.id,
		fixtureIds: [...workload.fixtureIds],
		environmentId: 'observed-node-runtime',
		environmentFingerprint: { platform: 'linux', architecture: 'x64' },
		rendererClass: 'unknown',
		budgetSha256: BUDGET_SHA256,
		sourceRevision: SOURCE_REVISION,
		attemptCount: 1,
		retryCount: 0,
		rawArtifact: {
			artifactName: 'm2-direct-output-memory.json',
			byteLength: 4096,
			sha256: EVIDENCE_SHA256,
		},
		metrics: {
			'output.maximumOwnedBytes': 48 * 1024 * 1024,
			'output.partialPublishedOutputs': 0,
		},
	};
}

function evaluate(result: unknown) {
	return evaluateQualityBudgetResult({ workload, expectedBudgetSha256: BUDGET_SHA256 }, result);
}

test('an exact digest-bound no-retry diagnostic evaluates the owning workload', () => {
	const evaluation = evaluate(diagnosticResult());
	assert.equal(evaluation.passed, true);
	assert.deepEqual(evaluation.failures, []);
	assert.equal(Object.isFrozen(evaluation), true);
	assert.ok(evaluation.verdicts.every((verdict) => Object.isFrozen(verdict)));
});

test('result identity, provenance, attempt, and metric mismatches fail closed', () => {
	const cases: readonly [string, (result: ReturnType<typeof diagnosticResult>) => void, RegExp][] = [
		['workload', (result) => { result.workloadId = 'another-workload'; }, /workload.*another-workload/iu],
		['fixture', (result) => { result.fixtureIds = ['another-fixture']; }, /fixture IDs/iu],
		['environment', (result) => { result.environmentId = ''; }, /environment ID/iu],
		['fingerprint', (result) => { result.environmentFingerprint = {}; }, /environment fingerprint/iu],
		['budget', (result) => { result.budgetSha256 = 'd'.repeat(64); }, /budget digest/iu],
		['source revision', (result) => { result.sourceRevision = 'not-a-revision'; }, /source revision/iu],
		['attempt count', (result) => { result.attemptCount = 2; }, /one no-retry attempt/iu],
		['retry count', (result) => { result.retryCount = 1; }, /retry count/iu],
		['artifact name', (result) => { result.rawArtifact.artifactName = '../escape.json'; }, /artifact name/iu],
		['artifact length', (result) => { result.rawArtifact.byteLength = 0; }, /artifact byte length/iu],
		['artifact digest', (result) => { result.rawArtifact.sha256 = 'nope'; }, /artifact digest/iu],
		['missing metric', (result) => { delete result.metrics['output.maximumOwnedBytes']; }, /exact threshold metric set/iu],
		['extra metric', (result) => { result.metrics['output.elapsedMs'] = 1; }, /exact threshold metric set/iu],
		['non-finite metric', (result) => { result.metrics['output.partialPublishedOutputs'] = Number.NaN; }, /finite/iu],
	];
	for (const [label, mutate, expectedFailure] of cases) {
		const result = diagnosticResult();
		mutate(result);
		const evaluation = evaluate(result);
		assert.equal(evaluation.passed, false, label);
		assert.match(evaluation.failures.join('\n'), expectedFailure, label);
	}
});

test('result records must be exact own-data snapshots and accessors are never invoked', () => {
	for (const property of ['metrics', 'rawArtifact', 'environmentFingerprint'] as const) {
		let reads = 0;
		const result = diagnosticResult() as unknown as Record<string, unknown>;
		const value = result[property];
		Object.defineProperty(result, property, {
			enumerable: true,
			get() { reads += 1; return value; },
		});
		const evaluation = evaluate(result);
		assert.equal(evaluation.passed, false, property);
		assert.match(evaluation.failures.join('\n'), /own data properties/iu, property);
		assert.equal(reads, 0, property);
	}
});

test('the runtime fingerprint is retained as observation, not matched to a lab profile', () => {
	const result = diagnosticResult();
	result.environmentId = 'a-different-local-runtime';
	result.environmentFingerprint = { platform: 'darwin', architecture: 'arm64' };
	assert.equal(evaluate(result).passed, true);
});

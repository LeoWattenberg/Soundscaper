import assert from 'node:assert/strict';
import test from 'node:test';

import {
	evaluateQualityBudgetResult,
} from '../scripts/quality-budget-result.mjs';

const BUDGET_SHA256 = 'a'.repeat(64);
const EVIDENCE_SHA256 = 'b'.repeat(64);
const SOURCE_REVISION = 'c'.repeat(40);

interface ExpectedEnvironment {
	readonly fingerprint: Readonly<Record<string, string | number>>;
	readonly id: string;
	readonly qualificationEligible: boolean;
	readonly rendererRequirement: 'any' | 'hardware';
	readonly status: 'active' | 'unprovisioned';
}

interface AcceptedResult {
	attemptCount: number;
	budgetSha256: string;
	environmentFingerprint: Record<string, string | number>;
	environmentId: string;
	fixtureIds: string[];
	metrics: Record<string, number>;
	rawEvidence: {
		artifactName: string;
		byteLength: number;
		sha256: string;
	};
	rendererClass: string;
	retryCount: number;
	schemaVersion: number;
	sourceRevision: string;
	workloadId: string;
}

const workload = Object.freeze({
	id: 'm2-direct-output-memory',
	fixtureIds: Object.freeze(['m2-direct-output-v1']),
	environmentIds: Object.freeze(['reference-linux-node-01']),
	thresholds: Object.freeze([
		Object.freeze({
			metricId: 'output.maximumOwnedBytes',
			comparison: 'lte',
			value: 64 * 1024 * 1024,
			unit: 'bytes',
		}),
		Object.freeze({
			metricId: 'output.partialPublishedOutputs',
			comparison: 'eq',
			value: 0,
			unit: 'count',
		}),
	]),
});

const environment: ExpectedEnvironment = Object.freeze({
	id: 'reference-linux-node-01',
	status: 'active',
	qualificationEligible: true,
	rendererRequirement: 'any',
	fingerprint: Object.freeze({
		architecture: 'x64',
		logicalCpuCount: 8,
		memoryBytes: 16 * 1024 * 1024 * 1024,
		nodeVersion: '26.5.0',
		osImage: 'debian-13.1',
	}),
});

const measurementPolicy = Object.freeze({ benchmarkRetries: 0 });

function acceptedResult(): AcceptedResult {
	return {
		schemaVersion: 1,
		workloadId: workload.id,
		fixtureIds: [...workload.fixtureIds],
		environmentId: environment.id,
		environmentFingerprint: { ...environment.fingerprint },
		rendererClass: 'unknown',
		budgetSha256: BUDGET_SHA256,
		sourceRevision: SOURCE_REVISION,
		attemptCount: 1,
		retryCount: 0,
		rawEvidence: {
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

function evaluate(result: unknown, overrides: {
	readonly expectedBudgetSha256?: string;
	readonly expectedEnvironment?: typeof environment;
} = {}) {
	return evaluateQualityBudgetResult({
		workload,
		expectedEnvironment: overrides.expectedEnvironment ?? environment,
		expectedBudgetSha256: overrides.expectedBudgetSha256 ?? BUDGET_SHA256,
		measurementPolicy,
	}, result);
}

test('an exact digest-bound no-retry result evaluates the owning workload', () => {
	const evaluation = evaluate(acceptedResult());

	assert.equal(evaluation.passed, true);
	assert.deepEqual(evaluation.failures, []);
	assert.equal(Object.isFrozen(evaluation), true);
	assert.equal(Object.isFrozen(evaluation.failures), true);
	assert.equal(Object.isFrozen(evaluation.verdicts), true);
	assert.ok(evaluation.verdicts.every((verdict: unknown) => Object.isFrozen(verdict)));
});

test('result identity, provenance, attempt, and metric mismatches fail closed', () => {
	const cases: readonly [string, (result: ReturnType<typeof acceptedResult>) => void, RegExp][] = [
		['workload', (result) => { result.workloadId = 'another-workload'; }, /workload.*another-workload/iu],
		['fixture', (result) => { result.fixtureIds = ['another-fixture']; }, /fixture IDs/iu],
		['environment', (result) => { result.environmentId = 'another-host'; }, /environment mismatch/iu],
		['fingerprint', (result) => { result.environmentFingerprint.memoryBytes = 1; }, /environment fingerprint/iu],
		['budget', (result) => { result.budgetSha256 = 'd'.repeat(64); }, /budget digest/iu],
		['source revision', (result) => { result.sourceRevision = 'not-a-revision'; }, /source revision/iu],
		['attempt count', (result) => { result.attemptCount = 2; }, /one no-retry attempt/iu],
		['retry count', (result) => { result.retryCount = 1; }, /retry count/iu],
		['artifact name', (result) => { result.rawEvidence.artifactName = '../escape.json'; }, /artifact name/iu],
		['evidence length', (result) => { result.rawEvidence.byteLength = 0; }, /evidence byte length/iu],
		['evidence digest', (result) => { result.rawEvidence.sha256 = 'nope'; }, /evidence digest/iu],
		['missing metric', (result) => { delete result.metrics['output.maximumOwnedBytes']; }, /exact threshold metric set/iu],
		['extra metric', (result) => { result.metrics['output.elapsedMs'] = 1; }, /exact threshold metric set/iu],
		['non-finite metric', (result) => { result.metrics['output.maximumOwnedBytes'] = Number.NaN; }, /finite/iu],
	];

	for (const [label, mutate, expectedFailure] of cases) {
		const result = acceptedResult();
		mutate(result);
		const evaluation = evaluate(result);
		assert.equal(evaluation.passed, false, label);
		assert.match(evaluation.failures.join('\n'), expectedFailure, label);
	}
});

test('result records must be exact own-data snapshots and accessors are never invoked', () => {
	for (const property of ['metrics', 'rawEvidence', 'environmentFingerprint'] as const) {
		let reads = 0;
		const result = acceptedResult() as unknown as Record<string, unknown>;
		const value = result[property];
		Object.defineProperty(result, property, {
			enumerable: true,
			get() {
				reads += 1;
				return value;
			},
		});

		const evaluation = evaluate(result);
		assert.equal(evaluation.passed, false, property);
		assert.match(evaluation.failures.join('\n'), /own data properties/iu, property);
		assert.equal(reads, 0, property);
	}

	const extra = acceptedResult() as unknown as Record<string, unknown>;
	extra.unreviewed = true;
	const extraEvaluation = evaluate(extra);
	assert.equal(extraEvaluation.passed, false);
	assert.match(extraEvaluation.failures.join('\n'), /exact result fields/iu);
});

test('an ineligible environment cannot be promoted by an otherwise passing result', () => {
	const evaluation = evaluate(acceptedResult(), {
		expectedEnvironment: {
			...environment,
			status: 'unprovisioned',
			qualificationEligible: false,
		},
	});

	assert.equal(evaluation.passed, false);
	assert.match(evaluation.failures.join('\n'), /unprovisioned/iu);
	assert.match(evaluation.failures.join('\n'), /not qualification-eligible/iu);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	auditQualityResultCohorts,
} from '../scripts/audit-quality-result-cohorts.mjs';

const SOURCE_REVISION = 'a'.repeat(40);
const WORKLOAD_ID = 'm2-structural-v1';

function sha256(bytes: string | Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function fixture() {
	const historical = {
		measurementPolicy: { benchmarkRetries: 0 },
		environments: [{
			id: 'structural-node', status: 'active', qualificationEligible: true,
			rendererRequirement: 'any', eligibleWorkloadIds: [WORKLOAD_ID],
			fingerprint: { nodeVersion: '26.5.0' },
		}],
		workloads: [{
			id: WORKLOAD_ID,
			status: 'qualified',
			fixtureIds: [WORKLOAD_ID],
			environmentIds: ['structural-node'],
			thresholds: [{ metricId: 'owned.bytes', comparison: 'lte', value: 64, unit: 'bytes' }],
		}],
	};
	const historicalBytes = `${JSON.stringify(historical, null, '\t')}\n`;
	const raw = {
		schemaVersion: 1,
		workloadId: WORKLOAD_ID,
		environmentId: 'structural-node',
		environmentFingerprint: { nodeVersion: '26.5.0' },
		sourceRevision: SOURCE_REVISION,
		attemptCount: 1,
		retryCount: 0,
		metrics: { 'owned.bytes': 32 },
		observations: { writes: 1 },
	};
	const rawBytes = `${JSON.stringify(raw, null, '\t')}\n`;
	const result = {
		schemaVersion: 1,
		workloadId: WORKLOAD_ID,
		fixtureIds: [WORKLOAD_ID],
		environmentId: 'structural-node',
		environmentFingerprint: { nodeVersion: '26.5.0' },
		rendererClass: 'unknown',
		budgetSha256: sha256(historicalBytes),
		sourceRevision: SOURCE_REVISION,
		attemptCount: 1,
		retryCount: 0,
		rawEvidence: {
			artifactName: `${WORKLOAD_ID}.raw.json`,
			byteLength: Buffer.byteLength(rawBytes),
			sha256: sha256(rawBytes),
		},
		metrics: { 'owned.bytes': 32 },
	};
	const resultBytes = `${JSON.stringify(result, null, '\t')}\n`;
	const config = {
		qualification: {
			qualifiedWorkloadIds: [WORKLOAD_ID],
			acceptedResultCohorts: [{
				id: 'cohort',
				sourceRevision: SOURCE_REVISION,
				budgetSha256: sha256(historicalBytes),
				environmentId: 'structural-node',
				attemptCount: 1,
				retryCount: 0,
				retention: 'reviewed',
				artifacts: [{
					workloadId: WORKLOAD_ID,
					resultByteLength: Buffer.byteLength(resultBytes),
					resultSha256: sha256(resultBytes),
					rawByteLength: Buffer.byteLength(rawBytes),
					rawSha256: sha256(rawBytes),
				}],
			}],
		},
		workloads: [{ id: WORKLOAD_ID, status: 'qualified' }],
	};
	return { config, historicalBytes, rawBytes, resultBytes };
}

test('cohort audit binds qualified IDs, historical budget, results, and raw bodies', async () => {
	const value = fixture();
	const audit = await auditQualityResultCohorts(value.config, {
		loadHistoricalBudget: async () => Buffer.from(value.historicalBytes),
		loadArtifact: async (_cohort: unknown, _artifact: unknown, kind: 'raw' | 'result') =>
			Buffer.from(kind === 'raw' ? value.rawBytes : value.resultBytes),
	});

	assert.equal(audit.passed, true);
	assert.deepEqual(audit.failures, []);
	assert.equal(audit.cohortCount, 1);
	assert.equal(audit.artifactCount, 1);
	assert.equal(Object.isFrozen(audit), true);
});

test('historical budget, result set, and body tampering fail closed', async () => {
	const cases: readonly [string, (value: ReturnType<typeof fixture>) => void, RegExp][] = [
		['budget', (value) => { value.historicalBytes += ' '; }, /historical budget digest/iu],
		['qualified set', (value) => { value.config.qualification.qualifiedWorkloadIds.push('missing'); }, /qualified workload set/iu],
		['raw body', (value) => { value.rawBytes += ' '; }, /raw artifact.*(?:length|digest)/iu],
		['result body', (value) => { value.resultBytes += ' '; }, /result artifact.*(?:length|digest)/iu],
	];

	for (const [label, mutate, expectedFailure] of cases) {
		const value = fixture();
		mutate(value);
		const audit = await auditQualityResultCohorts(value.config, {
			loadHistoricalBudget: async () => Buffer.from(value.historicalBytes),
			loadArtifact: async (_cohort: unknown, _artifact: unknown, kind: 'raw' | 'result') =>
				Buffer.from(kind === 'raw' ? value.rawBytes : value.resultBytes),
		});
		assert.equal(audit.passed, false, label);
		assert.match(audit.failures.join('\n'), expectedFailure, label);
	}
});

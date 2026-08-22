/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	M5B_QUALITY_PIPELINES,
	createM5bQualityResult,
	m5bQualityBudgetSha256,
} from '../scripts/lib/m5b-quality-pipeline.mjs';
import {
	M5B_QUALITY_COHORT_PLATFORM_IDS,
	createM5bQualityCohort,
	writeM5bQualityCohort,
} from '../scripts/lib/m5b-quality-cohort.mjs';

const BASE_CONFIG = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url), 'utf8',
)) as Record<string, unknown>;
const PROFILE_ID = 'persistent-services';
const SOURCE_REVISION = 'b'.repeat(40);
const DIGEST = 'a'.repeat(64);

test('one accepted target remains single-target evidence and cannot publish qualification', () => {
	const config = provisionedConfig();
	const measurement = measurements(config)[0]!;
	const result = createM5bQualityResult(PROFILE_ID, measurement, config);
	assert.equal(result.status, 'accepted');
	assert.equal(result.qualificationScope, 'single-target');
	assert.equal(result.qualificationEvidencePublished, false);
});

test('only one exact five-target cohort publishes 5B qualification evidence', () => {
	const config = provisionedConfig();
	const cohort = createM5bQualityCohort(PROFILE_ID, measurements(config).reverse(), config);
	assert.equal(cohort.status, 'accepted');
	assert.equal(cohort.qualificationScope, 'five-target-cohort');
	assert.equal(cohort.qualificationEvidencePublished, true);
	assert.deepEqual(cohort.platformIds, M5B_QUALITY_COHORT_PLATFORM_IDS);
	assert.equal(cohort.sourceRevision, SOURCE_REVISION);
	assert.equal(cohort.targets.length, 5);
	assert.ok(cohort.targets.every((target: Readonly<{ status: string }>) => target.status === 'accepted'));
});

test('the cohort refuses missing, duplicate, and cross-revision target evidence', () => {
	const config = provisionedConfig();
	const complete = measurements(config);
	assert.throws(
		() => createM5bQualityCohort(PROFILE_ID, complete.slice(0, 4), config),
		/exactly five|platform/iu,
	);
	assert.throws(
		() => createM5bQualityCohort(PROFILE_ID, [...complete.slice(0, 4), complete[0]], config),
		/duplicate|platform/iu,
	);
	const changed = structuredClone(complete);
	changed[4]!.sourceRevision = 'c'.repeat(40);
	changed[4]!.observedFingerprint.sourceRevision = 'c'.repeat(40);
	assert.throws(
		() => createM5bQualityCohort(PROFILE_ID, changed, config),
		/source revision|fingerprint/iu,
	);
});

test('the cohort writer recomputes the complete matrix before publishing one artifact', async () => {
	const config = provisionedConfig();
	const evidence = measurements(config);
	const cohort = createM5bQualityCohort(PROFILE_ID, evidence, config);
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m5b-cohort-'));
	try {
		const written = await writeM5bQualityCohort(directory, PROFILE_ID, evidence, cohort, config);
		assert.match(written.path, /five-target\.accepted\.json$/u);
		const stored = JSON.parse(await readFile(written.path, 'utf8')) as {
			qualificationEvidencePublished: boolean;
			targets: Array<{ measurementSha256: string }>;
		};
		assert.equal(stored.qualificationEvidencePublished, true);
		assert.equal(stored.targets.length, 5);
		assert.ok(stored.targets.every(({ measurementSha256 }) => /^[a-f0-9]{64}$/u.test(measurementSha256)));
		await assert.rejects(() => writeM5bQualityCohort(
			directory, PROFILE_ID, evidence,
			{ ...cohort, qualificationEvidencePublished: false }, config,
		), /recomputed|cohort/iu);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

function provisionedConfig(): Record<string, unknown> {
	const config = structuredClone(BASE_CONFIG);
	const pipeline = M5B_QUALITY_PIPELINES[PROFILE_ID];
	const environments = config.environments as Array<Record<string, unknown>>;
	const environment = environments.find(({ id }) => id === 'native-os-lab-matrix')!;
	environment.status = 'active';
	environment.qualificationEligible = true;
	environment.eligibleWorkloadIds = [pipeline.workloadId];
	environment.fingerprint = Object.fromEntries(M5B_QUALITY_COHORT_PLATFORM_IDS.map((platformId) => [
		platformId, fingerprint(platformId),
	]));
	const fixtures = config.fixtures as Array<Record<string, unknown>>;
	fixtures.find(({ id }) => id === pipeline.fixtureId)!.status = 'qualified';
	const workloads = config.workloads as Array<Record<string, unknown>>;
	workloads.find(({ id }) => id === pipeline.workloadId)!.status = 'qualified';
	(config.qualification as Record<string, unknown>).qualifiedWorkloadIds = [pipeline.workloadId];
	return config;
}

function measurements(config: Record<string, unknown>): Array<Record<string, unknown> & {
	observedFingerprint: Record<string, unknown>;
}> {
	const pipeline = M5B_QUALITY_PIPELINES[PROFILE_ID];
	const workload = (config.workloads as Array<Record<string, unknown>>)
		.find(({ id }) => id === pipeline.workloadId)!;
	const thresholds = workload.thresholds as Array<Readonly<{ metricId: string; value: number }>>;
	const budgetSha256 = m5bQualityBudgetSha256(config);
	return M5B_QUALITY_COHORT_PLATFORM_IDS.map((platformId) => ({
		schemaVersion: 1,
		budgetSha256,
		sourceRevision: SOURCE_REVISION,
		attemptCount: 1,
		retryCount: 0,
		profileId: PROFILE_ID,
		workloadId: pipeline.workloadId,
		fixtureId: pipeline.fixtureId,
		environmentId: 'native-os-lab-matrix',
		platformId,
		rendererClass: 'hardware',
		observedFingerprint: fingerprint(platformId),
		metrics: Object.fromEntries(thresholds.map(({ metricId, value }) => [metricId, value])),
		sampleCounts: Object.fromEntries(thresholds.map(({ metricId }) => [metricId, 1])),
	}));
}

function fingerprint(platformId: string): Record<string, unknown> {
	return {
		platformId,
		architecture: platformId === 'windowsArm64' || platformId === 'macosArm64'
			|| platformId === 'linuxArm64' ? 'arm64' : 'x64',
		osVersion: 'qualification-fixture',
		cpuModel: 'qualification-fixture',
		gpuModel: 'qualification-fixture',
		driverVersion: 'qualification-fixture',
		packageSha256: DIGEST,
		mediaHostSha256: DIGEST,
		workloadRunnerSha256: DIGEST,
		ofxScannerSha256: null,
		ofxRuntimeHostSha256: null,
		sourceRevision: SOURCE_REVISION,
	};
}

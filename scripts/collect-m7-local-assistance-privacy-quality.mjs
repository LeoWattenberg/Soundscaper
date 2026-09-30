#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';

import {
	M7_ASSISTANCE_PRIVACY_ENVIRONMENT_ID as ENVIRONMENT_ID,
	M7_ASSISTANCE_PRIVACY_FIXTURE_ID as FIXTURE_ID,
	M7_ASSISTANCE_PRIVACY_METRIC_IDS as METRIC_IDS,
	M7_ASSISTANCE_PRIVACY_OBSERVATION_CLASS as OBSERVATION_CLASS,
	M7_ASSISTANCE_PRIVACY_PROFILE as PROFILE,
	M7_ASSISTANCE_PRIVACY_WORKLOAD_ID as WORKLOAD_ID,
	canonicalMeasurementSha256,
	computeM7AssistancePrivacyMetrics,
} from './lib/m7-local-assistance-privacy-metrics.mjs';
import {
	DIAGNOSTIC_MEASUREMENT_POLICY,
	evaluateQualityWorkload,
	qualityFixture,
	qualityWorkloadBudget,
} from './lib/quality-budget-config.mjs';
import { qualityBudgetSha256 } from './lib/quality-budget-config-digest.mjs';
import { snapshotStrictJsonData } from './lib/strict-json-snapshot.mjs';
import {
	isDirectExecution,
	normalizeQualityCollectorOptions,
	parseQualityCollectorCliOptions,
	readQualityCollectorMeasurement,
	runQualityCollectorMain,
	sameOrderedStrings,
	writeQualityCollectorResult,
} from './lib/quality-collector-runtime.mjs';

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const PACKAGE_TARGETS = Object.freeze([
	'darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64',
]);
/** Read one real-path trace summary and retain it as a diagnostic. */
export async function collectM7AssistancePrivacyQuality(optionsValue, dependencies = {}) {
	const { measurementPath, outputDirectory } = normalizeQualityCollectorOptions(optionsValue);
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const readMeasurement = dependencies.readMeasurement
		?? ((path) => readQualityCollectorMeasurement(path, 'M7 assistance measurement'));
	const measurement = await readMeasurement(measurementPath);
	const result = createM7AssistancePrivacyResult(measurement, config);
	const writeResult = dependencies.writeResult ?? writeM7AssistancePrivacyResult;
	return writeResult(outputDirectory, result, measurement);
}

/** Recompute every threshold without making a release decision. */
export function createM7AssistancePrivacyResult(measurement, configValue) {
	const config = snapshotStrictJsonData(configValue, 'config');
	const workload = qualityWorkloadBudget(config, WORKLOAD_ID);
	const fixture = qualityFixture(config, FIXTURE_ID);
	const policy = DIAGNOSTIC_MEASUREMENT_POLICY;
	assertWorkloadRegistration(workload);
	assertMeasurementPolicy(policy);
	const computed = computeM7AssistancePrivacyMetrics(measurement, {
		budgetSha256: qualityBudgetSha256(config),
		fixtureSpecification: fixture.specification,
		measurementPolicy: policy,
	});
	const evaluation = evaluateQualityWorkload(config, workload, computed.metrics);
	const metricGatePassed = evaluation.passed;
	const passed = metricGatePassed;
	return Object.freeze({
		schemaVersion: 1,
		status: passed ? 'passed' : 'failed',
		workloadId: WORKLOAD_ID,
		fixtureId: FIXTURE_ID,
		environmentId: ENVIRONMENT_ID,
		observedEnvironmentId: computed.observedEnvironmentId,
		profile: PROFILE,
		observationClass: OBSERVATION_CLASS,
		observationMode: computed.observationMode,
		attemptCount: 1,
		retryCount: policy.benchmarkRetries,
		rendererClass: computed.observedEnvironment.rendererClass,
		budgetSha256: computed.budgetSha256,
		sourceRevision: computed.sourceRevision,
		canonicalMeasurementSha256: computed.canonicalMeasurementSha256,
		observedEnvironment: computed.observedEnvironment,
		observedPackage: computed.package,
		fixture: Object.freeze(snapshotStrictJsonData(fixture.specification, 'fixture.specification')),
		metrics: computed.metrics,
		rawSampleCounts: computed.rawSampleCounts,
		metricGatePassed,
		evaluation,
	});
}

/**
 * Persist the closed raw record and its derived diagnostic.
 * @param {string} outputDirectory
 * @param {unknown} resultValue
 * @param {unknown} [measurementValue]
 */
export async function writeM7AssistancePrivacyResult(
	outputDirectory,
	resultValue,
	measurementValue = null,
) {
	return writeQualityCollectorResult(outputDirectory, resultValue, {
		resultLabel: 'M7 diagnostic result',
		resultFilename: (result) => (
			`${WORKLOAD_ID}.${result.observedPackage.target}.${result.status}.json`
		),
		prepareRawArtifact: (result) => {
			if (measurementValue === null) {
				throw new Error('M7 result requires its complete raw measurement.');
			}
			const measurement = snapshotStrictJsonData(measurementValue, 'measurement');
			if (canonicalMeasurementSha256(measurement) !== result.canonicalMeasurementSha256
				|| measurement.budgetSha256 !== result.budgetSha256
				|| measurement.sourceRevision !== result.sourceRevision
				|| measurement.package?.sha256 !== result.observedPackage?.sha256) {
				throw new Error('M7 result is detached from its raw measurement.');
			}
			const target = result.observedPackage?.target;
			if (!PACKAGE_TARGETS.includes(target)) {
				throw new Error('M7 result has an unsupported package target.');
			}
			return {
				filename: `${WORKLOAD_ID}.${target}.${result.status}.raw.json`,
				value: measurement,
			};
		},
	});
}

/** Parse `[--measurement <path>] [output-directory]`. */
export function parseM7AssistancePrivacyCliOptions(argsValue) {
	return parseQualityCollectorCliOptions(argsValue, 'M7');
}

function assertWorkloadRegistration(workload) {
	const thresholdIds = Array.isArray(workload.thresholds)
		? workload.thresholds.map((threshold) => threshold?.metricId)
		: [];
	if (!sameOrderedStrings(workload.fixtureIds, [FIXTURE_ID])
		|| !sameOrderedStrings(thresholdIds, METRIC_IDS)) {
		throw new Error(`Workload ${WORKLOAD_ID} does not own the frozen fixture and five measurements.`);
	}
}

function assertMeasurementPolicy(policy) {
	if (policy.percentileMethod !== 'nearest-rank'
		|| policy.benchmarkRetries !== 0
		|| policy.timingWorkers !== 1
		|| policy.timingWarmupTrials !== 1
		|| policy.timingTrials !== 5) {
		throw new Error('M7 assistance measurement requires one warm-up, five timed runs, one worker, and no retries.');
	}
}

if (isDirectExecution(import.meta.url)) {
	await runQualityCollectorMain({
		parseOptions: parseM7AssistancePrivacyCliOptions,
		collect: collectM7AssistancePrivacyQuality,
		defaultOutputDirectory: new URL('../test-results/quality/m7-assistance-privacy', import.meta.url),
		usage: 'Usage: node scripts/collect-m7-local-assistance-privacy-quality.mjs --measurement <record.json> [output-directory]\n',
	});
}

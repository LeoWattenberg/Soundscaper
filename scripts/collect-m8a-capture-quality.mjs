#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';

import {
	M8A_CAPTURE_ENVIRONMENT_ID as ENVIRONMENT_ID,
	M8A_CAPTURE_FIXTURE_ID as FIXTURE_ID,
	M8A_CAPTURE_METRIC_IDS as METRIC_IDS,
	M8A_CAPTURE_OBSERVATION_CLASS as OBSERVATION_CLASS,
	M8A_CAPTURE_PROFILE as PROFILE,
	M8A_CAPTURE_WORKLOAD_ID as WORKLOAD_ID,
	computeM8ACaptureMetrics,
} from './lib/m8a-capture-quality-metrics.mjs';
import {
	DIAGNOSTIC_MEASUREMENT_POLICY,
	evaluateQualityWorkload,
	qualityFixture,
	qualityWorkloadBudget,
} from './lib/quality-budget-config.mjs';
import { snapshotStrictJsonData } from './lib/strict-json-snapshot.mjs';
import {
	assertNonHostedQualityCollector,
	isDirectExecution,
	normalizeQualityCollectorOptions,
	parseQualityCollectorCliOptions,
	readQualityCollectorMeasurement,
	runQualityCollectorMain,
	sameOrderedStrings,
	writeQualityCollectorResult,
} from './lib/quality-collector-runtime.mjs';

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);

/** Read one real-device record and persist its diagnostic result. */
export async function collectM8ACaptureQuality(optionsValue, dependencies = {}) {
	const { measurementPath, outputDirectory } = normalizeQualityCollectorOptions(optionsValue);
	assertM8ACaptureCollectionHost(dependencies.processEnvironment ?? process.env);
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const readMeasurement = dependencies.readMeasurement
		?? ((path) => readQualityCollectorMeasurement(path, 'M8A capture diagnostic'));
	const measurement = await readMeasurement(measurementPath);
	const result = createM8ACaptureResult(measurement, config);
	const writeResult = dependencies.writeResult ?? writeM8ACaptureResult;
	return writeResult(outputDirectory, result);
}

/** Recompute the registered metrics without making a release decision. */
export function createM8ACaptureResult(measurement, configValue) {
	const config = snapshotStrictJsonData(configValue, 'config');
	const workload = qualityWorkloadBudget(config, WORKLOAD_ID);
	const fixture = qualityFixture(config, FIXTURE_ID);
	const policy = DIAGNOSTIC_MEASUREMENT_POLICY;
	assertWorkloadRegistration(workload);
	assertMeasurementPolicy(policy);
	const computed = computeM8ACaptureMetrics(measurement, {
		fixtureSpecification: fixture.specification,
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
		profile: PROFILE,
		observationClass: OBSERVATION_CLASS,
		attemptCount: 1,
		retryCount: policy.benchmarkRetries,
		rendererClass: 'unknown',
		observedFingerprint: computed.fingerprint,
		fixture: Object.freeze(snapshotStrictJsonData(fixture.specification, 'fixture.specification')),
		metrics: computed.metrics,
		rawSampleCounts: computed.rawSampleCounts,
		metricGatePassed,
		evaluation,
	});
}

/** Hosted automation has no camera, microphone, display, or OS-audio device. */
export function assertM8ACaptureCollectionHost(processEnvironment) {
	assertNonHostedQualityCollector(
		processEnvironment,
		(key) => `M8A capture collection refuses to run on a hosted runner (${key} is set); hosted runners have no real capture devices.`,
	);
}

/** Persist a passed or failed diagnostic result. */
export async function writeM8ACaptureResult(outputDirectory, resultValue) {
	return writeQualityCollectorResult(outputDirectory, resultValue, {
		resultLabel: 'M8A diagnostic result',
		resultFilename: (result) => `${WORKLOAD_ID}.${result.status}.json`,
	});
}

/** Parse `[--measurement <path>] [output-directory]`. */
export function parseM8ACaptureCliOptions(argsValue) {
	return parseQualityCollectorCliOptions(argsValue, 'M8A');
}

function assertWorkloadRegistration(workload) {
	const thresholdIds = Array.isArray(workload.thresholds)
		? workload.thresholds.map((threshold) => threshold?.metricId)
		: [];
	if (!sameOrderedStrings(workload.fixtureIds, [FIXTURE_ID])
		|| !sameOrderedStrings(thresholdIds, METRIC_IDS)) {
		throw new Error(`Workload ${WORKLOAD_ID} does not own the frozen fixture and eight measurements.`);
	}
}

function assertMeasurementPolicy(policy) {
	if (policy.percentileMethod !== 'nearest-rank' || policy.benchmarkRetries !== 0) {
		throw new Error('M8A capture measurement requires nearest-rank percentiles and no retries.');
	}
}

if (isDirectExecution(import.meta.url)) {
	await runQualityCollectorMain({
		parseOptions: parseM8ACaptureCliOptions,
		collect: collectM8ACaptureQuality,
		defaultOutputDirectory: new URL('../test-results/quality/m8a-capture', import.meta.url),
		usage: 'Usage: node scripts/collect-m8a-capture-quality.mjs --measurement <record.json> [output-directory]\n',
	});
}

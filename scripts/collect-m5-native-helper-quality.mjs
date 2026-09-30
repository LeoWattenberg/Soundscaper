/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';

import {
	M5_NATIVE_HELPER_ENVIRONMENT_ID as ENVIRONMENT_ID,
	M5_NATIVE_HELPER_FIXTURE_ID as FIXTURE_ID,
	M5_NATIVE_HELPER_METRIC_IDS as METRIC_IDS,
	M5_NATIVE_HELPER_OBSERVATION_CLASS as OBSERVATION_CLASS,
	M5_NATIVE_HELPER_PROFILE as PROFILE,
	M5_NATIVE_HELPER_WORKLOAD_ID as WORKLOAD_ID,
	computeM5NativeHelperMetrics,
} from './lib/m5-native-helper-metrics.mjs';
import { requireRecord } from './lib/measurement-validation.mjs';
import {
	DIAGNOSTIC_MEASUREMENT_POLICY,
	evaluateQualityWorkload,
	qualityFixture,
	qualityWorkloadBudget,
} from './lib/quality-budget-config.mjs';
import { snapshotStrictJsonData } from './lib/strict-json-snapshot.mjs';
import { qualityBudgetSha256 } from './lib/quality-budget-config-digest.mjs';
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

/*
 * Milestone 5A-4 collector. Ordinary CI owns the correctness half of
 * `m5-helper-fault-and-loopback-v1`; a local device run supplies the latency,
 * underrun, recovery, and RSS observations. The collector recomputes all eight
 * metrics and reports their thresholds as diagnostics. It never modifies the
 * checked-in environment descriptor or makes a release decision.
 */

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const NATIVE_DIAGNOSTIC_ENVIRONMENT = Object.freeze({
	id: ENVIRONMENT_ID,
	status: 'active',
	kind: 'observed-native-runtime-diagnostics',
	rendererRequirement: 'any',
	evidence: Object.freeze(['scripts/collect-m5-native-helper-quality.mjs']),
});

/** Read a device-produced measurement and persist its diagnostic result. */
export async function collectM5NativeHelperQuality(optionsValue, dependencies = {}) {
	const { measurementPath, outputDirectory } = normalizeQualityCollectorOptions(optionsValue);
	assertM5NativeHelperCollectionHost(dependencies.processEnvironment ?? process.env);
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const readMeasurement = dependencies.readMeasurement
		?? ((path) => readQualityCollectorMeasurement(path, 'M5 native-diagnostic measurement'));
	const measurement = await readMeasurement(measurementPath);
	const result = createM5NativeHelperResult(measurement, config);
	const writeResult = dependencies.writeResult
		?? ((directory, value) => writeM5NativeHelperResult(directory, value, measurement));
	return writeResult(outputDirectory, result);
}

/**
 * Recompute the eight metrics and evaluate them against the checked-in
 * thresholds. Threshold values live only in `config/quality-budgets.json`; this
 * module reads them and never restates one.
 */
export function createM5NativeHelperResult(
	measurement,
	configValue,
	budgetSha256 = qualityBudgetSha256(configValue),
) {
	const config = snapshotStrictJsonData(configValue, 'config');
	const workload = qualityWorkloadBudget(config, WORKLOAD_ID);
	const fixture = qualityFixture(config, FIXTURE_ID);
	const policy = DIAGNOSTIC_MEASUREMENT_POLICY;
	assertWorkloadRegistration(workload);
	const measurementSnapshot = requireRecord(
		snapshotStrictJsonData(measurement, 'M5 measurement'),
		'M5 measurement',
	);
	const isV2 = measurementSnapshot.schemaVersion === 2;
	const computed = computeM5NativeHelperMetrics(measurement, {
		...(isV2 ? { budgetSha256 } : {}),
		fixtureSpecification: fixture.specification,
		measurementPolicy: policy,
		...(isV2 ? { diagnosticEnvironment: NATIVE_DIAGNOSTIC_ENVIRONMENT } : {}),
	});
	const evaluation = evaluateQualityWorkload(config, workload, computed.metrics);
	const metricGatePassed = evaluation.passed;
	const passed = metricGatePassed;
	return Object.freeze({
		schemaVersion: isV2 ? 2 : 1,
		status: passed ? 'passed' : 'failed',
		workloadId: WORKLOAD_ID,
		fixtureId: FIXTURE_ID,
		environmentId: ENVIRONMENT_ID,
		platformId: computed.platformId,
		profile: PROFILE,
		observationClass: OBSERVATION_CLASS,
		attemptCount: 1,
		retryCount: policy.benchmarkRetries,
		rendererClass: 'unknown',
		// Keep the observed host and runtime beside the result. They do not
		// populate or certify any repository-wide hardware matrix.
		...(isV2
			? {
				budgetSha256: computed.budgetSha256,
				observedDiagnosticBinding: computed.diagnosticBinding,
				observedRuntimeProfile: computed.observedRuntimeProfile,
				sourceRevision: computed.sourceRevision,
			}
			: { observedFingerprint: computed.fingerprint }),
		fixture: Object.freeze(snapshotStrictJsonData(fixture.specification, 'fixture.specification')),
		metrics: computed.metrics,
		rawSampleCounts: computed.rawSampleCounts,
		metricGatePassed,
		evaluation,
	});
}

/**
 * A hosted runner can prove the fault half in ordinary CI, but it has no audio
 * device, so it may never be the thing that files a loopback measurement.
 */
export function assertM5NativeHelperCollectionHost(processEnvironment) {
	assertNonHostedQualityCollector(
		processEnvironment,
		(key) => `M5 native-diagnostic collection refuses to run on a hosted runner (${key} is set); hosted runners are not audio-device evidence.`,
	);
}

/** Persist one immutable diagnostic result and its raw V2 measurement. */
export async function writeM5NativeHelperResult(outputDirectory, resultValue, measurementValue = null) {
	return writeQualityCollectorResult(outputDirectory, resultValue, {
		resultLabel: 'M5 diagnostic result',
		resultFilename: (result) => result.schemaVersion === 2
			? `${WORKLOAD_ID}.${result.observedDiagnosticBinding.platformId}.${result.status}.json`
			: `${WORKLOAD_ID}.${result.status}.json`,
		prepareRawArtifact: (result) => {
			if (result.schemaVersion !== 2) return null;
			if (measurementValue === null) {
				throw new Error('M5 schema V2 result requires its raw measurement.');
			}
			const measurement = snapshotStrictJsonData(measurementValue, 'measurement');
			if (measurement.schemaVersion !== 2
				|| measurement.diagnosticBinding?.platformId
					!== result.observedDiagnosticBinding?.platformId
				|| measurement.diagnosticBinding?.artifacts?.sourceRevision
					!== result.observedDiagnosticBinding?.artifacts?.sourceRevision) {
				throw new Error('M5 schema V2 result is detached from its raw measurement.');
			}
			return {
				filename: `${WORKLOAD_ID}.${result.observedDiagnosticBinding.platformId}.raw.json`,
				value: measurement,
			};
		},
	});
}

/** Parse `[--measurement <path>] [output-directory]`. */
export function parseM5NativeHelperCliOptions(argsValue) {
	return parseQualityCollectorCliOptions(argsValue, 'M5');
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

if (isDirectExecution(import.meta.url)) {
	await runQualityCollectorMain({
		parseOptions: parseM5NativeHelperCliOptions,
		collect: collectM5NativeHelperQuality,
		defaultOutputDirectory: new URL('../test-results/quality/m5-native-helper', import.meta.url),
		usage: 'Usage: node scripts/collect-m5-native-helper-quality.mjs --measurement <record.json> [output-directory]\n',
	});
}

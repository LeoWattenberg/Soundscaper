/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	M5_NATIVE_HELPER_ENVIRONMENT_ID as ENVIRONMENT_ID,
	M5_NATIVE_HELPER_FIXTURE_ID as FIXTURE_ID,
	M5_NATIVE_HELPER_METRIC_IDS as METRIC_IDS,
	M5_NATIVE_HELPER_OBSERVATION_CLASS as OBSERVATION_CLASS,
	M5_NATIVE_HELPER_PROFILE as PROFILE,
	M5_NATIVE_HELPER_WORKLOAD_ID as WORKLOAD_ID,
	computeM5NativeHelperMetrics,
} from './lib/m5-native-helper-metrics.mjs';
import { boundedString, exactRecord, requireRecord } from './lib/measurement-admission.mjs';
import {
	DIAGNOSTIC_MEASUREMENT_POLICY,
	evaluateQualityWorkload,
	qualityFixture,
	qualityWorkloadBudget,
} from './lib/quality-budget-config.mjs';
import { snapshotStrictJsonData } from './lib/strict-json-snapshot.mjs';
import { qualityBudgetSha256 } from './lib/quality-budget-config-digest.mjs';

/*
 * Milestone 5A-4 collector. Ordinary CI owns the correctness half of
 * `m5-helper-fault-and-loopback-v1`; a local device run supplies the latency,
 * underrun, recovery, and RSS observations. The collector recomputes all eight
 * metrics and reports their thresholds as diagnostics. It never modifies the
 * checked-in environment descriptor or makes a release decision.
 */

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const HOSTED_RUNNER_VARIABLES = Object.freeze([
	'GITHUB_ACTIONS', 'CI', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI',
]);
const NATIVE_DIAGNOSTIC_ENVIRONMENT = Object.freeze({
	id: ENVIRONMENT_ID,
	status: 'active',
	kind: 'observed-native-runtime-diagnostics',
	rendererRequirement: 'any',
	evidence: Object.freeze(['scripts/collect-m5-native-helper-quality.mjs']),
});

/** Read a device-produced measurement and persist its diagnostic result. */
export async function collectM5NativeHelperQuality(optionsValue, dependencies = {}) {
	const options = exactRecord(
		snapshotStrictJsonData(optionsValue, 'collector options'),
		['measurementPath', 'outputDirectory'],
		'collector options',
	);
	const measurementPath = boundedString(options.measurementPath, 1, 4_096, 'measurementPath');
	const outputDirectory = boundedString(options.outputDirectory, 1, 4_096, 'outputDirectory');
	assertM5NativeHelperCollectionHost(dependencies.processEnvironment ?? process.env);
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const readMeasurement = dependencies.readMeasurement ?? readMeasurementFile;
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
	for (const key of HOSTED_RUNNER_VARIABLES) {
		const value = ownEnvironmentString(processEnvironment, key);
		if (value === undefined || value === '') continue;
		throw new Error(`M5 native-diagnostic collection refuses to run on a hosted runner (${key} is set); hosted runners are not audio-device evidence.`);
	}
}

/** Persist one immutable diagnostic result and its raw V2 measurement. */
export async function writeM5NativeHelperResult(outputDirectory, resultValue, measurementValue = null) {
	const result = snapshotStrictJsonData(resultValue, 'result');
	if (result.status !== 'passed' && result.status !== 'failed') {
		throw new Error(`M5 diagnostic result has unsupported status ${String(result.status)}.`);
	}
	await mkdir(outputDirectory, { recursive: true });
	if (result.schemaVersion !== 2) {
		const resultPath = join(outputDirectory, `${WORKLOAD_ID}.${result.status}.json`);
		await writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`, { flag: 'wx' });
		return Object.freeze({ resultPath, result });
	}
	if (measurementValue === null) throw new Error('M5 schema V2 result requires its raw measurement.');
	const measurement = snapshotStrictJsonData(measurementValue, 'measurement');
	if (measurement.schemaVersion !== 2
		|| measurement.diagnosticBinding?.platformId
			!== result.observedDiagnosticBinding?.platformId
		|| measurement.diagnosticBinding?.artifacts?.sourceRevision
			!== result.observedDiagnosticBinding?.artifacts?.sourceRevision) {
		throw new Error('M5 schema V2 result is detached from its raw measurement.');
	}
	const stem = `${WORKLOAD_ID}.${result.observedDiagnosticBinding.platformId}`;
	const rawPath = join(outputDirectory, `${stem}.raw.json`);
	const resultPath = join(outputDirectory, `${stem}.${result.status}.json`);
	await writeFile(rawPath, `${JSON.stringify(measurement, null, '\t')}\n`, { flag: 'wx' });
	await writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`, { flag: 'wx' });
	return Object.freeze({ rawPath, resultPath, result });
}

/** Parse `[--measurement <path>] [output-directory]`. */
export function parseM5NativeHelperCliOptions(argsValue) {
	const args = snapshotStrictJsonData(argsValue, 'M5 collector CLI arguments');
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('M5 collector CLI arguments must be strings.');
	}
	let measurementPath = null;
	let outputDirectory = null;
	let expectingMeasurement = false;
	for (const argument of args) {
		if (expectingMeasurement) {
			measurementPath = argument;
			expectingMeasurement = false;
			continue;
		}
		if (argument === '--measurement') {
			if (measurementPath !== null) throw new Error('M5 collector accepts one measurement path.');
			expectingMeasurement = true;
			continue;
		}
		if (argument.startsWith('-')) throw new Error(`Unknown M5 collector option ${argument}.`);
		if (outputDirectory !== null) throw new Error('M5 collector accepts one output directory.');
		outputDirectory = argument;
	}
	if (expectingMeasurement) throw new Error('M5 collector option --measurement requires a path.');
	return Object.freeze({ measurementPath, outputDirectory });
}

async function readMeasurementFile(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(
			`M5 native-diagnostic measurement is unavailable or invalid: ${errorMessage(error)}.`,
			{ cause: error },
		);
	}
}

function assertWorkloadRegistration(workload) {
	const thresholdIds = Array.isArray(workload.thresholds)
		? workload.thresholds.map((threshold) => threshold?.metricId)
		: [];
	if (!sameStrings(workload.fixtureIds, [FIXTURE_ID])
		|| !sameStrings(thresholdIds, METRIC_IDS)) {
		throw new Error(`Workload ${WORKLOAD_ID} does not own the frozen fixture and eight measurements.`);
	}
}

function ownEnvironmentString(environment, key) {
	if (environment === null || (typeof environment !== 'object' && typeof environment !== 'function')) {
		throw new Error('Collector environment must expose own data properties.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(environment, key);
	if (!descriptor) return undefined;
	if (!Object.hasOwn(descriptor, 'value')
		|| (descriptor.value !== undefined && typeof descriptor.value !== 'string')) {
		throw new Error(`Collector environment ${key} must be an own string data property.`);
	}
	return descriptor.value;
}

function sameStrings(left, right) {
	return Array.isArray(left)
		&& Array.isArray(right)
		&& left.length === right.length
		&& left.every((value, index) => value === right[index]);
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

async function main() {
	const cli = parseM5NativeHelperCliOptions(process.argv.slice(2));
	if (cli.measurementPath === null) {
		process.stderr.write('Usage: node scripts/collect-m5-native-helper-quality.mjs --measurement <record.json> [output-directory]\n');
		process.exitCode = 2;
		return;
	}
	const collected = await collectM5NativeHelperQuality({
		measurementPath: resolve(cli.measurementPath),
		outputDirectory: resolve(cli.outputDirectory
			?? fileURLToPath(new URL('../test-results/quality/m5-native-helper', import.meta.url))),
	});
	process.stdout.write(`${JSON.stringify(collected.result, null, '\t')}\n`);
	if (collected.result.status === 'failed') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();

#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	M8A_CAPTURE_ENVIRONMENT_ID as ENVIRONMENT_ID,
	M8A_CAPTURE_FIXTURE_ID as FIXTURE_ID,
	M8A_CAPTURE_METRIC_IDS as METRIC_IDS,
	M8A_CAPTURE_OBSERVATION_CLASS as OBSERVATION_CLASS,
	M8A_CAPTURE_PROFILE as PROFILE,
	M8A_CAPTURE_WORKLOAD_ID as WORKLOAD_ID,
	computeM8ACaptureMetrics,
} from './lib/m8a-capture-quality-metrics.mjs';
import { boundedString, exactRecord } from './lib/measurement-admission.mjs';
import {
	DIAGNOSTIC_MEASUREMENT_POLICY,
	evaluateQualityWorkload,
	qualityFixture,
	qualityWorkloadBudget,
} from './lib/quality-budget-config.mjs';
import { snapshotStrictJsonData } from './lib/strict-json-snapshot.mjs';

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const HOSTED_RUNNER_VARIABLES = Object.freeze([
	'GITHUB_ACTIONS', 'CI', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI',
]);

/** Read one real-device record and persist its diagnostic result. */
export async function collectM8ACaptureQuality(optionsValue, dependencies = {}) {
	const options = exactRecord(
		snapshotStrictJsonData(optionsValue, 'collector options'),
		['measurementPath', 'outputDirectory'],
		'collector options',
	);
	const measurementPath = boundedString(options.measurementPath, 1, 4_096, 'measurementPath');
	const outputDirectory = boundedString(options.outputDirectory, 1, 4_096, 'outputDirectory');
	assertM8ACaptureCollectionHost(dependencies.processEnvironment ?? process.env);
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const readMeasurement = dependencies.readMeasurement ?? readMeasurementFile;
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
	for (const key of HOSTED_RUNNER_VARIABLES) {
		const value = ownEnvironmentString(processEnvironment, key);
		if (value === undefined || value === '') continue;
		throw new Error(`M8A capture collection refuses to run on a hosted runner (${key} is set); hosted runners have no real capture devices.`);
	}
}

/** Persist a passed or failed diagnostic result. */
export async function writeM8ACaptureResult(outputDirectory, resultValue) {
	const result = snapshotStrictJsonData(resultValue, 'result');
	if (result.status !== 'passed' && result.status !== 'failed') {
		throw new Error(`M8A diagnostic result has unsupported status ${String(result.status)}.`);
	}
	await mkdir(outputDirectory, { recursive: true });
	const resultPath = join(outputDirectory, `${WORKLOAD_ID}.${result.status}.json`);
	await writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`, { flag: 'wx' });
	return Object.freeze({ resultPath, result });
}

/** Parse `[--measurement <path>] [output-directory]`. */
export function parseM8ACaptureCliOptions(argsValue) {
	const args = snapshotStrictJsonData(argsValue, 'M8A collector CLI arguments');
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('M8A collector CLI arguments must be strings.');
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
			if (measurementPath !== null) throw new Error('M8A collector accepts one measurement path.');
			expectingMeasurement = true;
			continue;
		}
		if (argument.startsWith('-')) throw new Error(`Unknown M8A collector option ${argument}.`);
		if (outputDirectory !== null) throw new Error('M8A collector accepts one output directory.');
		outputDirectory = argument;
	}
	if (expectingMeasurement) throw new Error('M8A collector option --measurement requires a path.');
	return Object.freeze({ measurementPath, outputDirectory });
}

async function readMeasurementFile(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(
			`M8A capture diagnostic is unavailable or invalid: ${errorMessage(error)}.`,
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

function assertMeasurementPolicy(policy) {
	if (policy.percentileMethod !== 'nearest-rank' || policy.benchmarkRetries !== 0) {
		throw new Error('M8A capture measurement requires nearest-rank percentiles and no retries.');
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
	const cli = parseM8ACaptureCliOptions(process.argv.slice(2));
	if (cli.measurementPath === null) {
		process.stderr.write('Usage: node scripts/collect-m8a-capture-quality.mjs --measurement <record.json> [output-directory]\n');
		process.exitCode = 2;
		return;
	}
	const collected = await collectM8ACaptureQuality({
		measurementPath: resolve(cli.measurementPath),
		outputDirectory: resolve(cli.outputDirectory
			?? fileURLToPath(new URL('../test-results/quality/m8a-capture', import.meta.url))),
	});
	process.stdout.write(`${JSON.stringify(collected.result, null, '\t')}\n`);
	if (collected.result.status === 'failed') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();

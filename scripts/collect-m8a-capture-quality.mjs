#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateQualityBudget } from './quality-budget-evaluator.mjs';
import {
	M8A_CAPTURE_ENVIRONMENT_ID as ENVIRONMENT_ID,
	M8A_CAPTURE_FINGERPRINT_FIELDS as FINGERPRINT_FIELDS,
	M8A_CAPTURE_FIXTURE_ID as FIXTURE_ID,
	M8A_CAPTURE_METRIC_IDS as METRIC_IDS,
	M8A_CAPTURE_OBSERVATION_CLASS as OBSERVATION_CLASS,
	M8A_CAPTURE_PROFILE as PROFILE,
	M8A_CAPTURE_WORKLOAD_ID as WORKLOAD_ID,
	computeM8ACaptureMetrics,
} from './lib/m8a-capture-quality-metrics.mjs';
import { boundedString, exactRecord, isRecord, requireRecord } from './lib/measurement-admission.mjs';
import { snapshotStrictJsonData } from './lib/strict-json-snapshot.mjs';

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const HOSTED_RUNNER_VARIABLES = Object.freeze([
	'GITHUB_ACTIONS', 'CI', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI',
]);

/** Read one real-device lab record and persist only provisional evidence. */
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

/** Recompute the registered metrics while refusing to imply lab qualification. */
export function createM8ACaptureResult(measurement, configValue) {
	const config = snapshotStrictJsonData(configValue, 'config');
	const workload = exactDescriptor(config.workloads, WORKLOAD_ID, 'workload');
	const fixture = exactDescriptor(config.fixtures, FIXTURE_ID, 'fixture');
	const environment = exactDescriptor(config.environments, ENVIRONMENT_ID, 'environment');
	const policy = requireRecord(config.measurementPolicy, 'measurementPolicy');
	assertWorkloadRegistration(workload);
	assertMeasurementPolicy(policy);
	const qualification = assessM8ACaptureQualification(config);
	if (qualification.provisioned) {
		throw new Error(`Environment ${ENVIRONMENT_ID} is provisioned; the M8A accepted-evidence writer must land with the real-device lab before a result is emitted.`);
	}
	const computed = computeM8ACaptureMetrics(measurement, {
		fixtureSpecification: fixture.specification,
	});
	const evaluation = evaluateQualityBudget({
		environmentId: ENVIRONMENT_ID,
		rendererRequirement: environment.rendererRequirement,
		thresholds: workload.thresholds,
	}, environment, {
		environmentId: ENVIRONMENT_ID,
		rendererClass: 'unknown',
		metrics: computed.metrics,
	});
	const metricGatePassed = evaluation.verdicts.length === workload.thresholds.length
		&& evaluation.verdicts.every(({ passed }) => passed);
	const failures = [...new Set([...evaluation.failures, ...qualification.blockers])];
	return Object.freeze({
		schemaVersion: 1,
		status: metricGatePassed ? 'pending-external' : 'failed',
		workloadId: WORKLOAD_ID,
		fixtureId: FIXTURE_ID,
		environmentId: ENVIRONMENT_ID,
		qualificationEnvironmentId: ENVIRONMENT_ID,
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
		qualificationEvidencePublished: false,
		qualificationBlockers: Object.freeze(qualification.blockers),
		evaluation: Object.freeze({
			passed: false,
			failures: Object.freeze(failures),
			verdicts: evaluation.verdicts,
		}),
	});
}

/** Name every missing eligibility and fingerprint fact in the registered lab. */
export function assessM8ACaptureQualification(configValue) {
	const config = snapshotStrictJsonData(configValue, 'config');
	const workload = exactDescriptor(config.workloads, WORKLOAD_ID, 'workload');
	const environment = exactDescriptor(config.environments, ENVIRONMENT_ID, 'environment');
	const blockers = [];
	if (environment.status !== 'active') {
		blockers.push(`Environment ${ENVIRONMENT_ID} is ${String(environment.status)}.`);
	}
	if (environment.qualificationEligible !== true) {
		blockers.push(`Environment ${ENVIRONMENT_ID} is not qualification-eligible.`);
	}
	if (!Array.isArray(environment.eligibleWorkloadIds)
		|| !environment.eligibleWorkloadIds.includes(WORKLOAD_ID)) {
		blockers.push(`Environment ${ENVIRONMENT_ID} does not list ${WORKLOAD_ID} among its eligible workloads.`);
	}
	const fingerprint = requireRecord(environment.fingerprint, `${ENVIRONMENT_ID}.fingerprint`);
	if (!sameStrings(Object.keys(fingerprint).sort(), [...FINGERPRINT_FIELDS].sort())) {
		blockers.push(`Environment ${ENVIRONMENT_ID} fingerprint does not enumerate the exact capture device fields.`);
	}
	for (const field of FINGERPRINT_FIELDS) {
		if (!isRecord(fingerprint[field]) || Object.keys(fingerprint[field]).length === 0) {
			blockers.push(`Environment ${ENVIRONMENT_ID} has no recorded fingerprint ${field}.`);
		}
	}
	if (workload.status !== 'qualified') {
		blockers.push(`Workload ${WORKLOAD_ID} status is ${String(workload.status)}; accepted evidence requires status qualified.`);
	}
	const qualifiedIds = config.qualification?.qualifiedWorkloadIds;
	if (!Array.isArray(qualifiedIds) || !qualifiedIds.includes(WORKLOAD_ID)) {
		blockers.push(`Workload ${WORKLOAD_ID} is not registered in qualification.qualifiedWorkloadIds.`);
	}
	return Object.freeze({
		provisioned: blockers.length === 0,
		blockers: Object.freeze(blockers),
	});
}

/** Hosted automation is not a camera, microphone, display, or OS-audio lab. */
export function assertM8ACaptureCollectionHost(processEnvironment) {
	for (const key of HOSTED_RUNNER_VARIABLES) {
		const value = ownEnvironmentString(processEnvironment, key);
		if (value === undefined || value === '') continue;
		throw new Error(`M8A capture collection refuses to run on a hosted runner (${key} is set); hosted runners are not real-device capture evidence.`);
	}
}

/** Persist failed or pending evidence; accepted publication is deliberately absent. */
export async function writeM8ACaptureResult(outputDirectory, resultValue) {
	const result = snapshotStrictJsonData(resultValue, 'result');
	if (result.status !== 'pending-external' && result.status !== 'failed') {
		throw new Error(`M8A collector cannot write a ${String(result.status)} result while ${ENVIRONMENT_ID} is unprovisioned.`);
	}
	if (result.qualificationEvidencePublished !== false) {
		throw new Error('M8A collector must not mark qualification evidence as published.');
	}
	await mkdir(outputDirectory, { recursive: true });
	const resultPath = join(outputDirectory, `${WORKLOAD_ID}.${result.status}.json`);
	await writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`, { flag: 'wx' });
	return Object.freeze({ resultPath, result });
}

/** Parse `[--measurement <path>] [output-directory]`; qualification is unavailable. */
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
		if (argument === '--accept' || argument === '--qualify' || argument === '--publish') {
			throw new Error(`M8A capture qualification is unavailable while ${ENVIRONMENT_ID} is unprovisioned.`);
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
			`M8A capture-lab measurement is unavailable or invalid: ${errorMessage(error)}.`,
			{ cause: error },
		);
	}
}

function assertWorkloadRegistration(workload) {
	const thresholdIds = Array.isArray(workload.thresholds)
		? workload.thresholds.map((threshold) => threshold?.metricId)
		: [];
	if (!sameStrings(workload.fixtureIds, [FIXTURE_ID])
		|| !sameStrings(workload.environmentIds, [ENVIRONMENT_ID])
		|| !sameStrings(thresholdIds, METRIC_IDS)) {
		throw new Error(`Workload ${WORKLOAD_ID} does not own the frozen fixture, environment, and eight metrics.`);
	}
}

function assertMeasurementPolicy(policy) {
	if (policy.percentileMethod !== 'nearest-rank' || policy.benchmarkRetries !== 0) {
		throw new Error('M8A capture measurement requires nearest-rank percentiles and no retries.');
	}
}

function exactDescriptor(collection, id, label) {
	const matches = Array.isArray(collection)
		? collection.filter((value) => isRecord(value) && value.id === id)
		: [];
	if (matches.length !== 1) throw new Error(`Quality config must contain exactly one ${label} ${id}.`);
	return matches[0];
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
	if (collected.result.status !== 'pending-external') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();

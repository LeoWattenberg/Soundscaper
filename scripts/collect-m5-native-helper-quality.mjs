/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateQualityBudget } from './quality-budget-evaluator.mjs';
import {
	M5_NATIVE_HELPER_ENVIRONMENT_ID as ENVIRONMENT_ID,
	M5_NATIVE_HELPER_FIXTURE_ID as FIXTURE_ID,
	M5_NATIVE_HELPER_METRIC_IDS as METRIC_IDS,
	M5_NATIVE_HELPER_OBSERVATION_CLASS as OBSERVATION_CLASS,
	M5_NATIVE_HELPER_PLATFORM_IDS as PLATFORM_IDS,
	M5_NATIVE_HELPER_PROFILE as PROFILE,
	M5_NATIVE_HELPER_WORKLOAD_ID as WORKLOAD_ID,
	computeM5NativeHelperMetrics,
} from './lib/m5-native-helper-metrics.mjs';
import { boundedString, exactRecord, isRecord, requireRecord } from './lib/measurement-admission.mjs';
import { snapshotStrictJsonData } from './lib/strict-json-snapshot.mjs';

/*
 * Milestone 5A-4 collector. Ordinary CI owns the correctness half of
 * `m5-helper-fault-and-loopback-v1`; only the provisioned `native-os-lab-matrix`
 * may publish the latency, underrun, recovery, and RSS half. That matrix is
 * unprovisioned and all five of its platform fingerprints are null, so this
 * collector deliberately has no accepted-evidence writer: it recomputes the
 * eight metrics, records them, and emits a pending-external result that names
 * every missing provisioning fact by hand. The day that list empties, it stops
 * instead — a pending record naming nothing missing would read as sign-off.
 *
 * Two things it must never do: copy an intended fingerprint into a null
 * descriptor row, and let a hosted runner stand in for an audio device.
 */

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const HOSTED_RUNNER_VARIABLES = Object.freeze([
	'GITHUB_ACTIONS', 'CI', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI',
]);

/** Read a lab-produced measurement and persist only unaccepted evidence. */
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
	const writeResult = dependencies.writeResult ?? writeM5NativeHelperResult;
	return writeResult(outputDirectory, result);
}

/**
 * Recompute the eight metrics and evaluate them against the checked-in
 * thresholds. Threshold values live only in `config/quality-budgets.json`; this
 * module reads them and never restates one.
 */
export function createM5NativeHelperResult(measurement, configValue) {
	const config = snapshotStrictJsonData(configValue, 'config');
	const workload = exactDescriptor(config.workloads, WORKLOAD_ID, 'workload');
	const fixture = exactDescriptor(config.fixtures, FIXTURE_ID, 'fixture');
	const environment = exactDescriptor(config.environments, ENVIRONMENT_ID, 'environment');
	const policy = requireRecord(config.measurementPolicy, 'measurementPolicy');
	assertWorkloadRegistration(workload);
	const qualification = assessM5NativeHelperQualification(config);
	if (qualification.provisioned) {
		// There is no accepted-evidence writer here yet. Emitting `pending-external`
		// with an empty blocker list would read as "measured, awaiting sign-off"
		// when the truth is that the publishing half is unwritten, so the
		// collector stops rather than describe a lab it can no longer describe.
		throw new Error(`Environment ${ENVIRONMENT_ID} is provisioned; the M5 accepted-evidence writer lands with the lab and must exist before a result is emitted.`);
	}
	const computed = computeM5NativeHelperMetrics(measurement, {
		fixtureSpecification: fixture.specification,
		measurementPolicy: policy,
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
		platformId: computed.platformId,
		profile: PROFILE,
		observationClass: OBSERVATION_CLASS,
		attemptCount: 1,
		retryCount: policy.benchmarkRetries,
		rendererClass: 'unknown',
		// The lab's own observation, kept beside the result. It is never merged
		// into the descriptor's null platform row by this collector.
		observedFingerprint: computed.fingerprint,
		fixture: Object.freeze(snapshotStrictJsonData(fixture.specification, 'fixture.specification')),
		metrics: computed.metrics,
		rawSampleCounts: computed.rawSampleCounts,
		metricGatePassed,
		qualificationEvidencePublished: false,
		qualificationBlockers: Object.freeze(qualification.blockers),
		evaluation: Object.freeze({
			// Never true here: the guard above refuses every provisioned state, so a
			// passing metric gate is reported by `metricGatePassed` alone.
			passed: false,
			failures: Object.freeze(failures),
			verdicts: evaluation.verdicts,
		}),
	});
}

/**
 * Name every fact the native lab still owes, one line per missing thing, so a
 * pending result says what would have to become true rather than how close it
 * came.
 */
export function assessM5NativeHelperQualification(configValue) {
	const config = snapshotStrictJsonData(configValue, 'config');
	const workload = exactDescriptor(config.workloads, WORKLOAD_ID, 'workload');
	const environment = exactDescriptor(config.environments, ENVIRONMENT_ID, 'environment');
	const blockers = [];
	if (environment.status !== 'active') {
		// Worded exactly as the shared evaluator words it, so the two lists
		// collapse into one statement of the same missing fact.
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
	const rows = Object.keys(fingerprint).sort();
	if (!sameStrings(rows, [...PLATFORM_IDS].sort())) {
		blockers.push(`Environment ${ENVIRONMENT_ID} fingerprint does not enumerate exactly the five lab platforms.`);
	}
	for (const platformId of PLATFORM_IDS) {
		if (!isRecord(fingerprint[platformId])) {
			blockers.push(`Environment ${ENVIRONMENT_ID} has no recorded fingerprint for platform ${platformId}.`);
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

/**
 * A hosted runner can prove the fault half in ordinary CI, but it has no audio
 * device, so it may never be the thing that files a loopback measurement.
 */
export function assertM5NativeHelperCollectionHost(processEnvironment) {
	for (const key of HOSTED_RUNNER_VARIABLES) {
		const value = ownEnvironmentString(processEnvironment, key);
		if (value === undefined || value === '') continue;
		throw new Error(`M5 native-lab collection refuses to run on a hosted runner (${key} is set); hosted runners are not audio-device evidence.`);
	}
}

/** Persist unaccepted evidence only; the accepted writer lands with the lab. */
export async function writeM5NativeHelperResult(outputDirectory, resultValue) {
	const result = snapshotStrictJsonData(resultValue, 'result');
	if (result.status !== 'pending-external' && result.status !== 'failed') {
		throw new Error(`M5 collector cannot write a ${String(result.status)} result while ${ENVIRONMENT_ID} is unprovisioned.`);
	}
	if (result.qualificationEvidencePublished !== false) {
		throw new Error('M5 collector must not mark qualification evidence as published.');
	}
	await mkdir(outputDirectory, { recursive: true });
	const resultPath = join(outputDirectory, `${WORKLOAD_ID}.${result.status}.json`);
	await writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`, { flag: 'wx' });
	return Object.freeze({ resultPath, result });
}

/** Parse `[--measurement <path>] [output-directory]`; qualification flags are refused. */
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
		if (argument === '--accept' || argument === '--qualify' || argument === '--publish') {
			throw new Error(`M5 native-lab qualification is unavailable while ${ENVIRONMENT_ID} is unprovisioned.`);
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
			`M5 native-lab measurement is unavailable or invalid: ${errorMessage(error)}.`,
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
	if (collected.result.status !== 'pending-external') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();

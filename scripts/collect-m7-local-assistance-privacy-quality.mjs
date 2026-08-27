#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateQualityBudget } from './quality-budget-evaluator.mjs';
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
import { boundedString, exactRecord, isRecord, requireRecord } from './lib/measurement-admission.mjs';
import { qualityBudgetSha256 } from './lib/quality-budget-config-digest.mjs';
import { snapshotStrictJsonData } from './lib/strict-json-snapshot.mjs';

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const PACKAGE_TARGETS = Object.freeze([
	'darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64',
]);
const OWNER_FINGERPRINT_FIELDS = Object.freeze([
	'architecture', 'browserVersion', 'displayMode', 'gpuDeviceId', 'gpuDriverVersion',
	'platform', 'powerMode', 'webglRenderer', 'webglVendor',
]);

/** Read one real-path trace summary and retain it only as unaccepted evidence. */
export async function collectM7AssistancePrivacyQuality(optionsValue, dependencies = {}) {
	const options = exactRecord(
		snapshotStrictJsonData(optionsValue, 'collector options'),
		['measurementPath', 'outputDirectory'],
		'collector options',
	);
	const measurementPath = boundedString(options.measurementPath, 1, 4_096, 'measurementPath');
	const outputDirectory = boundedString(options.outputDirectory, 1, 4_096, 'outputDirectory');
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const readMeasurement = dependencies.readMeasurement ?? readMeasurementFile;
	const measurement = await readMeasurement(measurementPath);
	const result = createM7AssistancePrivacyResult(measurement, config);
	const writeResult = dependencies.writeResult ?? writeM7AssistancePrivacyResult;
	return writeResult(outputDirectory, result, measurement);
}

/** Recompute every threshold while refusing to widen an unprovisioned owner profile. */
export function createM7AssistancePrivacyResult(measurement, configValue) {
	const config = snapshotStrictJsonData(configValue, 'config');
	const workload = exactDescriptor(config.workloads, WORKLOAD_ID, 'workload');
	const fixture = exactDescriptor(config.fixtures, FIXTURE_ID, 'fixture');
	const environment = exactDescriptor(config.environments, ENVIRONMENT_ID, 'environment');
	const policy = requireRecord(config.measurementPolicy, 'measurementPolicy');
	assertWorkloadRegistration(workload);
	assertMeasurementPolicy(policy);
	const qualification = assessM7AssistancePrivacyQualification(config);
	if (qualification.provisioned) {
		throw new Error(`Environment ${ENVIRONMENT_ID} is provisioned; the M7 accepted-evidence writer must land with the owner lab before a result is emitted.`);
	}
	const computed = computeM7AssistancePrivacyMetrics(measurement, {
		budgetSha256: qualityBudgetSha256(config),
		fixtureSpecification: fixture.specification,
		measurementPolicy: policy,
	});
	const evaluation = evaluateQualityBudget({
		environmentId: ENVIRONMENT_ID,
		rendererRequirement: environment.rendererRequirement,
		thresholds: workload.thresholds,
	}, environment, {
		environmentId: computed.observedEnvironmentId,
		rendererClass: computed.observedEnvironment.rendererClass,
		metrics: computed.metrics,
	});
	const metricGatePassed = evaluation.verdicts.length === workload.thresholds.length
		&& evaluation.verdicts.every(({ passed }) => passed);
	const failures = [...new Set([...evaluation.failures, ...qualification.blockers])];
	return Object.freeze({
		schemaVersion: 1,
		qualificationScope: 'unaccepted-single-target-observation',
		status: metricGatePassed ? 'pending-external' : 'failed',
		workloadId: WORKLOAD_ID,
		fixtureId: FIXTURE_ID,
		qualificationEnvironmentId: ENVIRONMENT_ID,
		observedEnvironmentId: computed.observedEnvironmentId,
		profile: PROFILE,
		observationClass: OBSERVATION_CLASS,
		evidenceClass: computed.evidenceClass,
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
		qualificationEvidencePublished: false,
		qualificationBlockers: Object.freeze(qualification.blockers),
		evaluation: Object.freeze({
			passed: false,
			failures: Object.freeze(failures),
			verdicts: evaluation.verdicts,
		}),
	});
}

/** Name every authority absent from the registered optional owner-lab row. */
export function assessM7AssistancePrivacyQualification(configValue) {
	const config = snapshotStrictJsonData(configValue, 'config');
	const workload = exactDescriptor(config.workloads, WORKLOAD_ID, 'workload');
	const fixture = exactDescriptor(config.fixtures, FIXTURE_ID, 'fixture');
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
	const fingerprint = exactRecord(
		environment.fingerprint,
		OWNER_FINGERPRINT_FIELDS,
		`${ENVIRONMENT_ID}.fingerprint`,
	);
	for (const [field, value] of Object.entries(fingerprint)) {
		if (value === null || value === '') {
			blockers.push(`Environment ${ENVIRONMENT_ID} has no recorded fingerprint ${field}.`);
		}
	}
	if (fixture.status !== 'qualified') {
		blockers.push(`Fixture ${FIXTURE_ID} status is ${String(fixture.status)}; accepted evidence requires status qualified.`);
	}
	if (workload.status !== 'qualified') {
		blockers.push(`Workload ${WORKLOAD_ID} status is ${String(workload.status)}; accepted evidence requires status qualified.`);
	}
	if (!Array.isArray(config.qualification?.qualifiedWorkloadIds)
		|| !config.qualification.qualifiedWorkloadIds.includes(WORKLOAD_ID)) {
		blockers.push(`Workload ${WORKLOAD_ID} is not registered in qualification.qualifiedWorkloadIds.`);
	}
	return Object.freeze({
		provisioned: blockers.length === 0,
		blockers: Object.freeze(blockers),
	});
}

/**
 * Persist the closed raw record and aggregate; accepted publication is deliberately absent.
 * @param {string} outputDirectory
 * @param {unknown} resultValue
 * @param {unknown} [measurementValue]
 */
export async function writeM7AssistancePrivacyResult(
	outputDirectory,
	resultValue,
	measurementValue = null,
) {
	const result = snapshotStrictJsonData(resultValue, 'result');
	if (result.status !== 'pending-external' && result.status !== 'failed') {
		throw new Error(`M7 collector cannot write a ${String(result.status)} result while ${ENVIRONMENT_ID} is unprovisioned.`);
	}
	if (result.qualificationEvidencePublished !== false) {
		throw new Error('M7 collector must not mark qualification evidence as published.');
	}
	if (measurementValue === null) throw new Error('M7 result requires its complete raw measurement.');
	const measurement = snapshotStrictJsonData(measurementValue, 'measurement');
	if (canonicalMeasurementSha256(measurement) !== result.canonicalMeasurementSha256
		|| measurement.budgetSha256 !== result.budgetSha256
		|| measurement.sourceRevision !== result.sourceRevision
		|| measurement.package?.sha256 !== result.observedPackage?.sha256) {
		throw new Error('M7 result is detached from its raw measurement.');
	}
	const target = result.observedPackage?.target;
	if (!PACKAGE_TARGETS.includes(target)) throw new Error('M7 result has an unsupported package target.');
	await mkdir(outputDirectory, { recursive: true });
	const stem = `${WORKLOAD_ID}.${target}.${result.status}`;
	const rawPath = join(outputDirectory, `${stem}.raw.json`);
	const resultPath = join(outputDirectory, `${stem}.json`);
	await writeFile(rawPath, `${JSON.stringify(measurement, null, '\t')}\n`, { flag: 'wx' });
	await writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`, { flag: 'wx' });
	return Object.freeze({ rawPath, resultPath, result });
}

/** Parse `[--measurement <path>] [output-directory]`; qualification flags are refused. */
export function parseM7AssistancePrivacyCliOptions(argsValue) {
	const args = snapshotStrictJsonData(argsValue, 'M7 collector CLI arguments');
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('M7 collector CLI arguments must be strings.');
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
			throw new Error(`M7 assistance qualification is unavailable while ${ENVIRONMENT_ID} is unprovisioned.`);
		}
		if (argument === '--measurement') {
			if (measurementPath !== null) throw new Error('M7 collector accepts one measurement path.');
			expectingMeasurement = true;
			continue;
		}
		if (argument.startsWith('-')) throw new Error(`Unknown M7 collector option ${argument}.`);
		if (outputDirectory !== null) throw new Error('M7 collector accepts one output directory.');
		outputDirectory = argument;
	}
	if (expectingMeasurement) throw new Error('M7 collector option --measurement requires a path.');
	return Object.freeze({ measurementPath, outputDirectory });
}

async function readMeasurementFile(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(
			`M7 assistance measurement is unavailable or invalid: ${errorMessage(error)}.`,
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
		throw new Error(`Workload ${WORKLOAD_ID} does not own the frozen fixture, environment, and five metrics.`);
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

function exactDescriptor(collection, id, label) {
	const matches = Array.isArray(collection)
		? collection.filter((value) => isRecord(value) && value.id === id)
		: [];
	if (matches.length !== 1) throw new Error(`Quality config must contain exactly one ${label} ${id}.`);
	return matches[0];
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
	const cli = parseM7AssistancePrivacyCliOptions(process.argv.slice(2));
	if (cli.measurementPath === null) {
		process.stderr.write('Usage: node scripts/collect-m7-local-assistance-privacy-quality.mjs --measurement <record.json> [output-directory]\n');
		process.exitCode = 2;
		return;
	}
	const collected = await collectM7AssistancePrivacyQuality({
		measurementPath: resolve(cli.measurementPath),
		outputDirectory: resolve(cli.outputDirectory
			?? fileURLToPath(new URL('../test-results/quality/m7-assistance-privacy', import.meta.url))),
	});
	process.stdout.write(`${JSON.stringify(collected.result, null, '\t')}\n`);
	if (collected.result.status !== 'pending-external') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();

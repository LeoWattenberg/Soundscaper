/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateQualityBudget } from './quality-budget-evaluator.mjs';
import {
	M6_REFERENCE_MASTER_ENVIRONMENT_IDS as ENVIRONMENT_IDS,
	M6_REFERENCE_MASTER_FIXTURE_ID as FIXTURE_ID,
	M6_REFERENCE_MASTER_FIXTURE_IDS as FIXTURE_IDS,
	M6_REFERENCE_MASTER_METRIC_IDS as METRIC_IDS,
	M6_REFERENCE_MASTER_OBSERVATION_CLASS as OBSERVATION_CLASS,
	M6_REFERENCE_MASTER_PROFILE as PROFILE,
	M6_REFERENCE_MASTER_WORKLOAD_ID as WORKLOAD_ID,
	computeM6ReferenceMasterMetrics,
} from './lib/m6-reference-master-metrics.mjs';
import { boundedString, exactRecord, isRecord, requireRecord } from './lib/measurement-admission.mjs';
import { snapshotStrictJsonData } from './lib/strict-json-snapshot.mjs';

/*
 * Milestone 6 exit-gate collector. Ordinary CI owns the correctness half of
 * `m6-reference-master-delivery` — conformance, reporting and unreported
 * conversions are proven by the node suite on every change. The RTF half
 * qualifies only on `reference-linux-gpu-01` and `native-os-lab-matrix`, and
 * both are unprovisioned: every fingerprint row is null and neither is
 * qualification-eligible.
 *
 * So this collector deliberately has no accepted-evidence writer. It recomputes
 * the eleven metrics from the delivery's own sealed reports, records them, and
 * emits a pending-external result that names every missing provisioning fact by
 * hand. The day that list empties it stops instead, because a pending record
 * naming nothing missing would read as sign-off.
 *
 * Two things it must never do: copy an intended fingerprint into a null
 * descriptor row, and let a hosted runner stand in for reference hardware.
 */

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const HOSTED_RUNNER_VARIABLES = Object.freeze([
	'GITHUB_ACTIONS', 'CI', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI',
]);

/** Read a reference-run measurement and persist only unaccepted evidence. */
export async function collectM6ReferenceMasterQuality(optionsValue, dependencies = {}) {
	const options = exactRecord(
		snapshotStrictJsonData(optionsValue, 'collector options'),
		['measurementPath', 'outputDirectory'],
		'collector options',
	);
	const measurementPath = boundedString(options.measurementPath, 1, 4_096, 'measurementPath');
	const outputDirectory = boundedString(options.outputDirectory, 1, 4_096, 'outputDirectory');
	assertM6ReferenceMasterCollectionHost(dependencies.processEnvironment ?? process.env);
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const readMeasurement = dependencies.readMeasurement ?? readMeasurementFile;
	const measurement = await readMeasurement(measurementPath);
	const result = createM6ReferenceMasterResult(measurement, config);
	const writeResult = dependencies.writeResult ?? writeM6ReferenceMasterResult;
	return writeResult(outputDirectory, result);
}

/**
 * Recompute the eleven metrics and evaluate them against the checked-in
 * thresholds. Threshold values live only in `config/quality-budgets.json`; this
 * module reads them and never restates one.
 */
export function createM6ReferenceMasterResult(measurementValue, configValue) {
	const config = snapshotStrictJsonData(configValue, 'config');
	const workload = exactDescriptor(config.workloads, WORKLOAD_ID, 'workload');
	const fixtures = FIXTURE_IDS.map((id) => exactDescriptor(config.fixtures, id, 'fixture'));
	const fixture = fixtures[0];
	const policy = requireRecord(config.measurementPolicy, 'measurementPolicy');
	assertWorkloadRegistration(workload);
	assertCompanionFixture(fixtures);
	const computed = computeM6ReferenceMasterMetrics(measurementValue, {
		fixtureSpecification: fixture.specification,
		fixtureCanvases: fixtures.map(({ specification }) => Object.freeze({
			width: specification.videoWidth,
			height: specification.videoHeight,
		})),
		measurementPolicy: policy,
	});
	const environmentId = computed.environmentId;
	const environment = exactDescriptor(config.environments, environmentId, 'environment');
	const qualification = assessM6ReferenceMasterQualification(config, environmentId);
	if (qualification.provisioned) {
		// There is no accepted-evidence writer here yet. Emitting `pending-external`
		// with an empty blocker list would read as "measured, awaiting sign-off"
		// when the truth is that the publishing half is unwritten, so the collector
		// stops rather than describe a lab it can no longer describe.
		throw new Error(`Environment ${environmentId} is provisioned; the M6 accepted-evidence writer lands with the lab and must exist before a result is emitted.`);
	}
	const evaluation = evaluateQualityBudget({
		environmentId,
		rendererRequirement: environment.rendererRequirement,
		thresholds: workload.thresholds,
	}, environment, {
		environmentId,
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
		fixtureIds: FIXTURE_IDS,
		environmentId,
		qualificationEnvironmentId: environmentId,
		platformId: computed.platformId,
		profile: PROFILE,
		observationClass: OBSERVATION_CLASS,
		attemptCount: 1,
		retryCount: policy.benchmarkRetries,
		rendererClass: 'unknown',
		// The run's own observation, kept beside the result. It is never merged
		// into the descriptor's null fingerprint rows by this collector.
		observedFingerprint: computed.fingerprint,
		fixture: Object.freeze(snapshotStrictJsonData(fixture.specification, 'fixture.specification')),
		// Both canvases the run had to cover, recorded beside the numbers so a
		// result says which deliveries produced them.
		fixtures: Object.freeze(fixtures.map(({ id, specification }) => Object.freeze({
			id,
			specification: Object.freeze(snapshotStrictJsonData(specification, 'fixture.specification')),
		}))),
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
 * Name every fact the reference environment still owes, one line per missing
 * thing, so a pending result says what would have to become true rather than
 * how close it came.
 */
export function assessM6ReferenceMasterQualification(configValue, environmentId) {
	const config = snapshotStrictJsonData(configValue, 'config');
	const workload = exactDescriptor(config.workloads, WORKLOAD_ID, 'workload');
	const environment = exactDescriptor(config.environments, environmentId, 'environment');
	const blockers = [];
	if (environment.status !== 'active') {
		// Worded exactly as the shared evaluator words it, so the two lists collapse
		// into one statement of the same missing fact.
		blockers.push(`Environment ${environmentId} is ${String(environment.status)}.`);
	}
	if (environment.qualificationEligible !== true) {
		blockers.push(`Environment ${environmentId} is not qualification-eligible.`);
	}
	if (!Array.isArray(environment.eligibleWorkloadIds)
		|| !environment.eligibleWorkloadIds.includes(WORKLOAD_ID)) {
		blockers.push(`Environment ${environmentId} does not list ${WORKLOAD_ID} among its eligible workloads.`);
	}
	const fingerprint = requireRecord(environment.fingerprint, `${environmentId}.fingerprint`);
	for (const row of Object.keys(fingerprint).sort()) {
		if (fingerprint[row] === null || fingerprint[row] === undefined) {
			blockers.push(`Environment ${environmentId} has no recorded fingerprint for ${row}.`);
		}
	}
	// Every registered fixture, not only the suite: a companion left behind is a
	// delivery canvas the gate stopped covering, and the blocker has to name it.
	for (const { id, status } of fixtureStatuses(config)) {
		if (status !== 'qualified') {
			blockers.push(`Fixture ${id} status is ${String(status)}; accepted evidence requires a built reference suite.`);
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
 * A hosted runner proves the correctness half in ordinary CI, but its timing is
 * shared with whatever else the host is doing, so it may never file an RTF.
 */
export function assertM6ReferenceMasterCollectionHost(processEnvironment) {
	for (const key of HOSTED_RUNNER_VARIABLES) {
		const value = ownEnvironmentString(processEnvironment, key);
		if (value === undefined || value === '') continue;
		throw new Error(`M6 reference collection refuses to run on a hosted runner (${key} is set); a shared host is not render-time evidence.`);
	}
}

/** Persist unaccepted evidence only; the accepted writer lands with the lab. */
export async function writeM6ReferenceMasterResult(outputDirectory, resultValue) {
	const result = snapshotStrictJsonData(resultValue, 'result');
	if (result.status !== 'pending-external' && result.status !== 'failed') {
		throw new Error(`M6 collector cannot write a ${String(result.status)} result while its environments are unprovisioned.`);
	}
	if (result.qualificationEvidencePublished !== false) {
		throw new Error('M6 collector must not mark qualification evidence as published.');
	}
	await mkdir(outputDirectory, { recursive: true });
	const resultPath = join(outputDirectory, `${WORKLOAD_ID}.${result.status}.json`);
	await writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`, { flag: 'wx' });
	return Object.freeze({ resultPath, result });
}

/** Parse `[--measurement <path>] [output-directory]`; qualification flags are refused. */
export function parseM6ReferenceMasterCliOptions(argsValue) {
	const args = snapshotStrictJsonData(argsValue, 'M6 collector CLI arguments');
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('M6 collector CLI arguments must be strings.');
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
			throw new Error('M6 reference qualification is unavailable while both of its environments are unprovisioned.');
		}
		if (argument === '--measurement') {
			if (measurementPath !== null) throw new Error('M6 collector accepts one measurement path.');
			expectingMeasurement = true;
			continue;
		}
		if (argument.startsWith('-')) throw new Error(`Unknown M6 collector option ${argument}.`);
		if (outputDirectory !== null) throw new Error('M6 collector accepts one output directory.');
		outputDirectory = argument;
	}
	if (expectingMeasurement) throw new Error('M6 collector option --measurement requires a path.');
	return Object.freeze({ measurementPath, outputDirectory });
}

async function readMeasurementFile(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(
			`M6 reference measurement is unavailable or invalid: ${errorMessage(error)}.`,
			{ cause: error },
		);
	}
}

function fixtureStatuses(config) {
	return FIXTURE_IDS.map((id) => Object.freeze({
		id,
		status: exactDescriptor(config.fixtures, id, 'fixture').status,
	}));
}

/**
 * The companion is the same master delivered vertically, and must stay so.
 *
 * Its whole reason for existing is that the canvas differs and nothing else
 * does: that is what lets one real-time denominator cover both deliveries. If
 * a later edit gave it another duration or rate, the RTF metrics would silently
 * be measured against the wrong length of media, so the divergence is refused
 * here rather than absorbed.
 */
function assertCompanionFixture(fixtures) {
	const [suite, ...companions] = fixtures.map(({ specification }) => requireRecord(
		specification, 'fixture.specification',
	));
	for (const companion of companions) {
		for (const key of ['audioDurationSeconds', 'videoDurationSeconds', 'videoFrameRate']) {
			if (companion[key] !== suite[key]) {
				throw new Error(`M6 companion fixture ${key} must match the reference suite exactly.`);
			}
		}
		if (companion.videoWidth === suite.videoWidth && companion.videoHeight === suite.videoHeight) {
			throw new Error('M6 companion fixture must deliver a canvas the reference suite does not.');
		}
	}
}

function assertWorkloadRegistration(workload) {
	const thresholdIds = Array.isArray(workload.thresholds)
		? workload.thresholds.map((threshold) => threshold?.metricId)
		: [];
	if (!sameStrings(workload.fixtureIds, [...FIXTURE_IDS])
		|| !sameStrings(workload.environmentIds, [...ENVIRONMENT_IDS])
		|| !sameStrings(thresholdIds, METRIC_IDS)) {
		throw new Error(`Workload ${WORKLOAD_ID} does not own both frozen fixtures, two environments, and eleven metrics.`);
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
	const cli = parseM6ReferenceMasterCliOptions(process.argv.slice(2));
	if (cli.measurementPath === null) {
		process.stderr.write('Usage: node scripts/collect-m6-reference-master-quality.mjs --measurement <record.json> [output-directory]\n');
		process.exitCode = 2;
		return;
	}
	const collected = await collectM6ReferenceMasterQuality({
		measurementPath: resolve(cli.measurementPath),
		outputDirectory: resolve(cli.outputDirectory
			?? fileURLToPath(new URL('../test-results/quality/m6-reference-master', import.meta.url))),
	});
	process.stdout.write(`${JSON.stringify(collected.result, null, '\t')}\n`);
	if (collected.result.status !== 'pending-external') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();

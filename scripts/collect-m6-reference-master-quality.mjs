/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';

import {
	M6_REFERENCE_MASTER_FIXTURE_ID as FIXTURE_ID,
	M6_REFERENCE_MASTER_FIXTURE_IDS as FIXTURE_IDS,
	M6_REFERENCE_MASTER_METRIC_IDS as METRIC_IDS,
	M6_REFERENCE_MASTER_OBSERVATION_CLASS as OBSERVATION_CLASS,
	M6_REFERENCE_MASTER_PROFILE as PROFILE,
	M6_REFERENCE_MASTER_WORKLOAD_ID as WORKLOAD_ID,
	computeM6ReferenceMasterMetrics,
} from './lib/m6-reference-master-metrics.mjs';
import { requireRecord } from './lib/measurement-validation.mjs';
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

/*
 * Milestone 6 diagnostic collector. Ordinary CI owns the correctness half of
 * `m6-reference-master-delivery` — conformance, reporting and unreported
 * conversions are proven by the node suite on every change. The local RTF run
 * measures either the owner reference host or a native lab profile. It
 * recomputes eleven metrics from the delivery's own closed reports and reports
 * the checked-in thresholds without making a release claim.
 *
 * Two things it must never do: copy an intended fingerprint into a null
 * descriptor row, and let a hosted runner stand in for reference hardware.
 */

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
/** Read a reference-run measurement and persist its diagnostic result. */
export async function collectM6ReferenceMasterQuality(optionsValue, dependencies = {}) {
	const { measurementPath, outputDirectory } = normalizeQualityCollectorOptions(optionsValue);
	assertM6ReferenceMasterCollectionHost(dependencies.processEnvironment ?? process.env);
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const readMeasurement = dependencies.readMeasurement
		?? ((path) => readQualityCollectorMeasurement(path, 'M6 reference measurement'));
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
	const workload = qualityWorkloadBudget(config, WORKLOAD_ID);
	const fixtures = FIXTURE_IDS.map((id) => qualityFixture(config, id));
	const fixture = fixtures[0];
	const policy = DIAGNOSTIC_MEASUREMENT_POLICY;
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
	const evaluation = evaluateQualityWorkload(config, workload, computed.metrics);
	const metricGatePassed = evaluation.passed;
	const passed = metricGatePassed;
	return Object.freeze({
		schemaVersion: 1,
		status: passed ? 'passed' : 'failed',
		workloadId: WORKLOAD_ID,
		fixtureId: FIXTURE_ID,
		fixtureIds: FIXTURE_IDS,
		environmentId,
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
		evaluation,
	});
}

/**
 * A hosted runner proves the correctness half in ordinary CI, but its timing is
 * shared with whatever else the host is doing, so it may never file an RTF.
 */
export function assertM6ReferenceMasterCollectionHost(processEnvironment) {
	assertNonHostedQualityCollector(
		processEnvironment,
		(key) => `M6 reference collection refuses to run on a hosted runner (${key} is set); a shared host is not render-time evidence.`,
	);
}

/** Persist one immutable diagnostic result. */
export async function writeM6ReferenceMasterResult(outputDirectory, resultValue) {
	return writeQualityCollectorResult(outputDirectory, resultValue, {
		resultLabel: 'M6 diagnostic result',
		resultFilename: (result) => `${WORKLOAD_ID}.${result.status}.json`,
	});
}

/** Parse `[--measurement <path>] [output-directory]`. */
export function parseM6ReferenceMasterCliOptions(argsValue) {
	return parseQualityCollectorCliOptions(argsValue, 'M6');
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
	if (!sameOrderedStrings(workload.fixtureIds, [...FIXTURE_IDS])
		|| !sameOrderedStrings(thresholdIds, METRIC_IDS)) {
		throw new Error(`Workload ${WORKLOAD_ID} does not own both frozen fixtures and eleven measurements.`);
	}
}

if (isDirectExecution(import.meta.url)) {
	await runQualityCollectorMain({
		parseOptions: parseM6ReferenceMasterCliOptions,
		collect: collectM6ReferenceMasterQuality,
		defaultOutputDirectory: new URL('../test-results/quality/m6-reference-master', import.meta.url),
		usage: 'Usage: node scripts/collect-m6-reference-master-quality.mjs --measurement <record.json> [output-directory]\n',
	});
}

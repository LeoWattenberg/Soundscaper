/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDeliveryReportForPlan } from '../src/common/editor/delivery-conversion-inventory.ts';
import {
	M6_REFERENCE_MASTER_METRIC_IDS,
	M6_REFERENCE_MASTER_WORKLOAD_ID,
	computeM6ReferenceMasterMetrics,
} from '../scripts/lib/m6-reference-master-metrics.mjs';
import {
	assertM6ReferenceMasterCollectionHost,
	assessM6ReferenceMasterQualification,
	collectM6ReferenceMasterQuality,
	createM6ReferenceMasterResult,
	parseM6ReferenceMasterCliOptions,
	writeM6ReferenceMasterResult,
} from '../scripts/collect-m6-reference-master-quality.mjs';

const CONFIG = JSON.parse(
	await readFile(new URL('../config/quality-budgets.json', import.meta.url), 'utf8'),
);

/**
 * A real sealed report, built by the exporter's own report builder from a real
 * plan and real conformance findings.
 *
 * Hand-writing the report here would prove only that this test can spell its own
 * item codes. Building it the way a delivery does means the collector breaks if
 * the exporter ever renames `errorSamples` or moves the channel-map count,
 * which is exactly the coupling the exit gate depends on.
 */
function audioReport(options: {
	readonly durationErrorSamples?: number;
	readonly channelMapErrors?: number;
	readonly extraConversion?: boolean;
} = {}) {
	const plan = {
		format: 'wav' as const,
		sampleRate: 48_000,
		encoding: { channelCount: 2, sampleFormat: 'int24', bitDepth: 24 },
		ditherMode: 'none',
	};
	return createDeliveryReportForPlan(plan, { sampleRate: 48_000 }, null, [
		{
			code: 'delivery.conformance-duration',
			disposition: (options.durationErrorSamples ?? 0) === 0 ? 'preserved' : 'missing',
			severity: (options.durationErrorSamples ?? 0) === 0 ? 'info' : 'error',
			data: { errorSamples: options.durationErrorSamples ?? 0 },
			message: 'duration',
		},
		{
			code: 'delivery.conformance-channel-map',
			disposition: (options.channelMapErrors ?? 0) === 0 ? 'preserved' : 'missing',
			severity: (options.channelMapErrors ?? 0) === 0 ? 'info' : 'error',
			data: { channelMapErrors: options.channelMapErrors ?? 0 },
			message: 'channel map',
		},
	] as never);
}

function audioArtifact(
	reportOptions: Parameters<typeof audioReport>[0] = {},
	overrides: Record<string, unknown> = {},
) {
	const report = audioReport(reportOptions);
	return {
		artifactId: 'audio-master',
		report,
		// What the plan implied, as the report inventory saw it. The collector
		// counts the difference rather than trusting a scalar.
		plannedConversions: report.items.map(({ code, disposition }) => ({ code, disposition })),
		publishedByteLength: 1_234_567,
		publishedComplete: true,
		...overrides,
	};
}

function videoArtifact(overrides: Record<string, unknown> = {}) {
	return {
		artifactId: 'video-master',
		report: { schemaVersion: 1, items: [], counts: { preserved: 0, converted: 0, missing: 0, omitted: 0 } },
		plannedConversions: [],
		publishedByteLength: 7_654_321,
		publishedComplete: true,
		frameCountError: 0,
		avDriftMs: 0,
		captionCueErrorFrames: 0,
		...overrides,
	};
}

function measurement(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		workloadId: M6_REFERENCE_MASTER_WORKLOAD_ID,
		profile: 'reference-master-delivery-v1',
		environmentId: 'reference-linux-gpu-01',
		platformId: 'linuxX64',
		fingerprint: { osImage: 'observed', cpuModel: 'observed' },
		audioArtifacts: [audioArtifact()],
		videoArtifacts: [videoArtifact()],
		audioRenderSeconds: [1_800, 1_810, 1_820, 1_830, 1_840],
		videoRenderSeconds: [600, 620, 640, 660, 680],
		warmupRenderSeconds: [2_000],
		...overrides,
	};
}

const FIXTURE = CONFIG.fixtures.find(({ id }: { id: string }) => id === 'm6-reference-master-suite-v1');

function metrics(record: Record<string, unknown> = measurement()) {
	return computeM6ReferenceMasterMetrics(record, {
		fixtureSpecification: FIXTURE.specification,
		measurementPolicy: CONFIG.measurementPolicy,
	}).metrics;
}

test('the eleven metrics are recomputed from the delivery reports the run filed', () => {
	const computed = metrics();
	assert.deepEqual(Object.keys(computed).sort(), [...M6_REFERENCE_MASTER_METRIC_IDS].sort());
	assert.equal(computed['delivery.audioDurationErrorSamples'], 0);
	assert.equal(computed['delivery.channelMapErrors'], 0);
	assert.equal(computed['delivery.unreportedConversions'], 0);
	assert.equal(computed['delivery.partialPublishedOutputBytes'], 0);
	// Nearest-rank p95 of five samples is the fifth: 1840s of render for one hour
	// of audio, and 680s for ten minutes of video.
	assert.equal(computed['delivery.audioRenderP95Rtf'], 1_840 / 3_600);
	assert.equal(computed['delivery.webVideoRenderP95Rtf'], 680 / 600);
});

test('a conformance error reaches the gate through the report, not around it', () => {
	const errored = metrics(measurement({
		audioArtifacts: [audioArtifact({ durationErrorSamples: -7, channelMapErrors: 1 })],
	}));
	assert.equal(errored['delivery.audioDurationErrorSamples'], 7, 'magnitude, whichever way it is short');
	assert.equal(errored['delivery.channelMapErrors'], 1);

	// A delivery nothing checked cannot be assumed to have passed.
	const unchecked = audioArtifact();
	assert.throws(
		() => metrics(measurement({
			audioArtifacts: [{
				...unchecked,
				report: {
					...unchecked.report,
					items: unchecked.report.items.filter(({ code }) => code !== 'delivery.conformance-duration'),
				},
			}],
		})),
		/has no delivery.conformance-duration item/u,
	);
});

test('an unreported conversion is counted by comparing the plan with the report', () => {
	const artifact = audioArtifact();
	const withHidden = metrics(measurement({
		audioArtifacts: [{
			...artifact,
			plannedConversions: [
				...artifact.plannedConversions,
				{ code: 'delivery.lossy-encode', disposition: 'converted' },
				{ code: 'delivery.markers-omitted', disposition: 'omitted' },
				// Preserved conversions disclose nothing, so they are not counted.
				{ code: 'delivery.adm-passthrough', disposition: 'preserved' },
			],
		}],
	}));
	assert.equal(withHidden['delivery.unreportedConversions'], 2);
});

test('loudness error is the gap between what the gain promised and what the file measures', () => {
	// Not target-versus-delivered: a true-peak ceiling that binds before the
	// integrated target is the documented outcome, and a gate written the other
	// way would fail every correctly delivered ceiling-limited master.
	const artifact = audioArtifact();
	const withLoudness = metrics(measurement({
		audioArtifacts: [{
			...artifact,
			report: {
				...artifact.report,
				items: [...artifact.report.items, {
					code: 'delivery.loudness',
					disposition: 'converted',
					severity: 'info',
					data: {
						projectedLoudnessLufs: -23, deliveredLoudnessLufs: -23.15,
						projectedTruePeakDb: -1, deliveredTruePeakDb: -0.95,
						targetLufs: -23, shortfallLu: 2,
					},
				}],
			},
		}],
	}));
	assert.ok(Math.abs(withLoudness['delivery.integratedLoudnessErrorLu'] - 0.15) < 1e-9);
	assert.ok(Math.abs(withLoudness['delivery.truePeakErrorDb'] - 0.05) < 1e-9);
});

test('bytes published for an artifact that never completed are partial output', () => {
	const partial = metrics(measurement({
		videoArtifacts: [videoArtifact({ publishedComplete: false, publishedByteLength: 4_096 })],
	}));
	assert.equal(partial['delivery.partialPublishedOutputBytes'], 4_096);
});

test('a run that hides a trial, an artifact, or a field is rejected rather than defaulted', () => {
	for (const [override, pattern] of [
		[{ audioRenderSeconds: [1, 2, 3, 4] }, /exactly 5 timed runs/u],
		[{ warmupRenderSeconds: [] }, /exactly 1 timed runs/u],
		[{ audioArtifacts: [] }, /at least one audio artifact/u],
		[{ videoArtifacts: [] }, /at least one video artifact/u],
		[{ environmentId: 'hosted-ci' }, /one of the workload's two environments/u],
		[{ workloadId: 'something-else' }, /must name workload/u],
		[{ schemaVersion: 2 }, /schemaVersion must be 1/u],
	] as const) {
		assert.throws(() => metrics(measurement(override as never)), pattern, JSON.stringify(override));
	}
});

test('the collector refuses to publish, and names every fact the lab still owes', () => {
	const result = createM6ReferenceMasterResult(measurement(), CONFIG);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.qualificationEvidencePublished, false);
	assert.equal(result.evaluation.passed, false, 'a pending result never claims the gate passed');
	assert.ok(result.metricGatePassed, 'though the metrics themselves are within their thresholds');
	assert.deepEqual(result.observedFingerprint, { osImage: 'observed', cpuModel: 'observed' });

	const blockers = result.qualificationBlockers;
	assert.ok(blockers.includes('Environment reference-linux-gpu-01 is unprovisioned.'));
	assert.ok(blockers.includes('Environment reference-linux-gpu-01 is not qualification-eligible.'));
	assert.ok(blockers.some((line: string) => /has no recorded fingerprint for gpuModel/u.test(line)));
	assert.ok(blockers.some((line: string) => /Fixture m6-reference-master-suite-v1 status is planned/u.test(line)));
	assert.ok(blockers.some((line: string) => /Workload .* status is planned/u.test(line)));
	assert.ok(blockers.some((line: string) => /not registered in qualification.qualifiedWorkloadIds/u.test(line)));
});

test('a metric outside its threshold is a failure, not a pending result', () => {
	const slow = createM6ReferenceMasterResult(
		measurement({ audioRenderSeconds: [3_600, 3_700, 3_800, 3_900, 4_000] }),
		CONFIG,
	);
	assert.equal(slow.status, 'failed');
	assert.equal(slow.metricGatePassed, false);
	assert.ok(slow.evaluation.failures.length > 0);
});

test('the collector stops rather than sign off once the environment is provisioned', () => {
	// A pending record naming nothing missing would read as "measured, awaiting
	// sign-off" when the truth is that the publishing half is unwritten.
	const provisioned = provisionedConfig();
	assert.equal(assessM6ReferenceMasterQualification(provisioned, 'reference-linux-gpu-01').provisioned, true);
	assert.throws(
		() => createM6ReferenceMasterResult(measurement(), provisioned),
		/accepted-evidence writer lands with the lab/u,
	);
});

test('a hosted runner is not render-time evidence, and acceptance flags do not exist', () => {
	assert.doesNotThrow(() => assertM6ReferenceMasterCollectionHost({}));
	for (const key of ['GITHUB_ACTIONS', 'CI', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI']) {
		assert.throws(
			() => assertM6ReferenceMasterCollectionHost({ [key]: 'true' }),
			/refuses to run on a hosted runner/u,
			key,
		);
	}
	for (const flag of ['--accept', '--qualify', '--publish']) {
		assert.throws(() => parseM6ReferenceMasterCliOptions([flag]), /qualification is unavailable/u, flag);
	}
	assert.deepEqual(
		parseM6ReferenceMasterCliOptions(['--measurement', 'record.json', 'out']),
		{ measurementPath: 'record.json', outputDirectory: 'out' },
	);
});

test('the writer refuses any status that would read as acceptance', async () => {
	const result = createM6ReferenceMasterResult(measurement(), CONFIG);
	await assert.rejects(
		() => writeM6ReferenceMasterResult('/nonexistent', { ...result, status: 'accepted' }),
		/cannot write a accepted result/u,
	);
	await assert.rejects(
		() => writeM6ReferenceMasterResult('/nonexistent', { ...result, qualificationEvidencePublished: true }),
		/must not mark qualification evidence as published/u,
	);
});

test('the collector re-checks that the workload still owns its fixture, environments, and metrics', async () => {
	const drifted = JSON.parse(JSON.stringify(CONFIG));
	const workload = drifted.workloads.find(({ id }: { id: string }) => id === M6_REFERENCE_MASTER_WORKLOAD_ID);
	workload.thresholds.pop();
	assert.throws(
		() => createM6ReferenceMasterResult(measurement(), drifted),
		/does not own the frozen fixture, two environments, and eleven metrics/u,
	);

	// And the collector never reaches a writer when the measurement cannot be read.
	await assert.rejects(
		() => collectM6ReferenceMasterQuality(
			{ measurementPath: 'missing.json', outputDirectory: 'out' },
			{
				processEnvironment: {},
				config: CONFIG,
				readMeasurement: () => { throw new Error('nope'); },
				writeResult: () => assert.fail('the writer must not run'),
			},
		),
		/nope/u,
	);
});

test('the collected result lands as a pending file and never overwrites one', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m6-quality-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const collected = await collectM6ReferenceMasterQuality(
		{ measurementPath: 'record.json', outputDirectory: directory },
		{ processEnvironment: {}, config: CONFIG, readMeasurement: () => measurement() },
	);
	assert.equal(
		collected.resultPath,
		join(directory, 'm6-reference-master-delivery.pending-external.json'),
		'the status is in the file name, so an accepted one could not be mistaken for this',
	);
	const written = JSON.parse(await readFile(collected.resultPath, 'utf8'));
	assert.equal(written.status, 'pending-external');
	assert.equal(written.qualificationEvidencePublished, false);
	// The run's own observation stays beside the result rather than filling in
	// the descriptor's null fingerprint rows.
	assert.deepEqual(written.observedFingerprint, { osImage: 'observed', cpuModel: 'observed' });

	await assert.rejects(
		() => collectM6ReferenceMasterQuality(
			{ measurementPath: 'record.json', outputDirectory: directory },
			{ processEnvironment: {}, config: CONFIG, readMeasurement: () => measurement() },
		),
		/EEXIST/u,
		'a second run cannot quietly replace the first run\'s evidence',
	);
});

function provisionedConfig() {
	const config = JSON.parse(JSON.stringify(CONFIG));
	const environment = config.environments.find(({ id }: { id: string }) => id === 'reference-linux-gpu-01');
	environment.status = 'active';
	environment.qualificationEligible = true;
	environment.eligibleWorkloadIds = [M6_REFERENCE_MASTER_WORKLOAD_ID];
	for (const row of Object.keys(environment.fingerprint)) environment.fingerprint[row] = 'recorded';
	config.fixtures.find(({ id }: { id: string }) => id === 'm6-reference-master-suite-v1').status = 'qualified';
	config.workloads.find(({ id }: { id: string }) => id === M6_REFERENCE_MASTER_WORKLOAD_ID).status = 'qualified';
	config.qualification.qualifiedWorkloadIds = [
		...config.qualification.qualifiedWorkloadIds, M6_REFERENCE_MASTER_WORKLOAD_ID,
	];
	return config;
}

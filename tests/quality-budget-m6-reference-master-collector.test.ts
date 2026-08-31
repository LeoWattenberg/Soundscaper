/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDeliveryReportForPlan } from '../src/common/editor/delivery-conversion-inventory.ts';
import {
	M6_LOUDNESS_ITEM_CODES,
	M6_REFERENCE_MASTER_METRIC_IDS,
	M6_REFERENCE_MASTER_WORKLOAD_ID,
	computeM6ReferenceMasterMetrics,
} from '../scripts/lib/m6-reference-master-metrics.mjs';
import {
	assertM6ReferenceMasterCollectionHost,
	collectM6ReferenceMasterQuality,
	createM6ReferenceMasterResult,
	parseM6ReferenceMasterCliOptions,
	writeM6ReferenceMasterResult,
} from '../scripts/collect-m6-reference-master-quality.mjs';
import { DIAGNOSTIC_MEASUREMENT_POLICY } from '../scripts/lib/quality-budget-config.mjs';

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
/**
 * A delivered loudness result, shaped the way the normalization decision is.
 * The report builder keys the item code on what the delivery found, so letting
 * it choose the code is what stops the collector and this test from agreeing on
 * a name the exporter never writes.
 */
function deliveredLoudness(overrides: Record<string, unknown> = {}) {
	return {
		outcome: 'normalized',
		gainDb: 2.5,
		measuredLoudnessLufs: -25.5,
		measuredTruePeakDb: -3.5,
		projectedLoudnessLufs: -23,
		projectedTruePeakDb: -1,
		deliveredLoudnessLufs: -23.15,
		deliveredTruePeakDb: -0.95,
		target: { integratedLufs: -23, truePeakCeilingDb: -1 },
		targetShortfallLu: 0,
		reason: 'normalized to the requested target',
		...overrides,
	};
}

function audioReport(options: {
	readonly durationErrorSamples?: number;
	readonly channelMapErrors?: number;
	readonly extraConversion?: boolean;
	readonly loudness?: Record<string, unknown> | null;
} = {}) {
	const plan = {
		format: 'wav' as const,
		sampleRate: 48_000,
		encoding: { channelCount: 2, sampleFormat: 'int24', bitDepth: 24 },
		ditherMode: 'none',
	};
	return createDeliveryReportForPlan(plan, { sampleRate: 48_000 }, ('loudness' in options ? options.loudness : deliveredLoudness()) as never, [
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
		canvas: { width: 1_280, height: 720 },
		frameCountError: 0,
		avDriftMs: 0,
		captionCueErrorFrames: 0,
		...overrides,
	};
}

/** The 9:16 delivery of the same master, which the gate also has to cover. */
function verticalVideoArtifact(overrides: Record<string, unknown> = {}) {
	return videoArtifact({
		artifactId: 'video-master-vertical',
		canvas: { width: 1_080, height: 1_920 },
		...overrides,
	});
}

function measurement(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		workloadId: M6_REFERENCE_MASTER_WORKLOAD_ID,
		profile: 'reference-master-delivery-v1',
		environmentId: 'local-runtime-diagnostics',
		platformId: 'win32-x64',
		fingerprint: { osImage: 'observed', cpuModel: 'observed' },
		audioArtifacts: [audioArtifact()],
		videoArtifacts: [videoArtifact(), verticalVideoArtifact()],
		audioRenderSeconds: [1_800, 1_810, 1_820, 1_830, 1_840],
		videoRenderSeconds: {
			'1280x720': [600, 620, 640, 660, 680],
			'1080x1920': [700, 720, 740, 760, 780],
		},
		warmupRenderSeconds: [2_000],
		...overrides,
	};
}

const FIXTURE = CONFIG.fixtures.find(({ id }: { id: string }) => id === 'm6-reference-master-suite-v1');
const VERTICAL_FIXTURE = CONFIG.fixtures.find(
	({ id }: { id: string }) => id === 'm6-reference-master-vertical-v1',
);
const FIXTURE_CANVASES = [FIXTURE, VERTICAL_FIXTURE].map(
	({ specification }: { specification: { videoWidth: number; videoHeight: number } }) => ({
		width: specification.videoWidth,
		height: specification.videoHeight,
	}),
);

function metrics(record: Record<string, unknown> = measurement()) {
	return computeM6ReferenceMasterMetrics(record, {
		fixtureSpecification: FIXTURE.specification,
		fixtureCanvases: FIXTURE_CANVASES,
		measurementPolicy: DIAGNOSTIC_MEASUREMENT_POLICY,
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
	// of audio. The video row reads the slowest canvas, not the pool, because the
	// vertical companion exists to be covered rather than averaged away.
	assert.equal(computed['delivery.audioRenderP95Rtf'], 1_840 / 3_600);
	assert.equal(computed['delivery.webVideoRenderP95Rtf'], 780 / 600);
	assert.equal(
		computeM6ReferenceMasterMetrics(measurement(), {
			fixtureSpecification: FIXTURE.specification,
			fixtureCanvases: FIXTURE_CANVASES,
			measurementPolicy: DIAGNOSTIC_MEASUREMENT_POLICY,
		}).rawSampleCounts.videoRenderRuns,
		10,
		'five timed runs per registered canvas',
	);
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
	//
	// The report is built by the exporter's own builder, which chooses the item
	// code from what the delivery found. This test used to append an item coded
	// `delivery.loudness` — a code the exporter has never written — and the
	// collector matched the same invented name, so both loudness metrics computed
	// as zero from an empty set and the gate passed without reading a measurement.
	const withLoudness = metrics(measurement({
		audioArtifacts: [audioArtifact({
			loudness: deliveredLoudness({ deliveredLoudnessLufs: -23.15, deliveredTruePeakDb: -0.95 }),
		})],
	}));
	assert.ok(Math.abs(withLoudness['delivery.integratedLoudnessErrorLu'] - 0.15) < 1e-9);
	assert.ok(Math.abs(withLoudness['delivery.truePeakErrorDb'] - 0.05) < 1e-9);
});

test('every loudness code the collector accepts is one the exporter actually writes', () => {
	// The collector reads a family of codes; the exporter picks one per outcome.
	// Deriving the expectation from a real report is what keeps the two from
	// drifting apart again without anything going red.
	for (const [loudness, expected] of [
		[deliveredLoudness(), 'delivery.loudness-normalized'],
		[deliveredLoudness({ outcome: 'not-requested' }), 'delivery.loudness-measured'],
		[deliveredLoudness({ outcome: 'ceiling-limited', targetShortfallLu: 2 }), 'delivery.loudness-target-missed'],
		[deliveredLoudness({ measuredLoudnessLufs: null }), 'delivery.loudness-unmeasurable'],
	] as const) {
		const report = audioReport({ loudness: loudness as Record<string, unknown> });
		const item = report.items.find(({ code }) => code.startsWith('delivery.loudness'));
		assert.equal(item?.code, expected);
		assert.ok(
			M6_LOUDNESS_ITEM_CODES.has(String(item?.code)),
			`the collector ignores ${String(item?.code)}, so a run carrying it measures nothing`,
		);
	}
});

test('a run whose deliveries measured no loudness fails rather than reporting zero error', () => {
	assert.throws(
		() => metrics(measurement({ audioArtifacts: [audioArtifact({ loudness: null })] })),
		/filed no delivered loudness measurement/u,
	);
});

test('bytes published for an artifact that never completed are partial output', () => {
	const partial = metrics(measurement({
		videoArtifacts: [
			videoArtifact({ publishedComplete: false, publishedByteLength: 4_096 }),
			verticalVideoArtifact(),
		],
	}));
	assert.equal(partial['delivery.partialPublishedOutputBytes'], 4_096);
});

test('a run that never delivered the vertical canvas has not covered the gate', () => {
	// Two landscape deliveries satisfy every metric while leaving the reframing
	// the canvas lift added entirely unexercised.
	assert.throws(
		() => metrics(measurement({
			videoArtifacts: [videoArtifact(), videoArtifact({ artifactId: 'video-master-second' })],
		})),
		/filed no video delivery at 1080x1920/u,
	);
	// And a run must say what canvas each delivery used at all.
	assert.throws(
		() => metrics(measurement({
			videoArtifacts: [videoArtifact({ canvas: undefined }), verticalVideoArtifact()],
		})),
		/canvas/u,
	);
});

test('the companion fixture must stay the same master at another canvas', () => {
	for (const [mutate, pattern] of [
		[(specification: Record<string, unknown>) => { specification.videoDurationSeconds = 300; },
			/videoDurationSeconds must match the reference suite/u],
		[(specification: Record<string, unknown>) => { specification.videoFrameRate = 25; },
			/videoFrameRate must match the reference suite/u],
		[(specification: Record<string, unknown>) => {
			specification.videoWidth = 1_280;
			specification.videoHeight = 720;
		}, /must deliver a canvas the reference suite does not/u],
	] as const) {
		const drifted = JSON.parse(JSON.stringify(CONFIG));
		mutate(drifted.fixtures.find(
			({ id }: { id: string }) => id === 'm6-reference-master-vertical-v1',
		).specification);
		// One denominator covers both deliveries only because they are the same
		// length of media; a companion that drifted would be measured against
		// the wrong one without anything saying so.
		assert.throws(() => createM6ReferenceMasterResult(measurement(), drifted), pattern);
	}
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

test('the collector reports thresholds without making a release claim', () => {
	const result = createM6ReferenceMasterResult(measurement(), CONFIG);
	assert.equal(result.status, 'passed');
	assert.equal('qualificationEvidencePublished' in result, false);
	assert.equal(result.evaluation.passed, true);
	assert.ok(result.metricGatePassed);
	assert.deepEqual(result.observedFingerprint, { osImage: 'observed', cpuModel: 'observed' });
});

test('a render-time threshold miss is an observational warning', () => {
	const slow = createM6ReferenceMasterResult(
		measurement({ audioRenderSeconds: [3_600, 3_700, 3_800, 3_900, 4_000] }),
		CONFIG,
	);
	assert.equal(slow.status, 'passed');
	assert.equal(slow.metricGatePassed, true);
	assert.equal(slow.evaluation.failures.length, 0);
	assert.ok(slow.evaluation.warnings.length > 0);
});

test('a hosted runner is not suitable for timing diagnostics', () => {
	assert.doesNotThrow(() => assertM6ReferenceMasterCollectionHost({}));
	for (const key of ['GITHUB_ACTIONS', 'CI', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI']) {
		assert.throws(
			() => assertM6ReferenceMasterCollectionHost({ [key]: 'true' }),
			/refuses to run on a hosted runner/u,
			key,
		);
	}
	for (const flag of ['--accept', '--qualify', '--publish']) {
		assert.throws(() => parseM6ReferenceMasterCliOptions([flag]), /Unknown M6 collector option/u, flag);
	}
	assert.deepEqual(
		parseM6ReferenceMasterCliOptions(['--measurement', 'record.json', 'out']),
		{ measurementPath: 'record.json', outputDirectory: 'out' },
	);
});

test('the writer refuses unsupported statuses', async () => {
	const result = createM6ReferenceMasterResult(measurement(), CONFIG);
	await assert.rejects(
		() => writeM6ReferenceMasterResult('/nonexistent', { ...result, status: 'accepted' }),
		/unsupported status accepted/u,
	);
});

test('the collector re-checks that the workload still owns its fixtures and metrics', async () => {
	const drifted = JSON.parse(JSON.stringify(CONFIG));
	const workload = drifted.workloads.find(({ id }: { id: string }) => id === M6_REFERENCE_MASTER_WORKLOAD_ID);
	workload.measurementIds.pop();
	assert.throws(
		() => createM6ReferenceMasterResult(measurement(), drifted),
		/use every registered measurement|does not own both frozen fixtures and eleven measurements/u,
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

test('the collected diagnostic lands as a passed file and never overwrites one', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m6-quality-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const collected = await collectM6ReferenceMasterQuality(
		{ measurementPath: 'record.json', outputDirectory: directory },
		{ processEnvironment: {}, config: CONFIG, readMeasurement: () => measurement() },
	);
	assert.equal(
		collected.resultPath,
		join(directory, 'm6-reference-master-delivery.passed.json'),
	);
	const written = JSON.parse(await readFile(collected.resultPath, 'utf8'));
	assert.equal(written.status, 'passed');
	// The run's own observation stays beside the result without turning it into
	// a checked-in representative hardware profile.
	assert.deepEqual(written.observedFingerprint, { osImage: 'observed', cpuModel: 'observed' });

	await assert.rejects(
		() => collectM6ReferenceMasterQuality(
			{ measurementPath: 'record.json', outputDirectory: directory },
			{ processEnvironment: {}, config: CONFIG, readMeasurement: () => measurement() },
		),
		/EEXIST/u,
		'a second run cannot quietly replace the first diagnostic',
	);
});

test('a run that timed only one canvas has not covered the render-speed row', () => {
	// The row is registered against both canvases, and a flat list of five timings
	// could not say which delivery it measured — so timing the 720p master five
	// times satisfied a gate that exists to cover the reframing too.
	assert.throws(
		() => metrics(measurement({ videoRenderSeconds: { '1280x720': [600, 620, 640, 660, 680] } })),
		/timed no video render at 1080x1920/u,
	);
	assert.throws(
		() => metrics(measurement({
			videoRenderSeconds: {
				'1280x720': [600, 620, 640, 660, 680],
				'1080x1920': [700, 720, 740, 760, 780],
				'640x360': [10, 20, 30, 40, 50],
			},
		})),
		/unregistered canvas 640x360/u,
	);
	assert.throws(
		() => metrics(measurement({
			videoRenderSeconds: { '1280x720': [600, 620, 640, 660], '1080x1920': [700, 720, 740, 760, 780] },
		})),
		/videoRenderSeconds\.1280x720 must contain exactly 5 timed runs/u,
	);
	assert.throws(
		() => metrics(measurement({ videoRenderSeconds: [600, 620, 640, 660, 680] })),
		/must map each delivered canvas to its timed runs/u,
	);
});

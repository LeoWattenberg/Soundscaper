import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createPendingM3LongformEditorialResult,
	parseM3LongformEditorialDiagnostic,
} from '../scripts/collect-m3-longform-editorial-quality.mjs';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
)) as unknown;
const packageMetadata = JSON.parse(await readFile(
	new URL('../package.json', import.meta.url),
	'utf8',
)) as { readonly scripts: Readonly<Record<string, string>> };

const expectedFixture = Object.freeze({
	generatorRevision: 1,
	seed: 1_554_098_974,
	durationSeconds: 7_200,
	sampleRate: 48_000,
	videoFrameRate: Object.freeze({ num: 30, den: 1 }),
	audioTrackCount: 24,
	proxyVideoTrackCount: 2,
	editCount: 10_000,
	commandsPerTransaction: 250,
	operationCounts: Object.freeze({
		audioClipMoves: 2_500,
		proxyVideoClipMoves: 2_500,
		selectionChanges: 2_500,
		trackMixChanges: 2_500,
	}),
	projectSha256: '00f5ec5df0210f2fb025c8435bc6368f370eed5f51418e02862dd50d66c25a5a',
	editPlanSha256: '2167cb31e4ff5454c6443c40904aadc12ae9cb2ca7cb22addee906f71a1fcadf',
});

function makeDiagnostic() {
	const checkpoints = [0, 2_880_000, 86_400_000, 172_800_000, 345_552_000];
	return {
		schemaVersion: 1,
		profile: 'deterministic-two-hour-editorial-v1',
		observationClass: 'timeline-coordinate-diagnostic-no-decoded-media',
		workloadId: 'm3-longform-editorial',
		fixtureId: 'm3-longform-editorial-2h-v1',
		environmentId: 'reference-linux-gpu-01',
		rendererClass: 'hardware',
		environmentFingerprint: {
			browserVersion: 'Chromium 149.0.7827.55',
			gpuModel: 'diagnostic-gpu',
			logicalCpuCount: 8,
		},
		fixture: expectedFixture,
		positionChecks: [
			...Array.from({ length: 24 }, (_, index) => ({
				clipId: `audio-${index}`,
				kind: 'audio',
				audioPositionErrorSamples: 0,
				videoPositionErrorFrames: 0,
			})),
			...Array.from({ length: 2 }, (_, index) => ({
				clipId: `video-${index}`,
				kind: 'video',
				audioPositionErrorSamples: 0,
				videoPositionErrorFrames: 0,
			})),
		],
		seekWarmupTrialCount: 1,
		seekTrials: checkpoints.map((checkpointSample, index) => ({
			checkpointSample,
			observedAudioSample: checkpointSample,
			observedVideoFrame: checkpointSample / 1_600,
			elapsedMs: [100, 20, 30, 40, 50][index],
		})),
		scrollFrameIntervalsMs: Array.from({ length: 240 }, (_, index) => 10 + index % 10),
		retainedHeap: {
			beforeBytes: 1_000,
			afterBytes: 2_234,
			forcedCollectionsBefore: 3,
			forcedCollectionsAfter: 3,
		},
	};
}

function reporterOutput(value: unknown): string {
	return `✔ local diagnostic\nℹ ${JSON.stringify(value)}\nℹ tests 1\n`;
}

test('the long-form collector recomputes every metric with the frozen sampling policy', () => {
	const result = createPendingM3LongformEditorialResult(makeDiagnostic(), config);

	assert.equal(result.status, 'pending-external');
	assert.equal(result.qualificationEvidencePublished, false);
	assert.deepEqual(result.metrics, {
		'editorial.audioPositionErrorSamples': 0,
		'editorial.videoPositionErrorFrames': 0,
		'editorial.avDriftMaximumMs': 0,
		'editorial.seekP95Ms': 100,
		'editorial.scrollFrameIntervalP95Ms': 19,
		'editorial.retainedHeapDeltaBytes': 1_234,
	});
	assert.deepEqual(result.rawSampleCounts, {
		positionChecks: 26,
		seekWarmupTrials: 1,
		seekTrials: 5,
		scrollFrameIntervals: 240,
		forcedCollectionsBefore: 3,
		forcedCollectionsAfter: 3,
	});
	assert.equal(result.evaluation.passed, false);
	assert.match(result.evaluation.failures.join('\n'), /unprovisioned/iu);
	assert.match(result.evaluation.failures.join('\n'), /not qualification-eligible/iu);
	assert.equal(Object.hasOwn(result, 'rawEvidence'), false);
	assert.equal(Object.hasOwn(result, 'budgetSha256'), false);
});

test('the diagnostic parser admits exactly one matching structured record', () => {
	const diagnostic = makeDiagnostic();
	assert.deepEqual(parseM3LongformEditorialDiagnostic(reporterOutput(diagnostic)), diagnostic);
	assert.throws(() => parseM3LongformEditorialDiagnostic('ℹ tests 1\n'), /exactly one/iu);
	assert.throws(
		() => parseM3LongformEditorialDiagnostic(
			`${reporterOutput(diagnostic)}${reporterOutput(diagnostic)}`,
		),
		/exactly one/iu,
	);
	assert.throws(
		() => parseM3LongformEditorialDiagnostic(reporterOutput({
			...diagnostic,
			fixtureId: 'wrong-fixture',
		})),
		/exactly one/iu,
	);
});

test('fixture drift and malformed raw observations fail before a result can exist', () => {
	const diagnostic = makeDiagnostic();
	assert.throws(
		() => createPendingM3LongformEditorialResult({
			...diagnostic,
			fixture: { ...diagnostic.fixture, editCount: 9_999 },
		}, config),
		/fixture specification/iu,
	);
	assert.throws(
		() => createPendingM3LongformEditorialResult({
			...diagnostic,
			seekTrials: diagnostic.seekTrials.slice(0, 4),
		}, config),
		/exactly 5 seek trials/iu,
	);
	assert.throws(
		() => createPendingM3LongformEditorialResult({
			...diagnostic,
			scrollFrameIntervalsMs: [Number.NaN, ...diagnostic.scrollFrameIntervalsMs.slice(1)],
		}, config),
		/finite/iu,
	);
	assert.throws(
		() => createPendingM3LongformEditorialResult({
			...diagnostic,
			positionChecks: [...diagnostic.positionChecks, diagnostic.positionChecks[0]],
		}, config),
		/exactly 26 position checks/iu,
	);
});

test('the pending collector rejects accepted publication even after a hypothetical activation', () => {
	const activated = structuredClone(config) as {
		environments: Array<{ id: string; status: string; qualificationEligible: boolean }>;
	};
	const environment = activated.environments.find(({ id }) => id === 'reference-linux-gpu-01');
	assert.ok(environment);
	environment.status = 'active';
	environment.qualificationEligible = true;

	assert.throws(
		() => createPendingM3LongformEditorialResult(makeDiagnostic(), activated),
		/Pending collector cannot publish accepted qualification evidence/iu,
	);
});

test('the registered runnable harness preserves every external qualification blocker', () => {
	const quality = config as {
		qualification: { qualifiedWorkloadIds: string[] };
		fixtures: Array<{ id: string; status: string; kind: string; specification: Record<string, unknown> }>;
		workloads: Array<{ id: string; status: string }>;
		environments: Array<{
			id: string;
			status: string;
			qualificationEligible: boolean;
			fingerprint: Record<string, unknown>;
		}>;
	};
	const fixture = quality.fixtures.find(({ id }) => id === 'm3-longform-editorial-2h-v1');
	const workload = quality.workloads.find(({ id }) => id === 'm3-longform-editorial');
	const environment = quality.environments.find(({ id }) => id === 'reference-linux-gpu-01');

	assert.equal(fixture?.status, 'provisional');
	assert.equal(fixture?.kind, 'deterministic-current-schema-project-generator');
	assert.equal(fixture?.specification.localDiagnosticCommand, 'npm run quality:collect:m3-longform');
	assert.equal(fixture?.specification.qualificationPublication, 'forbidden-by-pending-collector');
	assert.equal(packageMetadata.scripts['quality:collect:m3-longform'],
		'node scripts/collect-m3-longform-editorial-quality.mjs');
	assert.equal(workload?.status, 'planned');
	assert.equal(environment?.status, 'unprovisioned');
	assert.equal(environment?.qualificationEligible, false);
	assert.ok(Object.values(environment?.fingerprint ?? {}).every((value) => value === null));
	assert.equal(quality.qualification.qualifiedWorkloadIds.includes('m3-longform-editorial'), false);
});

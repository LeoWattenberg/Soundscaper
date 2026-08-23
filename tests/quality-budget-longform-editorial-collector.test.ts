import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createPendingM3LongformEditorialResult,
	parseM3LongformEditorialDiagnostic,
	writeM3LongformEditorialResult,
} from '../scripts/collect-m3-longform-editorial-quality.mjs';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
)) as unknown;
const packageMetadata = JSON.parse(await readFile(
	new URL('../package.json', import.meta.url),
	'utf8',
)) as { readonly scripts: Readonly<Record<string, string>> };
const QUALIFICATION_ENVIRONMENT_ID = 'owner-qualified-windows-x64-rtx3090-01';
const FINGERPRINT = Object.freeze({
	browserVersion: '150.0.7871.114',
	platform: 'win32',
	architecture: 'x64',
	webglVendor: 'Google Inc. (NVIDIA)',
	webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)',
});

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
	projectSha256: '4c96e2405d63ff282a28a6577c9da32d3598183e5ad59131cb3ca1977df34427',
	editPlanSha256: '2167cb31e4ff5454c6443c40904aadc12ae9cb2ca7cb22addee906f71a1fcadf',
});

function makeDiagnostic() {
	const checkpoints = [0, 2_880_000, 86_400_000, 172_800_000, 345_552_000];
	return {
		schemaVersion: 1,
		profile: 'deterministic-two-hour-editorial-v1',
		observationClass: 'decoded-media-av-scheduling-v1',
		workloadId: 'm3-longform-editorial',
		fixtureId: 'm3-longform-editorial-2h-v1',
		environmentId: 'packaged-runtime-win32-x64',
		rendererClass: 'hardware',
		environmentFingerprint: FINGERPRINT,
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
		decodedAvSamples: ['av-landscape-webm-v1', 'av-portrait-webm-v1'].flatMap(
			(fixtureId, fixtureIndex) => Array.from({ length: 12 }, (_, index) => {
				const videoMediaTimeSeconds = index / 15;
				const driftMs = fixtureIndex + index / 100;
				return {
					fixtureId,
					videoMediaTimeSeconds,
					audioMediaTimeSeconds: videoMediaTimeSeconds + driftMs / 1_000,
					driftMs,
				};
			}),
		),
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
		'editorial.avDriftMaximumMs': 1.11,
		'editorial.seekP95Ms': 100,
		'editorial.scrollFrameIntervalP95Ms': 19,
		'editorial.retainedHeapDeltaBytes': 1_234,
	});
	assert.deepEqual(result.rawSampleCounts, {
		positionChecks: 26,
		decodedAvSamples: 24,
		seekWarmupTrials: 1,
		seekTrials: 5,
		scrollFrameIntervals: 240,
		forcedCollectionsBefore: 3,
		forcedCollectionsAfter: 3,
	});
	assert.equal(result.evaluation.passed, false);
	assert.equal(result.metricGatePassed, true);
	assert.match(result.evaluation.failures.join('\n'), /environment mismatch/iu);
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

test('an explicitly owner-labeled exact diagnostic still requires packaged nightly verification', async () => {
	const activated = structuredClone(config) as {
		environments: Array<{
			id: string;
			status: string;
			qualificationEligible: boolean;
			fingerprint: Record<string, unknown>;
		}>;
	};
	const environment = activated.environments.find(({ id }) => id === QUALIFICATION_ENVIRONMENT_ID);
	assert.ok(environment);
	const diagnostic = { ...makeDiagnostic(), environmentId: QUALIFICATION_ENVIRONMENT_ID };
	environment.fingerprint = structuredClone(diagnostic.environmentFingerprint);
	const result = createPendingM3LongformEditorialResult(diagnostic, activated);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.qualificationEvidencePublished, false);
	assert.equal(result.metricGatePassed, true);
	assert.equal(result.evaluation.passed, false);
	assert.match(result.evaluation.failures.join('\n'), /packaged-runtime verifier/iu);

	let pendingWrites = 0;
	const written = await writeM3LongformEditorialResult(
		'/tmp/unused', diagnostic, result, activated,
		{
			writePending: async (_directory: string, pending: typeof result) => {
				pendingWrites += 1;
				return { resultPath: '/tmp/pending.json', result: pending };
			},
		},
	);
	assert.equal(pendingWrites, 1);
	assert.equal(written.result.status, 'pending-external');
});

test('the registered runnable harness delegates formal acceptance to packaged nightly verification', () => {
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
	const environment = quality.environments.find(({ id }) => id === QUALIFICATION_ENVIRONMENT_ID);
	const profile = (quality as typeof quality & {
		packagedRuntimeQualification: { profiles: Array<{ workloadId: string; environmentId: string }> };
	}).packagedRuntimeQualification.profiles.find(({ workloadId }) => workloadId === 'm3-longform-editorial');

	assert.equal(fixture?.status, 'provisional');
	assert.equal(fixture?.kind, 'deterministic-current-schema-project-generator');
	assert.equal(fixture?.specification.localDiagnosticCommand, 'npm run quality:collect:m3-longform');
	assert.equal(fixture?.specification.qualificationPublication,
		'accepted-only-after-qualified-environment-and-digest-bound-verification');
	assert.equal(packageMetadata.scripts['quality:collect:m3-longform'],
		'node scripts/collect-m3-longform-editorial-quality.mjs');
	assert.equal(workload?.status, 'provisional');
	assert.equal(environment?.status, 'unprovisioned');
	assert.equal(environment?.qualificationEligible, false);
	assert.equal(profile?.environmentId, QUALIFICATION_ENVIRONMENT_ID);
	assert.equal(quality.qualification.qualifiedWorkloadIds.includes('m3-longform-editorial'), false);
});

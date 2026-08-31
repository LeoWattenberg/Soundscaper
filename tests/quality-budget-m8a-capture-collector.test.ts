/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	M8A_CAPTURE_COMBINATIONS,
	M8A_CAPTURE_FINGERPRINT_FIELDS,
	M8A_CAPTURE_METRIC_IDS,
	computeM8ACaptureMetrics,
	validateM8ACaptureMeasurement,
} from '../scripts/lib/m8a-capture-quality-metrics.mjs';
import {
	assertM8ACaptureCollectionHost,
	collectM8ACaptureQuality,
	createM8ACaptureResult,
	parseM8ACaptureCliOptions,
	writeM8ACaptureResult,
} from '../scripts/collect-m8a-capture-quality.mjs';
import { workloadThresholds } from '../scripts/lib/quality-budget-config.mjs';

type CaptureRole = 'camera' | 'microphone' | 'display' | 'system-audio';
type CombinationDefinition = Readonly<{
	readonly id: string;
	readonly requestedRoles: readonly CaptureRole[];
}>;
type Descriptor = {
	readonly id: string;
	readonly behavior?: string;
	readonly kind?: string;
	readonly specification?: Record<string, number>;
	readonly measurementIds?: readonly string[];
};
type Config = {
	readonly fixtures: readonly Descriptor[];
	readonly workloads: readonly Descriptor[];
};
const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
)) as Config;
const fixture = config.fixtures.find(({ id }) => id === 'm8a-capture-30m-all-sources-v1')!;
const workload = config.workloads.find(({ id }) => id === 'm8a-capture-long-session')!;
const expectation = Object.freeze({ fixtureSpecification: fixture.specification! });

function fingerprint(): Record<string, unknown> {
	return {
		camera: { model: 'Lab Camera', driverVersion: '1.2.3' },
		microphone: { model: 'Lab Microphone', driverVersion: '4.5.6', sampleRate: 48_000 },
		displayCapture: {
			browser: 'Chromium 149.0.7827.55', os: 'Lab OS 1', surface: 'monitor',
			width: 1920, height: 1080, frameRate: 30,
		},
		systemAudio: { availability: 'unavailable', provider: 'none' },
	};
}

function syncSamples(durationSeconds: number, driftUs = 19_500): Record<string, number>[] {
	return Array.from({ length: durationSeconds + 1 }, (_, elapsedSecond) => ({
		elapsedSecond,
		audioPtsUs: elapsedSecond * 1_000_000,
		videoPtsUs: elapsedSecond * 1_000_000 + (elapsedSecond === durationSeconds ? driftUs : 0),
	}));
}

function makeCombination(
	definition: CombinationDefinition,
	index: number,
): Record<string, unknown> {
	const durationSeconds = 1_800;
	const videoRoles = definition.requestedRoles.filter(
		(role): role is 'camera' | 'display' => role === 'camera' || role === 'display',
	);
	const audioRoles = definition.requestedRoles.filter(
		(role): role is 'microphone' => role === 'microphone',
	);
	const streams = definition.requestedRoles.map((role) => {
		if (role === 'camera' || role === 'display') {
			return {
				role, kind: 'video', nominalFrameRate: 30,
				expectedFrames: durationSeconds * 30,
				receivedFrames: durationSeconds * 30 - 1,
				reportedDroppedFrames: 1,
			};
		}
		return {
			role, kind: 'audio', sampleRate: 48_000,
			expectedFrames: durationSeconds * 48_000,
			receivedFrames: durationSeconds * 48_000,
		};
	});
	const syncPairs = videoRoles.flatMap((videoRole) => audioRoles.map((audioRole) => ({
		audioRole, videoRole, samples: syncSamples(durationSeconds),
	})));
	return {
		combinationId: definition.id,
		requestedRoles: [...definition.requestedRoles],
		returnedRoles: [...definition.requestedRoles],
		observedDurationSeconds: durationSeconds,
		completed: true,
		attemptCount: 1,
		retried: false,
		streams,
		syncPairs,
		teardownSamplesMs: [100 + index * 10],
		durableFragments: definition.requestedRoles.map((role) => ({
			fragmentId: `${definition.id}-${role}-fragment`, role, recoverable: true,
		})),
		deviceOpens: definition.requestedRoles.map((role) => ({
			role, opened: true, directUserAuthorization: true,
		})),
	};
}

function makeMeasurement(): Record<string, unknown> {
	return {
		schemaVersion: 1,
		profile: 'framescaper-capture-30m-six-combination-v1',
		observationClass: 'real-device-shared-clock-durability-v1',
		workloadId: 'm8a-capture-long-session',
		fixtureId: 'm8a-capture-30m-all-sources-v1',
		environmentId: 'capture-device-diagnostics',
		fingerprint: fingerprint(),
		combinations: M8A_CAPTURE_COMBINATIONS.map(makeCombination),
	};
}

test('the collector owns the exact six combinations and eight registered metrics', () => {
	assert.equal(fixture.kind, 'observed-capture-session');
	assert.equal(workload.behavior, 'blocking');
	assert.deepEqual(M8A_CAPTURE_COMBINATIONS, [
		{ id: 'camera-only', requestedRoles: ['camera'] },
		{ id: 'microphone-only', requestedRoles: ['microphone'] },
		{ id: 'display-only', requestedRoles: ['display'] },
		{ id: 'camera-plus-microphone', requestedRoles: ['camera', 'microphone'] },
		{ id: 'display-plus-microphone', requestedRoles: ['display', 'microphone'] },
		{ id: 'camera-plus-display-plus-microphone', requestedRoles: ['camera', 'display', 'microphone'] },
	]);
	assert.deepEqual(
		workloadThresholds(config, workload.id).map(({ metricId }: { metricId: string }) => metricId),
		[...M8A_CAPTURE_METRIC_IDS],
	);
});

test('a complete 30-minute run recomputes all diagnostic metrics', () => {
	const computed = computeM8ACaptureMetrics(makeMeasurement(), expectation);
	assert.deepEqual(computed.metrics, {
		'capture.sourceCombinationsCompleted': 6,
		'capture.avDriftMaximumMs': 19.5,
		'capture.droppedFrameRatio': 6 / 324_000,
		'capture.unreportedDroppedFrames': 0,
		'capture.audioDropoutFrames': 0,
		'capture.deviceTeardownP95Ms': 150,
		'capture.unrecoverableDurableFragments': 0,
		'capture.unauthorizedDeviceOpens': 0,
	});
	assert.deepEqual(computed.rawSampleCounts, {
		combinations: 6,
		captureSeconds: 10_800,
		videoFramesExpected: 324_000,
		videoFramesReceived: 323_994,
		audioFramesExpected: 345_600_000,
		audioFramesReceived: 345_600_000,
		syncSamples: 7_204,
		teardownSamples: 6,
		durableFragments: 10,
		deviceOpens: 10,
	});

	const result = createM8ACaptureResult(makeMeasurement(), config);
	assert.equal(result.metricGatePassed, true);
	assert.equal(result.status, 'passed');
	assert.equal('qualificationEvidencePublished' in result, false);
	assert.equal(result.evaluation.passed, true);
	assert.ok(result.evaluation.verdicts.every(({ passed }: { passed: boolean }) => passed));
	assert.deepEqual(result.observedFingerprint, fingerprint());
});

test('every registered threshold is derived from raw failure evidence', () => {
	const measurement = makeMeasurement() as {
		combinations: Array<{
			completed: boolean;
			observedDurationSeconds: number;
			streams: Array<{
				kind: string; expectedFrames: number; receivedFrames: number;
				reportedDroppedFrames?: number;
			}>;
			syncPairs: Array<{ samples: Array<{ videoPtsUs: number }> }>;
			teardownSamplesMs: number[];
			durableFragments: Array<{ recoverable: boolean }>;
			deviceOpens: Array<{ directUserAuthorization: boolean }>;
		}>;
	};
	const first = measurement.combinations[0]!;
	first.completed = false;
	first.observedDurationSeconds = 1_799;
	first.streams[0]!.expectedFrames = 1_799 * 30;
	first.streams[0]!.receivedFrames = 1_799 * 30 - 400;
	first.streams[0]!.reportedDroppedFrames = 399;
	first.teardownSamplesMs[0] = 1_001;
	first.durableFragments[0]!.recoverable = false;
	first.deviceOpens[0]!.directUserAuthorization = false;
	const av = measurement.combinations[3]!;
	av.syncPairs[0]!.samples.at(-1)!.videoPtsUs += 501;
	const microphone = measurement.combinations[1]!.streams[0]!;
	microphone.receivedFrames -= 1;

	const result = createM8ACaptureResult(measurement, config);
	assert.equal(result.metricGatePassed, false);
	assert.equal(result.status, 'failed');
	assert.equal(result.metrics['capture.sourceCombinationsCompleted'], 5);
	assert.ok(result.metrics['capture.avDriftMaximumMs'] > 20);
	assert.ok(result.metrics['capture.droppedFrameRatio'] > 0.001);
	assert.equal(result.metrics['capture.unreportedDroppedFrames'], 1);
	assert.equal(result.metrics['capture.audioDropoutFrames'], 1);
	assert.equal(result.metrics['capture.deviceTeardownP95Ms'], 1_001);
	assert.equal(result.metrics['capture.unrecoverableDurableFragments'], 1);
	assert.equal(result.metrics['capture.unauthorizedDeviceOpens'], 1);
	assert.equal(result.evaluation.verdicts.filter(({ passed }: { passed: boolean }) => !passed).length, 8);
});

test('the six rows, 30-minute duration, roles, shared-clock pairs, and drop ledgers are closed', () => {
	const missing = makeMeasurement() as { combinations: unknown[] };
	missing.combinations.pop();
	assert.throws(
		() => validateM8ACaptureMeasurement(missing, expectation),
		/must contain exactly 6 source combinations/u,
	);

	const relabelled = makeMeasurement() as { combinations: Array<{ combinationId: string }> };
	relabelled.combinations[0]!.combinationId = 'display-only';
	assert.throws(
		() => validateM8ACaptureMeasurement(relabelled, expectation),
		/does not match the frozen source combination/u,
	);

	const short = makeMeasurement() as {
		combinations: Array<{ observedDurationSeconds: number; streams: Array<{ expectedFrames: number }> }>;
	};
	short.combinations[2]!.observedDurationSeconds = 1_801;
	assert.throws(
		() => validateM8ACaptureMeasurement(short, expectation),
		/observedDurationSeconds must be between 0 and 1800/u,
	);

	const missingSync = makeMeasurement() as { combinations: Array<{ syncPairs: unknown[] }> };
	missingSync.combinations[3]!.syncPairs = [];
	assert.throws(
		() => validateM8ACaptureMeasurement(missingSync, expectation),
		/must contain the exact audio\/video pair inventory/u,
	);

	const hiddenDrop = makeMeasurement() as {
		combinations: Array<{ streams: Array<{ reportedDroppedFrames?: number }> }>;
	};
	hiddenDrop.combinations[0]!.streams[0]!.reportedDroppedFrames = 2;
	assert.throws(
		() => validateM8ACaptureMeasurement(hiddenDrop, expectation),
		/cannot report more dropped frames than were absent/u,
	);
});

test('optional system audio is admitted only as a display-returned separate stream', () => {
	const measurement = makeMeasurement() as {
		combinations: Array<{
			returnedRoles: string[];
			streams: Array<Record<string, unknown>>;
			syncPairs: Array<Record<string, unknown>>;
			durableFragments: Array<Record<string, unknown>>;
		}>;
	};
	const display = measurement.combinations[2]!;
	display.returnedRoles.push('system-audio');
	display.streams.push({
		role: 'system-audio', kind: 'audio', sampleRate: 48_000,
		expectedFrames: 86_400_000, receivedFrames: 86_400_000,
	});
	display.syncPairs.push({
		audioRole: 'system-audio', videoRole: 'display', samples: syncSamples(1_800),
	});
	display.durableFragments.push({
		fragmentId: 'display-only-system-audio-fragment', role: 'system-audio', recoverable: true,
	});
	assert.doesNotThrow(() => validateM8ACaptureMeasurement(measurement, expectation));

	const camera = structuredClone(measurement) as typeof measurement;
	camera.combinations[0]!.returnedRoles.push('system-audio');
	assert.throws(
		() => validateM8ACaptureMeasurement(camera, expectation),
		/system-audio requires display/u,
	);
});

test('fingerprints are exact per-run observations and no fixed device matrix exists', () => {
	assert.deepEqual(M8A_CAPTURE_FINGERPRINT_FIELDS, [
		'camera', 'microphone', 'displayCapture', 'systemAudio',
	]);
	for (const field of M8A_CAPTURE_FINGERPRINT_FIELDS) {
		const measurement = makeMeasurement() as { fingerprint: Record<string, unknown> };
		delete measurement.fingerprint[field];
		assert.throws(
			() => validateM8ACaptureMeasurement(measurement, expectation),
			/fingerprint must contain the exact fields/u,
		);
	}

	assert.equal(Object.hasOwn(config, 'environments'), false);
});

test('hosted runners and unsupported result states are refused', async () => {
	assert.throws(
		() => assertM8ACaptureCollectionHost({ GITHUB_ACTIONS: 'true' }),
		/hosted runners have no real capture devices/u,
	);
	assert.doesNotThrow(() => assertM8ACaptureCollectionHost({ CI: '' }));
	assert.throws(
		() => parseM8ACaptureCliOptions(['--qualify']),
		/Unknown M8A collector option/u,
	);
	await assert.rejects(
		writeM8ACaptureResult('/unused', {
			...createM8ACaptureResult(makeMeasurement(), config), status: 'accepted',
		}),
		/unsupported status accepted/u,
	);
});

test('the collector reads one device record and writes one diagnostic result', async () => {
	let written: unknown = null;
	const collected = await collectM8ACaptureQuality(
		{ measurementPath: '/lab/capture.json', outputDirectory: '/unused' },
		{
			config,
			processEnvironment: {},
			readMeasurement: (path: string) => {
				assert.equal(path, '/lab/capture.json');
				return Promise.resolve(makeMeasurement());
			},
			writeResult: (directory: string, result: unknown) => {
				written = { directory, result };
				return Promise.resolve(written);
			},
		},
	);
	assert.equal(collected, written);
	assert.equal((written as { directory: string }).directory, '/unused');
	assert.equal((written as { result: { status: string } }).result.status, 'passed');
});

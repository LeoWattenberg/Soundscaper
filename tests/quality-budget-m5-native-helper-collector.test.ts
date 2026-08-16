/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	M5_NATIVE_HELPER_FINGERPRINT_FIELDS,
	M5_NATIVE_HELPER_METRIC_IDS,
	computeM5NativeHelperMetrics,
	validateM5NativeHelperMeasurement,
} from '../scripts/lib/m5-native-helper-metrics.mjs';
import {
	assertM5NativeHelperCollectionHost,
	assessM5NativeHelperQualification,
	collectM5NativeHelperQuality,
	createM5NativeHelperResult,
	parseM5NativeHelperCliOptions,
	writeM5NativeHelperResult,
} from '../scripts/collect-m5-native-helper-quality.mjs';

type Threshold = { readonly metricId: string; readonly comparison: string; readonly value: number };
type Descriptor = {
	readonly id: string;
	readonly status?: string;
	readonly specification?: Record<string, number>;
	readonly thresholds?: readonly Threshold[];
	readonly fingerprint?: Record<string, unknown>;
};
type Config = {
	readonly measurementPolicy: Record<string, unknown>;
	readonly environments: readonly Descriptor[];
	readonly fixtures: readonly Descriptor[];
	readonly workloads: readonly Descriptor[];
};
/** A JSON clone the provisioning test may edit; the checked-in config stays read-only. */
type MutableConfig = {
	qualification: { qualifiedWorkloadIds: string[] };
	environments: Array<Record<string, unknown> & { id: string }>;
	workloads: Array<Record<string, unknown> & { id: string }>;
};

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
)) as Config;
const workload = config.workloads.find(({ id }) => id === 'm5-native-helper-and-audio')!;
const fixture = config.fixtures.find(({ id }) => id === 'm5-helper-fault-and-loopback-v1')!;
const expectation = Object.freeze({
	fixtureSpecification: fixture.specification!,
	measurementPolicy: config.measurementPolicy,
});
const DIGEST = 'a'.repeat(64);

function makeFingerprint(): Record<string, unknown> {
	return {
		osImage: 'Windows 11 26100.1742',
		osVersion: '10.0.26100',
		cpuModel: 'AMD Ryzen 9 7950X',
		logicalCpuCount: 32,
		memoryBytes: 68_719_476_736,
		audioInterfaceModel: 'RME Fireface UCX II',
		audioDriverVersion: '1.226',
		audioBackend: 'asio',
		audioBufferFrames: 128,
		audioSampleRate: 48_000,
		electronVersion: '40.2.1',
		helperBinarySha256: DIGEST,
		nativeAddonSha256: 'b'.repeat(64),
		packageIdentity: 'Soundscaper-5.0.0-win-x64',
		packageSha256: 'c'.repeat(64),
	};
}

function makeRun(index: number, label: string): Record<string, unknown> {
	return {
		runIndex: index,
		helperProcessId: `${label}-helper-${index}`,
		freshHelper: true,
		retried: false,
		attemptCount: 1,
		malformedCasesPresented: fixture.specification!.malformedCaseCount,
		malformedCasesRejected: fixture.specification!.malformedCaseCount,
		loopbackDurationSeconds: fixture.specification!.loopbackDurationSeconds,
		capabilityGrants: [
			{ capabilityId: 'audio.device.open', authorized: true },
			{ capabilityId: 'plugin.scan.root', authorized: true },
		],
		publishedRevisions: [
			{ revisionId: `revision-${index}`, observedSha256: DIGEST, expectedSha256: DIGEST },
		],
		// Every sample is offset by the run index so the nearest-rank p95 (rank 19
		// of 20) lands one value below the maximum. A collector that reported the
		// maximum, the mean, or the last sample would fail these assertions.
		cancellationSamplesMs: [110 + index, 220 + index, 330 + index, 440 + index],
		crashDetectionSamplesMs: [610 + index, 720 + index, 830 + index, 940 + index],
		editorRecoverySamplesMs: [1_400 + index, 1_500 + index, 1_600 + index, 1_800 + index],
		helperPeakRssBytes: 402_653_184 + index,
		audioRoundTripSamplesMs: [
			6.5 + index * 0.25, 7.25 + index * 0.25, 8 + index * 0.25, 9.5 + index * 0.25,
		],
		audioUnderrunFrames: 0,
	};
}

function makeMeasurement(): Record<string, unknown> {
	return {
		schemaVersion: 1,
		profile: 'native-helper-fault-and-loopback-v1',
		observationClass: 'fresh-helper-fault-and-device-loopback-v1',
		workloadId: 'm5-native-helper-and-audio',
		fixtureId: 'm5-helper-fault-and-loopback-v1',
		environmentId: 'native-os-lab-matrix',
		platformId: 'windowsX64',
		fingerprint: makeFingerprint(),
		warmupRuns: [makeRun(0, 'warmup')],
		runs: Array.from({ length: 5 }, (_, index) => makeRun(index, 'timed')),
	};
}

test('the eight computed metric ids are exactly the registered thresholds', () => {
	assert.deepEqual(
		workload.thresholds!.map(({ metricId }) => metricId),
		[...M5_NATIVE_HELPER_METRIC_IDS],
	);
	const computed = computeM5NativeHelperMetrics(makeMeasurement(), expectation);
	assert.deepEqual(Object.keys(computed.metrics).sort(), [...M5_NATIVE_HELPER_METRIC_IDS].sort());
});

test('a complete record is recomputed and evaluated against the checked-in thresholds', () => {
	const result = createM5NativeHelperResult(makeMeasurement(), config);
	assert.deepEqual(result.metrics, {
		'native.unauthorizedCapabilityGrants': 0,
		'native.corruptPublishedRevisions': 0,
		// 443 is the 19th of 20 cancellation samples; the maximum is 444.
		'native.cancellationP95Ms': 443,
		'native.crashDetectionMaximumMs': 944,
		'native.editorRecoveryMaximumMs': 1_804,
		'native.helperPeakRssBytes': 402_653_188,
		// 10.25 is the 19th of 20 round-trip samples; the maximum is 10.5.
		'native.audioRoundTripLatencyP95Ms': 10.25,
		'native.audioUnderrunFrames': 0,
	});
	assert.equal(result.metricGatePassed, true);
	assert.equal(result.evaluation.verdicts.length, workload.thresholds!.length);
	assert.ok(result.evaluation.verdicts.every(({ passed }: { passed: boolean }) => passed));
	assert.equal(result.rawSampleCounts.warmupRuns, 1);
	assert.equal(result.rawSampleCounts.timedRuns, 5);
	assert.equal(result.rawSampleCounts.cancellationSamples, 20);
	// Six helpers ran, so both integrity ledgers cover six runs, not five.
	assert.equal(result.rawSampleCounts.capabilityGrants, 12);
	assert.equal(result.rawSampleCounts.publishedRevisions, 6);
	assert.equal(result.rawSampleCounts.malformedCasesPerRun, 10_000);
	assert.equal(result.rawSampleCounts.loopbackSecondsPerRun, 1_800);
});

test('a breached threshold fails the metric gate instead of degrading to pending', () => {
	// Each breach is spread over two runs so a summed count cannot be mistaken
	// for a per-run maximum or for a single boolean "something went wrong".
	const measurement = makeMeasurement() as {
		runs: Array<{
			audioUnderrunFrames: number;
			capabilityGrants: Array<{ authorized: boolean }>;
			publishedRevisions: Array<{ observedSha256: string }>;
		}>;
	};
	measurement.runs[2]!.audioUnderrunFrames = 3;
	measurement.runs[4]!.audioUnderrunFrames = 4;
	measurement.runs[1]!.capabilityGrants[0]!.authorized = false;
	measurement.runs[4]!.capabilityGrants[1]!.authorized = false;
	measurement.runs[0]!.publishedRevisions[0]!.observedSha256 = 'd'.repeat(64);
	measurement.runs[3]!.publishedRevisions[0]!.observedSha256 = 'e'.repeat(64);
	const result = createM5NativeHelperResult(measurement, config);
	assert.equal(result.metrics['native.audioUnderrunFrames'], 7);
	assert.equal(result.metrics['native.unauthorizedCapabilityGrants'], 2);
	assert.equal(result.metrics['native.corruptPublishedRevisions'], 2);
	assert.equal(result.metricGatePassed, false);
	assert.equal(result.status, 'failed');
	assert.match(
		result.evaluation.failures.join('\n'),
		/native\.audioUnderrunFrames was 7 frames/u,
	);
	assert.match(
		result.evaluation.failures.join('\n'),
		/native\.corruptPublishedRevisions was 2 count/u,
	);
});

test('the discarded warm-up still contributes its authorization and publication ledgers', () => {
	const measurement = makeMeasurement() as {
		warmupRuns: Array<{
			audioUnderrunFrames: number;
			capabilityGrants: Array<{ authorized: boolean }>;
			publishedRevisions: Array<{ observedSha256: string }>;
			cancellationSamplesMs: number[];
		}>;
	};
	measurement.warmupRuns[0]!.capabilityGrants[0]!.authorized = false;
	measurement.warmupRuns[0]!.publishedRevisions[0]!.observedSha256 = 'd'.repeat(64);
	// A cold first run is slow and leaks frames; those numbers stay discarded.
	measurement.warmupRuns[0]!.audioUnderrunFrames = 9_999;
	measurement.warmupRuns[0]!.cancellationSamplesMs = [90_000];
	const result = createM5NativeHelperResult(measurement, config);
	assert.equal(result.metrics['native.unauthorizedCapabilityGrants'], 1);
	assert.equal(result.metrics['native.corruptPublishedRevisions'], 1);
	assert.equal(result.metrics['native.audioUnderrunFrames'], 0);
	assert.equal(result.metrics['native.cancellationP95Ms'], 443);
	assert.equal(result.metricGatePassed, false);
	assert.equal(result.status, 'failed');
});

test('an unprovisioned lab matrix cannot publish; every missing fact is named', async () => {
	const qualification = assessM5NativeHelperQualification(config);
	assert.equal(qualification.provisioned, false);
	for (const platformId of ['windowsX64', 'windowsArm64', 'macosArm64', 'linuxX64', 'linuxArm64']) {
		assert.ok(
			qualification.blockers.some((blocker: string) =>
				blocker.includes(`no recorded fingerprint for platform ${platformId}`)),
			`${platformId} must be named as a missing fingerprint row`,
		);
	}
	assert.ok(qualification.blockers.some((blocker: string) => /is unprovisioned/u.test(blocker)));
	assert.ok(qualification.blockers.some((blocker: string) => /not qualification-eligible/u.test(blocker)));
	assert.ok(qualification.blockers.some((blocker: string) => /status is planned/u.test(blocker)));

	const result = createM5NativeHelperResult(makeMeasurement(), config);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.evaluation.passed, false);
	assert.equal(result.qualificationEvidencePublished, false);
	assert.deepEqual(result.qualificationBlockers, qualification.blockers);
	// The observed lab fingerprint stays beside the result; the null descriptor
	// rows in config are never filled in from it.
	assert.deepEqual(result.observedFingerprint, makeFingerprint());
	const environment = config.environments.find(({ id }) => id === 'native-os-lab-matrix')!;
	assert.ok(Object.values(environment.fingerprint!).every((row) => row === null));

	await assert.rejects(
		writeM5NativeHelperResult('/unused', { ...result, status: 'accepted' }),
		/cannot write a accepted result/u,
	);
	await assert.rejects(
		writeM5NativeHelperResult('/unused', { ...result, qualificationEvidencePublished: true }),
		/must not mark qualification evidence as published/u,
	);
	assert.throws(
		() => parseM5NativeHelperCliOptions(['--accept']),
		/qualification is unavailable while native-os-lab-matrix is unprovisioned/u,
	);
});

test('a provisioned matrix is refused outright rather than silently downgraded to pending', () => {
	// A pending record with an empty blocker list would read as "measured and
	// awaiting sign-off"; the truth is that no accepted-evidence writer exists.
	const provisioned = JSON.parse(JSON.stringify(config)) as MutableConfig;
	const environment = provisioned.environments.find(({ id }) => id === 'native-os-lab-matrix')!;
	environment.status = 'active';
	environment.qualificationEligible = true;
	environment.eligibleWorkloadIds = ['m5-native-helper-and-audio'];
	environment.fingerprint = Object.fromEntries(
		Object.keys(environment.fingerprint as Record<string, unknown>)
			.map((platformId) => [platformId, makeFingerprint()]),
	);
	provisioned.workloads.find(({ id }) => id === 'm5-native-helper-and-audio')!.status = 'qualified';
	provisioned.qualification.qualifiedWorkloadIds.push('m5-native-helper-and-audio');

	assert.equal(assessM5NativeHelperQualification(provisioned).provisioned, true);
	assert.throws(
		() => createM5NativeHelperResult(makeMeasurement(), provisioned),
		/accepted-evidence writer lands with the lab and must exist before a result is emitted/u,
	);
});

test('a hosted runner may not file device evidence and the collector writes only pending records', async () => {
	assert.throws(
		() => assertM5NativeHelperCollectionHost({ GITHUB_ACTIONS: 'true' }),
		/hosted runners are not audio-device evidence/u,
	);
	assert.doesNotThrow(() => assertM5NativeHelperCollectionHost({ CI: '' }));

	let written: unknown = null;
	const collected = await collectM5NativeHelperQuality(
		{ measurementPath: '/lab/measurement.json', outputDirectory: '/unused' },
		{
			config,
			processEnvironment: {},
			readMeasurement: (path: string) => {
				assert.equal(path, '/lab/measurement.json');
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
	assert.equal((written as { result: { status: string } }).result.status, 'pending-external');
});

test('fewer than five fresh runs and any retried run are rejected outright', () => {
	const short = makeMeasurement() as { runs: unknown[] };
	short.runs.pop();
	assert.throws(
		() => validateM5NativeHelperMeasurement(short, expectation),
		/runs must contain exactly 5 fresh-helper runs/u,
	);

	const extra = makeMeasurement() as { runs: unknown[] };
	extra.runs.push(makeRun(5, 'timed'));
	assert.throws(
		() => validateM5NativeHelperMeasurement(extra, expectation),
		/runs must contain exactly 5 fresh-helper runs/u,
	);

	const noWarmup = makeMeasurement() as { warmupRuns: unknown[] };
	noWarmup.warmupRuns.pop();
	assert.throws(
		() => validateM5NativeHelperMeasurement(noWarmup, expectation),
		/warmupRuns must contain exactly 1 warm-up run/u,
	);

	const retried = makeMeasurement() as { runs: Array<{ retried: boolean; attemptCount: number }> };
	retried.runs[3]!.retried = true;
	retried.runs[3]!.attemptCount = 2;
	assert.throws(
		() => validateM5NativeHelperMeasurement(retried, expectation),
		/forbids retry-to-pass/u,
	);

	const reused = makeMeasurement() as { runs: Array<{ helperProcessId: string }> };
	reused.runs[2]!.helperProcessId = reused.runs[1]!.helperProcessId;
	assert.throws(
		() => validateM5NativeHelperMeasurement(reused, expectation),
		/was reused by another run/u,
	);

	const stale = makeMeasurement() as { runs: Array<{ freshHelper: boolean }> };
	stale.runs[0]!.freshHelper = false;
	assert.throws(
		() => validateM5NativeHelperMeasurement(stale, expectation),
		/needs its own helper/u,
	);
});

test('an incomplete fingerprint is a rejection, never a default', () => {
	for (const field of M5_NATIVE_HELPER_FINGERPRINT_FIELDS) {
		const measurement = makeMeasurement() as { fingerprint: Record<string, unknown> };
		delete measurement.fingerprint[field];
		assert.throws(
			() => validateM5NativeHelperMeasurement(measurement, expectation),
			new RegExp(`missing \\[${field}\\]`, 'u'),
			`${field} must be required`,
		);
	}

	const extra = makeMeasurement() as { fingerprint: Record<string, unknown> };
	extra.fingerprint.intendedInterfaceModel = 'not yet purchased';
	assert.throws(
		() => validateM5NativeHelperMeasurement(extra, expectation),
		/unexpected \[intendedInterfaceModel\]/u,
	);

	const backend = makeMeasurement() as { fingerprint: Record<string, unknown> };
	backend.fingerprint.audioBackend = 'web-audio';
	assert.throws(
		() => validateM5NativeHelperMeasurement(backend, expectation),
		/audioBackend must be one of/u,
	);

	const digest = makeMeasurement() as { fingerprint: Record<string, unknown> };
	digest.fingerprint.nativeAddonSha256 = 'pending';
	assert.throws(
		() => validateM5NativeHelperMeasurement(digest, expectation),
		/nativeAddonSha256 must be one lowercase SHA-256/u,
	);

	// Filing a Windows loopback against the macOS row is the same relabelling the
	// environment rule forbids, one level down.
	const relabelled = makeMeasurement() as {
		platformId: string;
		fingerprint: Record<string, unknown>;
	};
	relabelled.platformId = 'macosArm64';
	assert.throws(
		() => validateM5NativeHelperMeasurement(relabelled, expectation),
		/audioBackend asio is not a backend macosArm64 runs/u,
	);
	relabelled.fingerprint.audioBackend = 'coreaudio';
	assert.doesNotThrow(() => validateM5NativeHelperMeasurement(relabelled, expectation));
});

test('the fixture halves and record identity are bound to the checked-in descriptors', () => {
	const malformed = makeMeasurement() as { runs: Array<{ malformedCasesRejected: number }> };
	malformed.runs[0]!.malformedCasesRejected = 9_999;
	assert.throws(
		() => validateM5NativeHelperMeasurement(malformed, expectation),
		/exactly 10000 malformed cases/u,
	);

	const loopback = makeMeasurement() as { runs: Array<{ loopbackDurationSeconds: number }> };
	loopback.runs[1]!.loopbackDurationSeconds = 60;
	assert.throws(
		() => validateM5NativeHelperMeasurement(loopback, expectation),
		/loopbackDurationSeconds must be 1800/u,
	);

	const platform = makeMeasurement() as { platformId: string };
	platform.platformId = 'linuxRiscv64';
	assert.throws(
		() => validateM5NativeHelperMeasurement(platform, expectation),
		/platformId must be one of/u,
	);

	const identity = makeMeasurement() as { workloadId: string };
	identity.workloadId = 'm4-production-render-parity';
	assert.throws(
		() => validateM5NativeHelperMeasurement(identity, expectation),
		/identity does not match the frozen native workload/u,
	);
});

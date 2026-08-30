/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createPackagedRuntimeQualification,
} from '../scripts/lib/desktop-nightly-tests-qualification.mjs';

const SOURCE_REVISION = 'a'.repeat(40);
const BUDGET_SHA256 = 'b'.repeat(64);
const FINGERPRINT = {
	browserVersion: '150.0.7871.114',
	platform: 'win32',
	architecture: 'x64',
	webglVendor: 'Google Inc. (NVIDIA)',
	webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)',
	gpuDriverVersion: '32.0.15.6094',
	gpuDeviceId: '10de:2204',
	powerMode: 'maximum-performance-ac',
	displayMode: '3840x2160@60Hz-150pct',
};
const GENERIC_FIXTURE = {
	generatorRevision: 1,
	seed: 1_554_098_974,
};
const GENERIC_RAW_SAMPLE_COUNTS = {
	primarySamples: 24,
	verificationPasses: 1,
};
const M1_FINGERPRINT = {
	browserVersion: '150.0.7871.114',
	platform: 'win32',
	architecture: 'x64',
	webglVendor: 'Google Inc. (NVIDIA)',
	webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)',
	gpuDriverVersion: '32.0.15.6094',
	gpuDeviceId: '10de:2204',
	powerMode: 'maximum-performance-ac',
	displayMode: '3840x2160@60Hz-150pct',
};
const M1_SOURCE_SHA256 = 'f1319d3549943c190e5eb3f86b63fd2afb644bd49b32e3f257699b450271bc8c';

test('the owner-designated packaged Windows host formally qualifies a passing M4 diagnostic', () => {
	const { config, raw, summary } = fixture();
	const result = createPackagedRuntimeQualification({ config, raw, summary });

	assert.equal(result.status, 'accepted');
	assert.equal(result.qualificationEvidencePublished, true);
	assert.equal(result.environmentId, 'owner-qualified-windows-x64-rtx3090-01');
	assert.equal(result.observedEnvironmentId, 'packaged-runtime-win32-x64');
	assert.equal(result.sourceRevision, SOURCE_REVISION);
	assert.equal(result.budgetSha256, BUDGET_SHA256);
	assert.match(String(result.rawEvidence.diagnosticSha256), /^[a-f\d]{64}$/u);
	assert.deepEqual(result.verification, { passed: true, failures: [] });
});

test('Framescaper failures do not invalidate an independently complete Soundscaper M4 qualification', () => {
	const { config, raw, summary } = fixture();
	summary.collectionPassed = false;
	summary.failures = ['Playwright metrics exited with code 1.', 'Framescaper timed out.'];
	const result = createPackagedRuntimeQualification({ config, raw, summary });

	assert.equal(result.status, 'accepted');
	assert.equal(result.verification.passed, true);
});

test('the owner-designated packaged Windows host independently qualifies a passing M1 preview diagnostic', () => {
	const value = m1Fixture();
	const result = createPackagedRuntimeQualification(value);
	const m1 = result.workloadQualifications.find(({ workloadId }: { workloadId: string | null }) => (
		workloadId === 'm1-video-preview-12fx-720p'
	));

	assert.equal(m1?.status, 'accepted');
	assert.equal(m1?.qualificationEvidencePublished, true);
	assert.equal(m1?.environmentId, 'owner-qualified-windows-x64-rtx3090-01');
	assert.equal(m1?.rawEvidence.diagnosticKey, 'm1-video-preview-12fx-720p');
	assert.deepEqual(m1?.verification, { passed: true, failures: [] });
});

test('the owner-designated packaged Windows host independently qualifies M3 long-form and M4B2 keyed evidence', () => {
	for (const definition of [
		{
			diagnosticKey: 'm3-longform-editorial',
			workloadId: 'm3-longform-editorial',
			fixtureId: 'm3-longform-editorial-2h-v2',
			profile: 'deterministic-two-hour-editorial-v1',
			observationClass: 'decoded-media-av-scheduling-v1',
			metricIds: ['editorial.audioPositionErrorSamples', 'editorial.videoPositionErrorFrames',
				'editorial.avDriftMaximumMs', 'editorial.seekP95Ms',
				'editorial.scrollFrameIntervalP95Ms', 'editorial.retainedHeapDeltaBytes'],
		},
		{
			diagnosticKey: 'm4b2-keyframe-render-parity',
			workloadId: 'm4b2-keyframe-render-parity',
			fixtureId: 'm4b2-keyframe-parity-rgba-v1',
			profile: 'deterministic-keyframe-parity-v1',
			observationClass: 'complete-keyed-rgba-consumer-ledger-v1',
			metricIds: ['keyframes.videoMinimumSsim', 'keyframes.videoMaximumChannelMae',
				'keyframes.omittedOperations', 'keyframes.substitutedOperations',
				'keyframes.fallbackOperations'],
		},
	]) {
		const result = createPackagedRuntimeQualification(genericWorkloadFixture(definition));
		const workload = result.workloadQualifications[0];
		assert.equal(workload?.status, 'accepted', definition.workloadId);
		assert.equal(workload?.environmentId, 'owner-qualified-windows-x64-rtx3090-01');
		assert.equal(workload?.rawEvidence.diagnosticKey, definition.diagnosticKey);
		assert.deepEqual(workload?.verification, { passed: true, failures: [] });
	}
});

test('formal workload qualification fails closed for fixture and raw sample-count drift', () => {
	const definition = {
		diagnosticKey: 'm3-longform-editorial',
		workloadId: 'm3-longform-editorial',
		fixtureId: 'm3-longform-editorial-2h-v2',
		profile: 'deterministic-two-hour-editorial-v1',
		observationClass: 'decoded-media-av-scheduling-v1',
		metricIds: ['editorial.audioPositionErrorSamples'],
	};
	for (const [mutate, expectedFailure] of [
		[
			(value: ReturnType<typeof genericWorkloadFixture>) => {
				value.summary.workloads[0].fixture.generatorRevision += 1;
			},
			/fixture summary does not match/iu,
		],
		[
			(value: ReturnType<typeof genericWorkloadFixture>) => {
				value.summary.workloads[0].rawSampleCounts.primarySamples -= 1;
			},
			/raw sampling counts do not match/iu,
		],
	] as const) {
		const value = genericWorkloadFixture(definition);
		mutate(value);
		const workload = createPackagedRuntimeQualification(value).workloadQualifications[0];

		assert.equal(workload.status, 'rejected');
		assert.equal(workload.qualificationEvidencePublished, false);
		assert.match(workload.verification.failures.join('\n'), expectedFailure);
	}
});

test('M1 qualification fails closed for fingerprint, sampling, gate, retry, and digest drift', () => {
	for (const mutate of [
		(value: ReturnType<typeof m1Fixture>) => { value.raw.diagnostics['m1-video-preview-12fx-720p'].environmentFingerprint.architecture = 'arm64'; },
		(value: ReturnType<typeof m1Fixture>) => { value.raw.diagnostics['m1-video-preview-12fx-720p'].environmentFingerprint.powerMode = 'balanced'; },
		(value: ReturnType<typeof m1Fixture>) => { value.raw.diagnostics['m1-video-preview-12fx-720p'].environmentId = 'local-browser-correctness'; },
		(value: ReturnType<typeof m1Fixture>) => { value.raw.diagnostics['m1-video-preview-12fx-720p'].fixture.sourceSha256 = '0'.repeat(64); },
		(value: ReturnType<typeof m1Fixture>) => { value.summary.workloads[0].rawSampleCounts.measuredTrials = 4; },
		(value: ReturnType<typeof m1Fixture>) => { value.raw.diagnostics['m1-video-preview-12fx-720p'].trials.pop(); },
		(value: ReturnType<typeof m1Fixture>) => {
			const timestamps = value.raw.diagnostics['m1-video-preview-12fx-720p'].trials[0].frameTimestampsMs;
			timestamps[120] = timestamps[119];
		},
		(value: ReturnType<typeof m1Fixture>) => {
			value.summary.workloads[0].metrics['preview.frameIntervalP95Ms'] = 7;
		},
		(value: ReturnType<typeof m1Fixture>) => { value.summary.workloads[0].metricGatePassed = false; },
		(value: ReturnType<typeof m1Fixture>) => { value.summary.retryCount = 1; },
		(value: ReturnType<typeof m1Fixture>) => { value.raw.budgetSha256 = 'c'.repeat(64); },
	]) {
		const value = m1Fixture();
		mutate(value);
		const result = createPackagedRuntimeQualification(value);
		const m1 = result.workloadQualifications[0];
		assert.equal(m1.status, 'rejected');
		assert.equal(m1.qualificationEvidencePublished, false);
		assert.ok(m1.verification.failures.length > 0);
	}
});

test('qualification fails closed for another renderer, a failed gate, or incomplete run identity', () => {
	for (const mutate of [
		(value: ReturnType<typeof fixture>) => { value.raw.diagnostics['m4-production-parity'].environmentFingerprint.webglRenderer = 'ANGLE (SwiftShader)'; },
		(value: ReturnType<typeof fixture>) => { value.summary.workloads[0].metricGatePassed = false; },
		(value: ReturnType<typeof fixture>) => { value.summary.sourceRevision = null; },
	]) {
		const value = fixture();
		mutate(value);
		const result = createPackagedRuntimeQualification(value);
		assert.equal(result.status, 'rejected');
		assert.equal(result.qualificationEvidencePublished, false);
		assert.equal(result.verification.passed, false);
		assert.ok(result.verification.failures.length > 0);
	}
});

test('the quality register keeps the fixed-GPU profiles open until full owner identity is recaptured', async () => {
	const config = JSON.parse(await readFile(
		new URL('../config/quality-budgets.json', import.meta.url), 'utf8',
	));
	const profiles = config.packagedRuntimeQualification.profiles;
	const environment = config.environments.find(({ id }: { readonly id: string }) => (
		id === 'owner-qualified-windows-x64-rtx3090-01'
	));

	assert.equal(config.packagedRuntimeQualification.status, 'pending-external');
	assert.deepEqual(profiles.map(({ workloadId }: { readonly workloadId: string }) => workloadId), [
		'm1-video-preview-12fx-720p',
		'm3-longform-editorial',
		'm4-production-render-parity',
		'm4b2-keyframe-render-parity',
	]);
	assert.ok(profiles.every(({ environmentId }: { readonly environmentId: string }) => environmentId === environment.id));
	assert.equal(environment.status, 'unprovisioned');
	assert.equal(environment.qualificationEligible, false);
	assert.deepEqual(environment.eligibleWorkloadIds, [
		'm1-video-preview-12fx-720p',
		'm3-longform-editorial',
		'm4-production-render-parity',
		'm4b2-keyframe-render-parity',
	]);
	assert.equal(profiles[0].observedEnvironmentId, 'packaged-runtime-win32-x64');
	assert.equal(profiles[0].profile, 'deterministic-video-preview-12fx-v2');
	assert.ok(profiles.every(({ status }: { readonly status: string }) => status === 'pending-external'));
	assert.equal(
		profiles[0].observationClass,
		'fresh-context-presentation-cadence-and-retained-js-heap-v1',
	);
	assert.deepEqual(profiles[0].diagnosticIdentityFields, [
		'workloadId', 'fixtureId', 'profile', 'observationClass',
	]);
	assert.deepEqual(profiles[0].fingerprint, environment.fingerprint);
	assert.deepEqual(profiles[0].requiredFingerprintFields, [
		'browserVersion', 'platform', 'architecture', 'webglVendor', 'webglRenderer',
		'gpuDriverVersion', 'gpuDeviceId', 'powerMode', 'displayMode',
	]);
	assert.deepEqual(profiles[0].rawSampleCounts, {
		warmupTrials: 1,
		measuredTrials: 5,
		measuredFrames: 605,
		measuredIntervals: 600,
		forcedCollectionsBefore: 15,
		forcedCollectionsAfter: 15,
		heapSnapshotsBefore: 5,
		heapSnapshotsAfter: 5,
	});
	assert.equal(profiles[0].fixture.sourceSha256, M1_SOURCE_SHA256);
	assert.equal(Object.hasOwn(profiles[0], 'diagnosticFingerprintSource'), false);
	assert.equal(Object.hasOwn(profiles[0], 'sampleShape'), false);
	assert.deepEqual(profiles[1].rawSampleCounts, {
		positionChecks: 26,
		decodedAvSamples: 24,
		seekWarmupTrials: 1,
		seekTrials: 5,
		scrollFrameIntervals: 240,
		forcedCollectionsBefore: 3,
		forcedCollectionsAfter: 3,
	});
	assert.equal(profiles[1].fixture.generatorRevision, 2);
	assert.equal(profiles[2].fingerprint.gpuDriverVersion, null);
	assert.deepEqual(profiles[3].rawSampleCounts, {
		cases: 4,
		queries: 12,
		videoPixels: 110_592,
		requestedOperations: 12,
		requestedConsumerOperations: 24,
		renderedConsumerOperations: 24,
	});
	assert.equal(profiles[3].fixture.generatorRevision, 3);
	assert.equal(
		profiles[3].fixture.evidenceClipIds[3],
		'framescaper-flat-clip-4f2ad5b3a72f098f3878c158c7025f70',
	);
});

function genericWorkloadFixture(definition: {
	readonly diagnosticKey: string;
	readonly workloadId: string;
	readonly fixtureId: string;
	readonly profile: string;
	readonly observationClass: string;
	readonly metricIds: readonly string[];
}) {
	const profile = {
		status: 'active',
		diagnosticKey: definition.diagnosticKey,
		environmentId: 'owner-qualified-windows-x64-rtx3090-01',
		observedEnvironmentId: 'packaged-runtime-win32-x64',
		workloadId: definition.workloadId,
		fixtureId: definition.fixtureId,
		profile: definition.profile,
		observationClass: definition.observationClass,
		rendererClass: 'hardware',
		diagnosticIdentityFields: ['workloadId', 'fixtureId', 'profile', 'observationClass'],
		fingerprint: structuredClone(FINGERPRINT),
		fixture: structuredClone(GENERIC_FIXTURE),
		rawSampleCounts: structuredClone(GENERIC_RAW_SAMPLE_COUNTS),
	};
	const diagnostic = {
		workloadId: profile.workloadId,
		fixtureId: profile.fixtureId,
		profile: profile.profile,
		observationClass: profile.observationClass,
		environmentId: profile.observedEnvironmentId,
		rendererClass: profile.rendererClass,
		environmentFingerprint: structuredClone(FINGERPRINT),
	};
	const metrics = Object.fromEntries(definition.metricIds.map((metricId) => [metricId, 0]));
	return {
		config: {
			packagedRuntimeQualification: { status: 'active', profiles: [profile] },
			workloads: [{
				id: profile.workloadId,
				thresholds: definition.metricIds.map((metricId) => ({ metricId })),
			}],
		},
		raw: {
			schemaVersion: 1,
			executionSurface: 'packaged-runtime',
			sourceRevision: SOURCE_REVISION,
			budgetSha256: BUDGET_SHA256,
			diagnostics: { [profile.diagnosticKey]: diagnostic },
		},
		summary: {
			schemaVersion: 1,
			executionSurface: 'packaged-runtime',
			sourceRevision: SOURCE_REVISION,
			budgetSha256: BUDGET_SHA256,
			attemptCount: 1,
			retryCount: 0,
			workerCount: 1,
			workloads: [{
				...diagnostic,
				attemptCount: 1,
				retryCount: 0,
				metricGatePassed: true,
				metrics,
				fixture: structuredClone(GENERIC_FIXTURE),
				rawSampleCounts: structuredClone(GENERIC_RAW_SAMPLE_COUNTS),
				evaluation: {
					verdicts: definition.metricIds.map((metricId) => ({ metricId, passed: true })),
				},
			}],
		},
	};
}

function m1Fixture() {
	const fixture = {
		width: 1_280,
		height: 720,
		effectCount: 12,
		measuredIntervals: 120,
		sourceFrameRate: 30,
		sourceFrameCount: 180,
		sourceByteLength: 109_277,
		sourceSha256: M1_SOURCE_SHA256,
	};
	const trials = Array.from({ length: 5 }, (_, trialIndex) => ({
		trial: trialIndex + 1,
		frameTimestampsMs: Array.from({ length: 121 }, (_unused, frameIndex) => (
			frameIndex * (8 + (trialIndex * 0.1))
		)),
		heapBefore: { usedSize: 1_000_000, totalSize: 2_000_000 },
		heapAfter: { usedSize: 990_000 + (trialIndex * 1_000), totalSize: 2_000_000 },
		forcedCollectionsBefore: 3,
		forcedCollectionsAfter: 3,
	}));
	const diagnostic = {
		schemaVersion: 1,
		profile: 'deterministic-video-preview-12fx-v2',
		observationClass: 'fresh-context-presentation-cadence-and-retained-js-heap-v1',
		workloadId: 'm1-video-preview-12fx-720p',
		fixtureId: 'video-preview-12fx-720p-v1',
		environmentId: 'packaged-runtime-win32-x64',
		rendererClass: 'hardware',
		environmentFingerprint: structuredClone(M1_FINGERPRINT),
		fixture: structuredClone(fixture),
		sampling: {
			warmupTrials: 1,
			measuredTrials: 5,
			measuredFramesPerTrial: 121,
			measuredIntervalsPerTrial: 120,
			forcedCollectionsPerSnapshot: 3,
		},
		trials,
	};
	const metrics = {
		'preview.frameIntervalP95Ms': 8.4,
		'preview.retainedJsHeapDeltaBytes': -6_000,
	};
	const rawSampleCounts = {
		warmupTrials: 1,
		measuredTrials: 5,
		measuredFrames: 605,
		measuredIntervals: 600,
		forcedCollectionsBefore: 15,
		forcedCollectionsAfter: 15,
		heapSnapshotsBefore: 5,
		heapSnapshotsAfter: 5,
	};
	const profile = {
		status: 'active',
		diagnosticKey: 'm1-video-preview-12fx-720p',
		environmentId: 'owner-qualified-windows-x64-rtx3090-01',
		observedEnvironmentId: 'packaged-runtime-win32-x64',
		workloadId: 'm1-video-preview-12fx-720p',
		fixtureId: 'video-preview-12fx-720p-v1',
		profile: diagnostic.profile,
		observationClass: diagnostic.observationClass,
		rendererClass: 'hardware',
		diagnosticIdentityFields: ['workloadId', 'fixtureId', 'profile', 'observationClass'],
		fingerprint: structuredClone(M1_FINGERPRINT),
		fixture: structuredClone(fixture),
		rawSampleCounts: structuredClone(rawSampleCounts),
	};
	return {
		config: {
			packagedRuntimeQualification: { status: 'active', profiles: [profile] },
			workloads: [{
				id: profile.workloadId,
				thresholds: Object.keys(metrics).map((metricId) => ({ metricId })),
			}],
		},
		raw: {
			schemaVersion: 1, executionSurface: 'packaged-runtime', sourceRevision: SOURCE_REVISION,
			budgetSha256: BUDGET_SHA256, diagnostics: { [profile.diagnosticKey]: diagnostic },
		},
		summary: {
			schemaVersion: 1, executionSurface: 'packaged-runtime', sourceRevision: SOURCE_REVISION as string | null,
			budgetSha256: BUDGET_SHA256, attemptCount: 1, retryCount: 0, workerCount: 1,
			collectionPassed: true, failures: [] as string[], workloads: [{
				workloadId: profile.workloadId, fixtureId: profile.fixtureId,
				profile: profile.profile, observationClass: profile.observationClass,
				environmentId: profile.observedEnvironmentId, attemptCount: 1, retryCount: 0,
				rendererClass: 'hardware', environmentFingerprint: structuredClone(M1_FINGERPRINT),
				fixture: structuredClone(profile.fixture), rawSampleCounts: structuredClone(rawSampleCounts),
				metricGatePassed: true, metrics,
				evaluation: { verdicts: Object.keys(metrics).map((metricId) => ({ metricId, passed: true })) },
			}],
		},
	};
}

function fixture() {
	const diagnostic = {
		schemaVersion: 1,
		profile: 'deterministic-production-parity-v1',
		observationClass: 'complete-pcm-rgba-render-ledger-v1',
		workloadId: 'm4-production-render-parity',
		fixtureId: 'm4-production-parity-v1',
		environmentId: 'packaged-runtime-win32-x64',
		rendererClass: 'hardware',
		environmentFingerprint: structuredClone(FINGERPRINT),
	};
	const metrics = {
		'parity.audioMaximumAbsoluteSampleError': 0,
		'parity.pdcErrorSamples': 0,
		'parity.videoMinimumSsim': 0.981534357583265,
		'parity.videoMaximumChannelMae': 0.020067401960784315,
		'parity.silentlyOmittedEffects': 0,
	};
	const workload = {
		workloadId: 'm4-production-render-parity',
		fixtureId: 'm4-production-parity-v1',
		environmentId: 'packaged-runtime-win32-x64',
		profile: 'deterministic-production-parity-v1',
		observationClass: 'complete-pcm-rgba-render-ledger-v1',
		attemptCount: 1,
		retryCount: 0,
		rendererClass: 'hardware',
		environmentFingerprint: structuredClone(FINGERPRINT),
		metricGatePassed: true,
		metrics,
		evaluation: { verdicts: Object.keys(metrics).map((metricId) => ({ metricId, passed: true })) },
	};
	return {
		config: {
			packagedRuntimeQualification: {
				status: 'active',
				environmentId: 'owner-qualified-windows-x64-rtx3090-01',
				observedEnvironmentId: 'packaged-runtime-win32-x64',
				workloadId: 'm4-production-render-parity',
				fixtureId: 'm4-production-parity-v1',
				profile: 'deterministic-production-parity-v1',
				observationClass: 'complete-pcm-rgba-render-ledger-v1',
				rendererClass: 'hardware',
				fingerprint: structuredClone(FINGERPRINT),
			},
			workloads: [{
				id: 'm4-production-render-parity',
				thresholds: Object.keys(metrics).map((metricId) => ({ metricId })),
			}],
		},
		raw: {
			schemaVersion: 1,
			kind: 'soundscaper-desktop-nightly-packaged-runtime-metrics-raw',
			executionSurface: 'packaged-runtime',
			sourceRevision: SOURCE_REVISION,
			budgetSha256: BUDGET_SHA256,
			diagnostics: { 'm4-production-parity': diagnostic },
		},
		summary: {
			schemaVersion: 1,
			kind: 'soundscaper-desktop-nightly-packaged-runtime-metrics',
			executionSurface: 'packaged-runtime',
			sourceRevision: SOURCE_REVISION as string | null,
			budgetSha256: BUDGET_SHA256,
			attemptCount: 1,
			retryCount: 0,
			workerCount: 1,
			collectionPassed: true,
			qualificationEvidencePublished: false,
			workloads: [workload],
			failures: [] as string[],
		},
	};
}

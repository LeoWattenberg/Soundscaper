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
	browserEnvironment: {
		devicePixelRatio: 1,
		hardwareConcurrency: 24,
		userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Framescaper/0.2.0-beta.1 Chrome/150.0.7871.114 Electron/43.1.1 Safari/537.36',
	},
	renderer: {
		vendor: 'Google Inc. (NVIDIA)',
		renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)',
	},
};
const M1_EFFECTS = [
	'Color Adjust', 'Pixelate', 'Vignette', 'Gaussian Blur', 'Sharpen', 'RGB Split',
	'Chroma Key', 'Luma Key', 'Spill Suppression', 'Glow', 'Outline', 'Drop Shadow',
];

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
	const m1 = result.workloadQualifications.find(({ workloadId }) => (
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
			fixtureId: 'm3-longform-editorial-2h-v1',
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
		fixtureId: 'm3-longform-editorial-2h-v1',
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
		(value: ReturnType<typeof m1Fixture>) => { value.raw.diagnostics['m1-video-preview-12fx-720p'].browserEnvironment.hardwareConcurrency = 16; },
		(value: ReturnType<typeof m1Fixture>) => { value.raw.diagnostics['m1-video-preview-12fx-720p'].measuredIntervals = 119; },
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

test('the quality register activates only the owner-designated packaged host for M1, M3, and M4', async () => {
	const config = JSON.parse(await readFile(
		new URL('../config/quality-budgets.json', import.meta.url), 'utf8',
	));
	const profiles = config.packagedRuntimeQualification.profiles;
	const environment = config.environments.find(({ id }: { readonly id: string }) => (
		id === 'owner-qualified-windows-x64-rtx3090-01'
	));

	assert.equal(config.packagedRuntimeQualification.status, 'active');
	assert.deepEqual(profiles.map(({ workloadId }: { readonly workloadId: string }) => workloadId), [
		'm1-video-preview-12fx-720p',
		'm3-longform-editorial',
		'm4-production-render-parity',
		'm4b2-keyframe-render-parity',
	]);
	assert.ok(profiles.every(({ environmentId }: { readonly environmentId: string }) => environmentId === environment.id));
	assert.equal(environment.qualificationEligible, true);
	assert.deepEqual(environment.eligibleWorkloadIds, [
		'm1-video-preview-12fx-720p',
		'm3-longform-editorial',
		'm4-production-render-parity',
		'm4b2-keyframe-render-parity',
	]);
	assert.deepEqual(profiles[1].rawSampleCounts, {
		positionChecks: 26,
		decodedAvSamples: 24,
		seekWarmupTrials: 1,
		seekTrials: 5,
		scrollFrameIntervals: 240,
		forcedCollectionsBefore: 3,
		forcedCollectionsAfter: 3,
	});
	assert.equal(profiles[1].fixture.generatorRevision, 1);
	assert.match(profiles[2].fingerprint.webglRenderer, /NVIDIA GeForce RTX 3090/u);
	assert.deepEqual(profiles[3].rawSampleCounts, {
		cases: 4,
		queries: 12,
		videoPixels: 110_592,
		requestedOperations: 12,
		requestedConsumerOperations: 24,
		renderedConsumerOperations: 24,
	});
	assert.equal(profiles[3].fixture.generatorRevision, 2);
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
	const diagnostic = {
		resolution: [1_280, 720],
		effects: [...M1_EFFECTS],
		warmupFrames: 40,
		measuredFrames: 121,
		measuredIntervals: 120,
		p95Ms: 8.665,
		retainedJsHeapDeltaBytes: -10_108,
		renderer: structuredClone(M1_FINGERPRINT.renderer),
		browserVersion: M1_FINGERPRINT.browserVersion,
		browserEnvironment: structuredClone(M1_FINGERPRINT.browserEnvironment),
	};
	const metrics = {
		'preview.frameIntervalP95Ms': 8.665,
		'preview.retainedJsHeapDeltaBytes': -10_108,
	};
	const profile = {
		status: 'active',
		diagnosticKey: 'm1-video-preview-12fx-720p',
		environmentId: 'owner-qualified-windows-x64-rtx3090-01',
		observedEnvironmentId: 'local-browser-correctness',
		workloadId: 'm1-video-preview-12fx-720p',
		fixtureId: 'video-preview-12fx-720p-v1',
		rendererClass: 'hardware',
		diagnosticIdentityFields: [],
		diagnosticFingerprintSource: 'm1-video-preview',
		fingerprint: structuredClone(M1_FINGERPRINT),
		fixture: { width: 1_280, height: 720, effectCount: 12, measuredIntervals: 120 },
		sampleShape: {
			resolution: [1_280, 720], effects: [...M1_EFFECTS], warmupFrames: 40,
			measuredFrames: 121, measuredIntervals: 120,
		},
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
				environmentId: profile.observedEnvironmentId, attemptCount: 1, retryCount: 0,
				rendererClass: 'hardware', environmentFingerprint: structuredClone(M1_FINGERPRINT),
				fixture: structuredClone(profile.fixture), rawSampleCounts: {
					warmupFrames: 40, measuredFrames: 121, measuredIntervals: 120,
				}, metricGatePassed: true, metrics,
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

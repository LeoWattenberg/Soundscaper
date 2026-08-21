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

test('the quality register activates only the owner-designated packaged M4 host', async () => {
	const config = JSON.parse(await readFile(
		new URL('../config/quality-budgets.json', import.meta.url), 'utf8',
	));
	const profile = config.packagedRuntimeQualification;
	const environment = config.environments.find(({ id }: { readonly id: string }) => (
		id === 'owner-qualified-windows-x64-rtx3090-01'
	));

	assert.equal(profile.status, 'active');
	assert.equal(profile.environmentId, environment.id);
	assert.equal(environment.qualificationEligible, true);
	assert.deepEqual(environment.eligibleWorkloadIds, ['m4-production-render-parity']);
	assert.equal(profile.fingerprint.platform, 'win32');
	assert.match(profile.fingerprint.webglRenderer, /NVIDIA GeForce RTX 3090/u);
});

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

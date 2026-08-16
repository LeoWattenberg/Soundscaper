/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clearNativeMediaBackendQuarantine,
	createNativeMediaBackendHealth,
	nativeMediaBackendAfterFailure,
	NATIVE_MEDIA_BACKEND_CANDIDATES,
	NATIVE_MEDIA_BACKEND_QUARANTINE_FAILURE_LIMIT,
	NATIVE_MEDIA_BACKEND_QUARANTINE_WINDOW_MS,
	NATIVE_MEDIA_CPU_BACKEND,
	NATIVE_MEDIA_PLATFORMS,
	NATIVE_MEDIA_WEB_BACKEND,
	NativeMediaBackendPolicyError,
	recordNativeMediaBackendFailure,
	resolveNativeMediaBackendPlan,
} from '../src/common/editor/native-media-backend-policy.ts';
import {
	createNativeMediaCapabilitySnapshotV1,
	type NativeMediaCapabilityDomain,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	evaluateNativeMediaSemanticComparison,
	NATIVE_MEDIA_MAXIMUM_ENDPOINT_FRAME_DELTA,
	NATIVE_MEDIA_MINIMUM_PSNR_DB,
	NATIVE_MEDIA_MINIMUM_SSIM,
	NativeMediaComparisonError,
} from '../src/common/editor/native-media-semantic-comparison.ts';

const REFERENCE = 'a'.repeat(64);
const CANDIDATE = 'b'.repeat(64);

test('the candidate backend matrix covers the qualifying platform set', () => {
	assert.deepEqual([...NATIVE_MEDIA_PLATFORMS], ['win32', 'darwin', 'linux']);
	assert.deepEqual([...NATIVE_MEDIA_BACKEND_CANDIDATES.win32.decode], ['d3d11va', 'qsv', 'nvdec']);
	assert.deepEqual([...NATIVE_MEDIA_BACKEND_CANDIDATES.win32.encode], ['media-foundation', 'qsv', 'nvenc', 'amf']);
	assert.deepEqual([...NATIVE_MEDIA_BACKEND_CANDIDATES.darwin.encode], ['videotoolbox']);
	assert.deepEqual([...NATIVE_MEDIA_BACKEND_CANDIDATES.linux.decode], ['vaapi', 'qsv', 'nvdec']);
});

test('with the master switch off every job falls back to Web Core', () => {
	const plan = resolveNativeMediaBackendPlan({
		platform: 'linux',
		operation: 'decode',
		snapshot: snapshot({ masterEnabled: false, backends: ['native-cpu', 'vaapi'] }),
	});

	assert.deepEqual(plan.attempts, []);
	assert.equal(plan.fallback, NATIVE_MEDIA_WEB_BACKEND);
	assert.equal(plan.reason, 'web-core-fallback');
});

test('hardware is never the only way a job can run', () => {
	// The CPU backend is unusable, so the hardware backend is not planned either.
	const plan = resolveNativeMediaBackendPlan({
		platform: 'linux',
		operation: 'decode',
		snapshot: snapshot({ backends: ['vaapi'] }),
	});

	assert.deepEqual(plan.attempts, []);
	assert.equal(plan.reason, 'web-core-fallback');
});

test('an opted-in job with no usable hardware runs on native CPU alone', () => {
	const plan = resolveNativeMediaBackendPlan({
		platform: 'darwin',
		operation: 'encode',
		snapshot: snapshot({ backends: ['native-cpu'] }),
	});

	assert.deepEqual(plan.attempts, [NATIVE_MEDIA_CPU_BACKEND]);
	assert.equal(plan.reason, 'cpu-only');
	assert.equal(nativeMediaBackendAfterFailure(plan, NATIVE_MEDIA_CPU_BACKEND), NATIVE_MEDIA_WEB_BACKEND);
});

test('a job plans exactly one hardware attempt and retries once on native CPU', () => {
	const plan = resolveNativeMediaBackendPlan({
		platform: 'win32',
		operation: 'encode',
		snapshot: snapshot({ backends: ['native-cpu', 'qsv', 'nvenc'] }),
		preferredBackends: ['nvenc', 'qsv'],
	});

	assert.deepEqual(plan.attempts, ['nvenc', NATIVE_MEDIA_CPU_BACKEND]);
	assert.equal(plan.reason, 'hardware-then-cpu');
	assert.equal(nativeMediaBackendAfterFailure(plan, 'nvenc'), NATIVE_MEDIA_CPU_BACKEND);
	assert.equal(nativeMediaBackendAfterFailure(plan, NATIVE_MEDIA_CPU_BACKEND), NATIVE_MEDIA_WEB_BACKEND);
	assert.throws(
		() => nativeMediaBackendAfterFailure(plan, 'vaapi'),
		NativeMediaBackendPolicyError,
	);
});

test('a backend the platform or operation does not offer is never planned', () => {
	const decodeOnly = resolveNativeMediaBackendPlan({
		platform: 'win32',
		operation: 'decode',
		snapshot: snapshot({ backends: ['native-cpu', 'nvenc'] }),
		preferredBackends: ['nvenc'],
	});
	const wrongPlatform = resolveNativeMediaBackendPlan({
		platform: 'darwin',
		operation: 'decode',
		snapshot: snapshot({ backends: ['native-cpu', 'vaapi'] }),
		preferredBackends: ['vaapi'],
	});

	assert.deepEqual(decodeOnly.attempts, [NATIVE_MEDIA_CPU_BACKEND]);
	assert.deepEqual(wrongPlatform.attempts, [NATIVE_MEDIA_CPU_BACKEND]);
});

test('a hardware backend the user has not opted into stays unplanned', () => {
	const plan = resolveNativeMediaBackendPlan({
		platform: 'linux',
		operation: 'decode',
		snapshot: createNativeMediaCapabilitySnapshotV1({
			masterEnabled: true,
			entries: [
				entry('operation', 'decode', true),
				entry('backend', NATIVE_MEDIA_CPU_BACKEND, true),
				entry('backend', 'vaapi', false),
			],
		}),
	});

	assert.deepEqual(plan.attempts, [NATIVE_MEDIA_CPU_BACKEND]);
});

test('backend health degrades on one failure and quarantines on three in the window', () => {
	let health = createNativeMediaBackendHealth('nvenc');
	assert.equal(health.degraded, false);

	health = recordNativeMediaBackendFailure(health, 1_000);
	assert.equal(health.degraded, true);
	assert.equal(health.quarantined, false);

	health = recordNativeMediaBackendFailure(health, 2_000);
	assert.equal(health.quarantined, false);

	health = recordNativeMediaBackendFailure(health, 3_000);
	assert.equal(health.quarantined, true);
	assert.equal(health.failureTimestamps.length, NATIVE_MEDIA_BACKEND_QUARANTINE_FAILURE_LIMIT);
});

test('failures older than the window never accumulate into quarantine', () => {
	let health = createNativeMediaBackendHealth('vaapi');
	for (const step of [0, 1, 2]) {
		health = recordNativeMediaBackendFailure(
			health,
			step * (NATIVE_MEDIA_BACKEND_QUARANTINE_WINDOW_MS + 1),
		);
	}

	assert.equal(health.quarantined, false);
	assert.equal(health.failureTimestamps.length, 1);
	assert.equal(health.degraded, true);
});

test('only an explicit clear brings a quarantined backend back', () => {
	let health = createNativeMediaBackendHealth('qsv');
	for (const at of [1, 2, 3]) health = recordNativeMediaBackendFailure(health, at);
	assert.equal(health.quarantined, true);

	// A later success does not silently un-quarantine: nothing but the clear does.
	health = recordNativeMediaBackendFailure(health, 1_000_000);
	assert.equal(health.quarantined, true);

	const cleared = clearNativeMediaBackendQuarantine(health);
	assert.equal(cleared.quarantined, false);
	assert.equal(cleared.degraded, false);
	assert.deepEqual(cleared.failureTimestamps, []);
});

test('an unknown backend or non-finite timestamp is refused', () => {
	assert.throws(() => createNativeMediaBackendHealth('magic'), NativeMediaBackendPolicyError);
	assert.throws(
		() => recordNativeMediaBackendFailure(createNativeMediaBackendHealth('qsv'), Number.NaN),
		/finite timestamp/u,
	);
	assert.throws(() => resolveNativeMediaBackendPlan({
		platform: 'plan9' as never, operation: 'decode', snapshot: snapshot({}),
	}), /qualifying platform/u);
	assert.throws(() => resolveNativeMediaBackendPlan({
		platform: 'linux', operation: 'transcode' as never, snapshot: snapshot({}),
	}), /supported operation/u);
});

test('semantic agreement is judged on meaning rather than encoded bytes', () => {
	const lossless = evaluateNativeMediaSemanticComparison({
		mode: 'lossless',
		referencePlanFingerprint: REFERENCE,
		candidatePlanFingerprint: REFERENCE,
		referenceFrameCount: 300,
		candidateFrameCount: 300,
		mismatchedFrameCount: 0,
		endpointFrameDelta: NATIVE_MEDIA_MAXIMUM_ENDPOINT_FRAME_DELTA,
	});
	const lossy = evaluateNativeMediaSemanticComparison({
		mode: 'lossy',
		referencePlanFingerprint: REFERENCE,
		candidatePlanFingerprint: REFERENCE,
		referenceFrameCount: 300,
		candidateFrameCount: 300,
		ssim: NATIVE_MEDIA_MINIMUM_SSIM,
		psnrDb: NATIVE_MEDIA_MINIMUM_PSNR_DB,
		endpointFrameDelta: 0,
	});

	assert.deepEqual(lossless, { agreed: true, mode: 'lossless', failures: [] });
	assert.deepEqual(lossy, { agreed: true, mode: 'lossy', failures: [] });
});

test('every semantic divergence is reported, not only the first', () => {
	const verdict = evaluateNativeMediaSemanticComparison({
		mode: 'lossy',
		referencePlanFingerprint: REFERENCE,
		candidatePlanFingerprint: CANDIDATE,
		referenceFrameCount: 300,
		candidateFrameCount: 299,
		ssim: 0.994,
		psnrDb: 44.9,
		endpointFrameDelta: -2,
	});

	assert.equal(verdict.agreed, false);
	assert.deepEqual(verdict.failures, [
		'plan-fingerprint-diverged',
		'frame-count-diverged',
		'ssim-below-threshold',
		'psnr-below-threshold',
		'endpoint-drift-exceeded',
	]);
});

test('a lossless path admits no pixel mismatch at all', () => {
	const verdict = evaluateNativeMediaSemanticComparison({
		mode: 'lossless',
		referencePlanFingerprint: REFERENCE,
		candidatePlanFingerprint: REFERENCE,
		referenceFrameCount: 10,
		candidateFrameCount: 10,
		mismatchedFrameCount: 1,
		endpointFrameDelta: 0,
	});

	assert.deepEqual(verdict.failures, ['pixel-mismatch-in-lossless-path']);
});

test('a comparison without its measurements is refused rather than assumed passing', () => {
	const base = {
		referencePlanFingerprint: REFERENCE,
		candidatePlanFingerprint: REFERENCE,
		referenceFrameCount: 10,
		candidateFrameCount: 10,
		endpointFrameDelta: 0,
	} as const;

	assert.throws(() => evaluateNativeMediaSemanticComparison({ ...base, mode: 'lossless' }), NativeMediaComparisonError);
	assert.throws(() => evaluateNativeMediaSemanticComparison({ ...base, mode: 'lossy', psnrDb: 60 }), /measured ssim/u);
	assert.throws(() => evaluateNativeMediaSemanticComparison({ ...base, mode: 'lossy', ssim: 1 }), /measured PSNR/u);
	assert.throws(() => evaluateNativeMediaSemanticComparison({
		...base, mode: 'lossy', ssim: 1, psnrDb: 60, endpointFrameDelta: 0.5,
	}), /integer endpoint frame delta/u);
	assert.throws(() => evaluateNativeMediaSemanticComparison({
		...base, mode: 'exact' as never, mismatchedFrameCount: 0,
	}), /lossless or lossy mode/u);
	assert.throws(() => evaluateNativeMediaSemanticComparison({
		...base, mode: 'lossless', mismatchedFrameCount: 0, candidatePlanFingerprint: 'short',
	}), /canonical plan fingerprints/u);
});

function entry(domain: NativeMediaCapabilityDomain, id: string, userEnabled: boolean) {
	return {
		domain,
		id,
		policyCleared: true,
		buildSupported: true,
		probeSucceeded: true,
		selfTestPassed: true,
		userEnabled,
	};
}

function snapshot(options: Readonly<{ masterEnabled?: boolean; backends?: readonly string[] }>) {
	const backends = options.backends ?? [];
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled: options.masterEnabled !== false,
		entries: [
			entry('operation', 'decode', true),
			entry('operation', 'encode', true),
			...backends.map((backend) => entry('backend', backend, true)),
		],
	});
}

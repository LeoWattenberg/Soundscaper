/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertNativeMediaRelativeDestination,
	createNativeMediaPublicationPlan,
	evaluateNativeMediaPublication,
	nativeMediaPartialOutputIsDisposable,
	NATIVE_MEDIA_PARTIAL_SUFFIX,
	NativeMediaPublicationError,
	type NativeMediaPublicationAttemptV1,
} from '../src/common/editor/native-media-atomic-publication.ts';

const JOB_ID = '7f'.repeat(20);
const OTHER_JOB_ID = '9c'.repeat(20);
const PLAN = 'a'.repeat(64);
const OTHER_PLAN = 'b'.repeat(64);
const DIGEST = 'c'.repeat(64);
const OTHER_DIGEST = 'd'.repeat(64);

test('a destination stays inside its granted root by construction', () => {
	assert.equal(assertNativeMediaRelativeDestination('exports/reel.mp4'), 'exports/reel.mp4');
	assert.equal(assertNativeMediaRelativeDestination('reel.mp4'), 'reel.mp4');

	for (const [destination, pattern] of [
		['', /non-empty relative text/u],
		['/absolute/reel.mp4', /relative to its granted root/u],
		['C:/exports/reel.mp4', /relative to its granted root/u],
		['exports\\reel.mp4', /forward slashes and no NUL/u],
		['exports/\0reel.mp4', /forward slashes and no NUL/u],
		['../reel.mp4', /traverse its granted root/u],
		['exports/../../reel.mp4', /traverse its granted root/u],
		['exports/./reel.mp4', /traverse its granted root/u],
		['exports//reel.mp4', /empty path segments/u],
		['exports/reel.mp4/', /empty path segments/u],
		['exports/reel.', /space or dot padded/u],
		['exports/ reel.mp4', /space or dot padded/u],
		['exports/reel .mp4 ', /space or dot padded/u],
		['exports/re:el.mp4', /reserved character/u],
		['exports/re*el.mp4', /reserved character/u],
		['exports/NUL.mp4', /reserved device name/u],
		['exports/com1.txt', /reserved device name/u],
		[`exports/reel.mp4${NATIVE_MEDIA_PARTIAL_SUFFIX}`, /partial-output suffix/u],
		['x'.repeat(1_025), /length ceiling/u],
		[`exports/${'x'.repeat(256)}.mp4`, /segment exceeds its length ceiling/u],
	] as const) {
		assert.throws(() => assertNativeMediaRelativeDestination(destination), pattern, destination);
	}
});

test('the temporary output is a sibling of its destination so the rename is atomic', () => {
	const plan = createNativeMediaPublicationPlan({
		jobId: JOB_ID, relativeDestination: 'exports/reel.mp4', planFingerprint: PLAN,
	});
	const rootLevel = createNativeMediaPublicationPlan({
		jobId: JOB_ID, relativeDestination: 'reel.mp4', planFingerprint: PLAN,
	});

	assert.equal(plan.temporaryRelativePath, `exports/reel.mp4.${JOB_ID.slice(0, 16)}.partial`);
	assert.equal(rootLevel.temporaryRelativePath, `reel.mp4.${JOB_ID.slice(0, 16)}.partial`);
	// Same directory: a cross-directory temporary would silently become a copy.
	assert.equal(
		plan.temporaryRelativePath.slice(0, plan.temporaryRelativePath.lastIndexOf('/')),
		plan.relativeDestination.slice(0, plan.relativeDestination.lastIndexOf('/')),
	);
});

test('the temporary name is deterministic per job so a restart reuses its own partial', () => {
	const first = createNativeMediaPublicationPlan({
		jobId: JOB_ID, relativeDestination: 'exports/reel.mp4', planFingerprint: PLAN,
	});
	const restarted = createNativeMediaPublicationPlan({
		jobId: JOB_ID, relativeDestination: 'exports/reel.mp4', planFingerprint: PLAN,
	});
	const otherJob = createNativeMediaPublicationPlan({
		jobId: OTHER_JOB_ID, relativeDestination: 'exports/reel.mp4', planFingerprint: PLAN,
	});

	assert.equal(first.temporaryRelativePath, restarted.temporaryRelativePath);
	assert.notEqual(first.temporaryRelativePath, otherJob.temporaryRelativePath);
});

test('a complete, current, verified output publishes', () => {
	const verdict = evaluateNativeMediaPublication(attempt());

	assert.deepEqual(verdict, { publish: true, refusals: [] });
	assert.equal(nativeMediaPartialOutputIsDisposable(verdict), true);
});

test('a cancelled, failed, unfinalized, or superseded job publishes nothing', () => {
	for (const [overrides, expected] of [
		[{ outcome: 'cancelled' as const }, ['job-cancelled']],
		[{ outcome: 'failed' as const }, ['job-failed']],
		[{ finalized: false }, ['output-not-finalized']],
		[{ currentPlanFingerprint: OTHER_PLAN }, ['plan-superseded']],
	] as const) {
		const verdict = evaluateNativeMediaPublication(attempt(overrides));
		assert.equal(verdict.publish, false);
		assert.deepEqual(verdict.refusals, expected);
	}
});

test('an output that fails verification publishes nothing', () => {
	assert.deepEqual(
		evaluateNativeMediaPublication(attempt({ observedByteLength: 1 })).refusals,
		['byte-length-mismatch'],
	);
	assert.deepEqual(
		evaluateNativeMediaPublication(attempt({ observedSha256: OTHER_DIGEST })).refusals,
		['digest-mismatch'],
	);
	assert.deepEqual(
		evaluateNativeMediaPublication(attempt({ declaredSha256: null })).refusals,
		['unverified-output'],
	);
	assert.deepEqual(
		evaluateNativeMediaPublication(attempt({ observedSha256: null })).refusals,
		['unverified-output'],
	);
});

test('every publication refusal is reported at once', () => {
	const verdict = evaluateNativeMediaPublication(attempt({
		outcome: 'failed',
		currentPlanFingerprint: OTHER_PLAN,
		observedByteLength: 5,
		observedSha256: null,
	}));

	assert.deepEqual(verdict.refusals, [
		'job-failed', 'plan-superseded', 'byte-length-mismatch', 'unverified-output',
	]);
});

test('a failed partial is retained for retry while a cancelled one is disposable', () => {
	assert.equal(
		nativeMediaPartialOutputIsDisposable(evaluateNativeMediaPublication(attempt({ outcome: 'cancelled' }))),
		true,
	);
	assert.equal(
		nativeMediaPartialOutputIsDisposable(evaluateNativeMediaPublication(attempt({ currentPlanFingerprint: OTHER_PLAN }))),
		true,
	);
	assert.equal(
		nativeMediaPartialOutputIsDisposable(evaluateNativeMediaPublication(attempt({ outcome: 'failed' }))),
		false,
	);
	assert.equal(
		nativeMediaPartialOutputIsDisposable(evaluateNativeMediaPublication(attempt({ observedSha256: OTHER_DIGEST }))),
		false,
	);
});

test('a publication without the main-minted job id or a real digest is refused', () => {
	assert.throws(() => createNativeMediaPublicationPlan({
		jobId: 'short', relativeDestination: 'reel.mp4', planFingerprint: PLAN,
	}), NativeMediaPublicationError);
	assert.throws(() => createNativeMediaPublicationPlan({
		jobId: JOB_ID, relativeDestination: 'reel.mp4', planFingerprint: 'nope',
	}), /lowercase SHA-256 plan fingerprint/u);
	assert.throws(
		() => evaluateNativeMediaPublication(attempt({ declaredByteLength: -1 })),
		/declared byte length/u,
	);
});

function attempt(
	overrides: Partial<NativeMediaPublicationAttemptV1> = {},
): NativeMediaPublicationAttemptV1 {
	return {
		plan: createNativeMediaPublicationPlan({
			jobId: JOB_ID, relativeDestination: 'exports/reel.mp4', planFingerprint: PLAN,
		}),
		outcome: 'completed',
		currentPlanFingerprint: PLAN,
		finalized: true,
		declaredByteLength: 4_096,
		observedByteLength: 4_096,
		declaredSha256: DIGEST,
		observedSha256: DIGEST,
		...overrides,
	};
}

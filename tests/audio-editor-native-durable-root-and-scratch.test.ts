/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertNotOneUseSaveToken,
	createDurableRootGrantV1,
	durableRootGrantIsWritable,
	DurableRootGrantError,
	projectDurableRootGrant,
	resolveDurableRootDestination,
	revalidateDurableRootGrant,
	revokeDurableRootGrant,
	type DurableRootGrantObservationV1,
	type DurableRootGrantV1,
} from '../src/common/editor/native-durable-root-grant.ts';
import {
	computeNativeScratchQuota,
	nativeScratchDirectoryIsDeletable,
	nativeScratchReservationFits,
	nativeScratchRetention,
	nativeScratchRetentionHasElapsed,
	NATIVE_SCRATCH_ABSOLUTE_CAP_BYTES,
	NATIVE_SCRATCH_ABSOLUTE_FREE_BYTES,
	NATIVE_SCRATCH_FAILED_RETENTION_MS,
	NativeScratchPolicyError,
} from '../src/common/editor/native-scratch-policy.ts';

const GIB = 1024 ** 3;
const GRANT_ID = 'ab'.repeat(16);

test('a renderer never receives a granted root path', () => {
	const grant = root();
	const projection = projectDurableRootGrant(grant, 'Exports');

	assert.deepEqual(projection, { grantId: GRANT_ID, displayName: 'Exports', revoked: false });
	assert.equal(Object.hasOwn(projection, 'canonicalPath'), false);
	assert.throws(
		() => projectDurableRootGrant(grant, `Exports (${grant.canonicalPath})`),
		/must not leak its main-private path/u,
	);
	assert.throws(() => projectDurableRootGrant(grant, ''), DurableRootGrantError);
});

test('an expiring one-use save token is never persisted as a durable grant', () => {
	for (const token of [
		{ expiresAtMs: 1_000 },
		{ oneUse: true },
		{ singleUse: true },
		{ saveToken: 'abc' },
		{ expiresAt: 'soon' },
	]) {
		assert.throws(() => assertNotOneUseSaveToken(token), /one-use save token/u);
	}
	assert.doesNotThrow(() => assertNotOneUseSaveToken({ grantId: GRANT_ID }));
	assert.throws(() => createDurableRootGrantV1({
		grantId: GRANT_ID,
		canonicalPath: '/home/user/Exports',
		volumeIdentity: 'volume-1',
		directoryIdentity: 'dev:1|ino:9',
		authorizedAtMs: 0,
		expiresAtMs: 1_000,
	} as never), /one-use save token/u);
});

test('a grant is validated by identity, not by path text', () => {
	const grant = root();

	assert.equal(revalidateDurableRootGrant(grant, observation()), 'valid');
	assert.equal(durableRootGrantIsWritable('valid'), true);

	for (const [overrides, verdict] of [
		[{ exists: false }, 'missing'],
		[{ isDirectory: false }, 'not-a-directory'],
		[{ canonicalPath: '/home/user/Exports2' }, 'moved'],
		[{ directoryIdentity: 'dev:1|ino:10' }, 'identity-changed'],
		[{ volumeIdentity: 'volume-2' }, 'identity-changed'],
	] as const) {
		const actual = revalidateDurableRootGrant(grant, observation(overrides));
		assert.equal(actual, verdict);
		assert.equal(durableRootGrantIsWritable(actual), false);
	}
});

test('a revoked grant is refused even while the directory is still perfectly fine', () => {
	const revoked = revokeDurableRootGrant(root(), 5_000);

	assert.equal(revoked.revokedAtMs, 5_000);
	assert.equal(revalidateDurableRootGrant(revoked, observation()), 'revoked');
	assert.equal(projectDurableRootGrant(revoked, 'Exports').revoked, true);
	assert.throws(() => revokeDurableRootGrant(root(), -1), DurableRootGrantError);
});

test('a destination resolves inside its root and a symlink escape is caught', () => {
	const grant = root();

	assert.equal(
		resolveDurableRootDestination(grant, 'reels/final.mp4'),
		'/home/user/Exports/reels/final.mp4',
	);
	assert.equal(
		resolveDurableRootDestination(grant, 'reels/final.mp4', '/home/user/Exports/reels/final.mp4'),
		'/home/user/Exports/reels/final.mp4',
	);
	// The relative text is clean, but the resolved path left the root.
	assert.throws(
		() => resolveDurableRootDestination(grant, 'reels/final.mp4', '/tmp/elsewhere/final.mp4'),
		/resolved outside its granted root/u,
	);
	assert.throws(() => resolveDurableRootDestination(grant, '../final.mp4'), /traverse/u);
	assert.throws(() => resolveDurableRootDestination(grant, '/final.mp4'), /relative to its granted root/u);
});

test('a Windows root joins with its own separator', () => {
	const grant = createDurableRootGrantV1({
		grantId: GRANT_ID,
		canonicalPath: 'D:\\Media\\Exports',
		volumeIdentity: 'volume-d',
		directoryIdentity: 'volume-d|file-id-9',
		authorizedAtMs: 0,
	});

	assert.equal(
		resolveDurableRootDestination(grant, 'reels/final.mp4'),
		'D:\\Media\\Exports\\reels\\final.mp4',
	);
});

test('a grant requires an absolute, traversal-free path and canonical identities', () => {
	for (const overrides of [
		{ canonicalPath: 'relative/path' },
		{ canonicalPath: '/home/../etc' },
		{ canonicalPath: '' },
		{ grantId: 'short' },
		{ volumeIdentity: 'has spaces' },
	]) {
		assert.throws(() => createDurableRootGrantV1({
			grantId: GRANT_ID,
			canonicalPath: '/home/user/Exports',
			volumeIdentity: 'volume-1',
			directoryIdentity: 'dev:1|ino:9',
			authorizedAtMs: 0,
			...overrides,
		}), DurableRootGrantError, JSON.stringify(overrides));
	}
});

test('the scratch quota is the lesser of the absolute cap and a fifth of the volume', () => {
	const small = computeNativeScratchQuota({
		totalBytes: 200 * GIB, freeBytes: 150 * GIB, managedBytes: 0,
	});
	const large = computeNativeScratchQuota({
		totalBytes: 4_000 * GIB, freeBytes: 3_000 * GIB, managedBytes: 0,
	});

	assert.equal(small.computedCapBytes, 40 * GIB);
	assert.equal(large.computedCapBytes, NATIVE_SCRATCH_ABSOLUTE_CAP_BYTES);
});

test('the free-space floor is the greater of ten gibibytes and a tenth of the volume', () => {
	const small = computeNativeScratchQuota({
		totalBytes: 50 * GIB, freeBytes: 40 * GIB, managedBytes: 0,
	});
	const large = computeNativeScratchQuota({
		totalBytes: 4_000 * GIB, freeBytes: 3_000 * GIB, managedBytes: 0,
	});

	assert.equal(small.requiredFreeBytes, NATIVE_SCRATCH_ABSOLUTE_FREE_BYTES);
	assert.equal(large.requiredFreeBytes, 400 * GIB);
});

test('a user may lower the computed cap but never raise it', () => {
	const lowered = computeNativeScratchQuota({
		totalBytes: 1_000 * GIB, freeBytes: 900 * GIB, managedBytes: 0, userCapBytes: 5 * GIB,
	});
	const raised = computeNativeScratchQuota({
		totalBytes: 1_000 * GIB, freeBytes: 900 * GIB, managedBytes: 0, userCapBytes: 900 * GIB,
	});

	assert.equal(lowered.effectiveCapBytes, 5 * GIB);
	assert.equal(lowered.userLowered, true);
	assert.equal(raised.effectiveCapBytes, NATIVE_SCRATCH_ABSOLUTE_CAP_BYTES);
	assert.equal(raised.userLowered, false);
});

test('available scratch honours both the cap and the free-space floor', () => {
	const capBound = computeNativeScratchQuota({
		totalBytes: 1_000 * GIB, freeBytes: 900 * GIB, managedBytes: 90 * GIB,
	});
	const floorBound = computeNativeScratchQuota({
		totalBytes: 1_000 * GIB, freeBytes: 105 * GIB, managedBytes: 0,
	});
	const exhausted = computeNativeScratchQuota({
		totalBytes: 1_000 * GIB, freeBytes: 50 * GIB, managedBytes: 0,
	});

	assert.equal(capBound.availableBytes, 10 * GIB);
	assert.equal(floorBound.availableBytes, 5 * GIB);
	assert.equal(exhausted.availableBytes, 0);
	assert.equal(nativeScratchReservationFits(capBound, 10 * GIB), true);
	assert.equal(nativeScratchReservationFits(capBound, 10 * GIB + 1), false);
	assert.equal(nativeScratchReservationFits(exhausted, 1), false);
});

test('an impossible volume report is refused rather than clamped', () => {
	assert.throws(() => computeNativeScratchQuota({
		totalBytes: 10 * GIB, freeBytes: 20 * GIB, managedBytes: 0,
	}), /more free bytes than it has/u);
	assert.throws(() => computeNativeScratchQuota({
		totalBytes: -1, freeBytes: 0, managedBytes: 0,
	}), NativeScratchPolicyError);
});

test('successful and cancelled scratch goes immediately, failed scratch waits a week', () => {
	assert.deepEqual(nativeScratchRetention('succeeded', 1_000), {
		removeImmediately: true, retainUntilMs: null,
	});
	assert.deepEqual(nativeScratchRetention('cancelled', 1_000), {
		removeImmediately: true, retainUntilMs: null,
	});
	const failed = nativeScratchRetention('failed', 1_000);
	assert.deepEqual(failed, {
		removeImmediately: false, retainUntilMs: 1_000 + NATIVE_SCRATCH_FAILED_RETENTION_MS,
	});
	assert.equal(nativeScratchRetentionHasElapsed(failed, 1_000), false);
	assert.equal(nativeScratchRetentionHasElapsed(failed, failed.retainUntilMs!), true);
	assert.throws(() => nativeScratchRetention('exploded' as never, 0), NativeScratchPolicyError);
});

test('cleanup deletes only a directory it can prove it owns', () => {
	const expected = {
		jobId: '1a'.repeat(20),
		manifestDigest: 'c'.repeat(64),
		rootIdentity: 'volume-1|scratch',
	};

	assert.equal(nativeScratchDirectoryIsDeletable(expected, { ...expected }), true);
	assert.equal(nativeScratchDirectoryIsDeletable(expected, null), false);
	assert.equal(nativeScratchDirectoryIsDeletable(expected, {}), false);
	for (const key of ['jobId', 'manifestDigest', 'rootIdentity'] as const) {
		assert.equal(
			nativeScratchDirectoryIsDeletable(expected, { ...expected, [key]: 'different' }),
			false,
			key,
		);
	}
});

function root(): DurableRootGrantV1 {
	return createDurableRootGrantV1({
		grantId: GRANT_ID,
		canonicalPath: '/home/user/Exports',
		volumeIdentity: 'volume-1',
		directoryIdentity: 'dev:1|ino:9',
		authorizedAtMs: 0,
	});
}

function observation(
	overrides: Partial<DurableRootGrantObservationV1> = {},
): DurableRootGrantObservationV1 {
	return {
		exists: true,
		isDirectory: true,
		canonicalPath: '/home/user/Exports',
		volumeIdentity: 'volume-1',
		directoryIdentity: 'dev:1|ino:9',
		...overrides,
	};
}

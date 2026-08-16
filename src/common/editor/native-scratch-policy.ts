/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * `ScratchPolicyV1` — how much working space the native tier may take, and when
 * it gives it back.
 *
 * The quota is recomputed at every admission rather than stored, because the
 * volume it describes changes underneath us: a cap that was reasonable when the
 * user had a terabyte free is not reasonable after they filled it. Managed use
 * is capped at the lesser of 100 GiB or a fifth of the volume, and the greater
 * of 10 GiB or a tenth of the volume always stays free — the second rule is
 * what keeps a background render from being the reason the user's machine runs
 * out of disk.
 *
 * A user may lower the computed cap but never raise it. Letting a preference
 * override the volume-derived ceiling would make the safety rule advisory, and
 * the user cannot see from the preferences pane how close the volume is to
 * full.
 *
 * Cleanup is deliberately timid. A directory is removed only when its
 * manager-owned manifest, job id, and root identity all match; anything else is
 * left alone, because scratch lives on a volume that also holds user content.
 */

import { createNativeValidators } from './native-validation.ts';

export const NATIVE_SCRATCH_ABSOLUTE_CAP_BYTES = 100 * 1024 ** 3;
export const NATIVE_SCRATCH_VOLUME_CAP_FRACTION = 0.2;
export const NATIVE_SCRATCH_ABSOLUTE_FREE_BYTES = 10 * 1024 ** 3;
export const NATIVE_SCRATCH_VOLUME_FREE_FRACTION = 0.1;

/** Failed scratch is kept for a week so a retry and a bug report can use it. */
export const NATIVE_SCRATCH_FAILED_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export type NativeScratchOutcome = 'succeeded' | 'cancelled' | 'failed';

export interface NativeScratchQuotaV1 {
	/** The volume-derived ceiling, before any user preference. */
	readonly computedCapBytes: number;
	/** What the policy will actually allow, after a lower-only preference. */
	readonly effectiveCapBytes: number;
	/** Space that must remain free on the volume at all times. */
	readonly requiredFreeBytes: number;
	/** What a new job may reserve right now. */
	readonly availableBytes: number;
	readonly userLowered: boolean;
}

export interface NativeScratchVolumeV1 {
	readonly totalBytes: number;
	readonly freeBytes: number;
	/** Bytes the manager is already holding in scratch on this volume. */
	readonly managedBytes: number;
	/** A user preference. Honoured only when it lowers the computed cap. */
	readonly userCapBytes?: number;
}

export interface NativeScratchRetentionV1 {
	readonly removeImmediately: boolean;
	readonly retainUntilMs: number | null;
}

export interface NativeScratchDirectoryClaimV1 {
	readonly jobId: string;
	readonly manifestDigest: string;
	readonly rootIdentity: string;
}

export class NativeScratchPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NativeScratchPolicyError';
	}
}

const { nonNegativeInteger } = createNativeValidators({
	subject: 'A scratch policy',
	raise: (message: string): never => {
		throw new NativeScratchPolicyError(message);
	},
});

/** Recompute the scratch quota for one volume, as of right now. */
export function computeNativeScratchQuota(volume: NativeScratchVolumeV1): NativeScratchQuotaV1 {
	const totalBytes = nonNegativeInteger(volume.totalBytes, 'totalBytes');
	const freeBytes = nonNegativeInteger(volume.freeBytes, 'freeBytes');
	const managedBytes = nonNegativeInteger(volume.managedBytes, 'managedBytes');
	if (freeBytes > totalBytes) {
		throw new NativeScratchPolicyError('A scratch volume cannot report more free bytes than it has.');
	}
	const computedCapBytes = Math.min(
		NATIVE_SCRATCH_ABSOLUTE_CAP_BYTES,
		Math.floor(totalBytes * NATIVE_SCRATCH_VOLUME_CAP_FRACTION),
	);
	const requiredFreeBytes = Math.max(
		NATIVE_SCRATCH_ABSOLUTE_FREE_BYTES,
		Math.floor(totalBytes * NATIVE_SCRATCH_VOLUME_FREE_FRACTION),
	);
	const userCapBytes = volume.userCapBytes === undefined
		? null
		: nonNegativeInteger(volume.userCapBytes, 'userCapBytes');
	// Lower-only: a preference above the computed ceiling is ignored, not honoured.
	const effectiveCapBytes = userCapBytes === null
		? computedCapBytes
		: Math.min(computedCapBytes, userCapBytes);
	const remainingUnderCap = Math.max(0, effectiveCapBytes - managedBytes);
	const remainingAboveFloor = Math.max(0, freeBytes - requiredFreeBytes);
	return Object.freeze({
		computedCapBytes,
		effectiveCapBytes,
		requiredFreeBytes,
		availableBytes: Math.min(remainingUnderCap, remainingAboveFloor),
		userLowered: userCapBytes !== null && userCapBytes < computedCapBytes,
	});
}

/** Whether one job's declared scratch reservation fits the current quota. */
export function nativeScratchReservationFits(
	quota: NativeScratchQuotaV1,
	requestedBytes: number,
): boolean {
	return nonNegativeInteger(requestedBytes, 'requestedBytes') <= quota.availableBytes;
}

/**
 * When a job's scratch directory may be removed. Successful and cancelled work
 * leaves nothing behind; failed work is retained for a week so a retry and a
 * diagnosis have something to look at.
 */
export function nativeScratchRetention(
	outcome: NativeScratchOutcome,
	settledAtMs: number,
): NativeScratchRetentionV1 {
	const settled = nonNegativeInteger(settledAtMs, 'settledAtMs');
	if (outcome === 'succeeded' || outcome === 'cancelled') {
		return Object.freeze({ removeImmediately: true, retainUntilMs: null });
	}
	if (outcome !== 'failed') {
		throw new NativeScratchPolicyError('A scratch outcome is succeeded, cancelled, or failed.');
	}
	return Object.freeze({
		removeImmediately: false,
		retainUntilMs: settled + NATIVE_SCRATCH_FAILED_RETENTION_MS,
	});
}

export function nativeScratchRetentionHasElapsed(
	retention: NativeScratchRetentionV1,
	nowMs: number,
): boolean {
	if (retention.removeImmediately) return true;
	return retention.retainUntilMs !== null
		&& nonNegativeInteger(nowMs, 'nowMs') >= retention.retainUntilMs;
}

/**
 * Cleanup deletes only what it can prove it owns.
 *
 * All three of the manifest digest, job id, and root identity must match. Any
 * mismatch — including a directory with no manifest at all — is left in place,
 * because the alternative is a background service deleting user content that
 * happened to sit where scratch used to.
 */
export function nativeScratchDirectoryIsDeletable(
	expected: NativeScratchDirectoryClaimV1,
	observed: Partial<NativeScratchDirectoryClaimV1> | null,
): boolean {
	if (!observed) return false;
	return observed.jobId === expected.jobId
		&& observed.manifestDigest === expected.manifestDigest
		&& observed.rootIdentity === expected.rootIdentity;
}

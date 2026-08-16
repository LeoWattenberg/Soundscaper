/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which backend a native media job may attempt, and what happens when it fails.
 *
 * Hardware acceleration is a performance feature layered on a mandatory native
 * CPU path, which is itself layered on the Web Core path. A job therefore plans
 * at most one hardware attempt: if it fails, the job retries once on native CPU
 * with the same semantic plan, and the failing backend is demoted where the
 * user can see it. That single-retry shape is deliberate — a backend that keeps
 * being retried silently is a backend whose failures never become visible.
 *
 * Backend health mirrors the accepted 5.0 supervisor policy exactly: one
 * failure degrades, three failures inside a sixty-second window quarantine, and
 * only an explicit user action clears quarantine.
 */

import {
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
	type NativeMediaCapabilitySnapshotV1,
} from './native-media-capability-snapshot.ts';

export const NATIVE_MEDIA_PLATFORMS = Object.freeze(['win32', 'darwin', 'linux'] as const);

export type NativeMediaPlatform = (typeof NATIVE_MEDIA_PLATFORMS)[number];

export const NATIVE_MEDIA_OPERATIONS = Object.freeze(['decode', 'encode'] as const);

export type NativeMediaOperation = (typeof NATIVE_MEDIA_OPERATIONS)[number];

/** The mandatory native fallback every hardware attempt degrades onto. */
export const NATIVE_MEDIA_CPU_BACKEND = 'native-cpu';

/** The fallback when the native tier itself is unavailable or switched off. */
export const NATIVE_MEDIA_WEB_BACKEND = 'web-core';

export const NATIVE_MEDIA_HARDWARE_BACKENDS = Object.freeze([
	'd3d11va',
	'media-foundation',
	'qsv',
	'nvdec',
	'nvenc',
	'amf',
	'videotoolbox',
	'vaapi',
] as const);

export type NativeMediaHardwareBackend = (typeof NATIVE_MEDIA_HARDWARE_BACKENDS)[number];

/**
 * Candidate backends per platform and operation. Membership here is a claim
 * about what the pinned FFmpeg build could offer, never that it does: the
 * capability snapshot still has to say the build, probe, self-test, licensing
 * row, and user opt-in all agree.
 */
export const NATIVE_MEDIA_BACKEND_CANDIDATES: Readonly<Record<
	NativeMediaPlatform,
	Readonly<Record<NativeMediaOperation, readonly NativeMediaHardwareBackend[]>>
>> = Object.freeze({
	win32: Object.freeze({
		decode: Object.freeze(['d3d11va', 'qsv', 'nvdec'] as const),
		encode: Object.freeze(['media-foundation', 'qsv', 'nvenc', 'amf'] as const),
	}),
	darwin: Object.freeze({
		decode: Object.freeze(['videotoolbox'] as const),
		encode: Object.freeze(['videotoolbox'] as const),
	}),
	linux: Object.freeze({
		decode: Object.freeze(['vaapi', 'qsv', 'nvdec'] as const),
		encode: Object.freeze(['vaapi', 'qsv', 'nvenc', 'amf'] as const),
	}),
});

export type NativeMediaAttemptReason =
	| 'hardware-then-cpu'
	| 'cpu-only'
	| 'web-core-fallback';

export interface NativeMediaBackendPlanV1 {
	readonly platform: NativeMediaPlatform;
	readonly operation: NativeMediaOperation;
	/** Ordered attempts. At most one hardware backend, always CPU-terminated. */
	readonly attempts: readonly string[];
	/** Where the job goes when every listed attempt fails. */
	readonly fallback: typeof NATIVE_MEDIA_WEB_BACKEND;
	readonly reason: NativeMediaAttemptReason;
}

export interface NativeMediaBackendPlanRequestV1 {
	readonly platform: NativeMediaPlatform;
	readonly operation: NativeMediaOperation;
	readonly snapshot: NativeMediaCapabilitySnapshotV1;
	/** User-ordered hardware preference; unknown or unusable entries are skipped. */
	readonly preferredBackends?: readonly string[];
}

export interface NativeMediaBackendHealthV1 {
	readonly backend: string;
	readonly failureTimestamps: readonly number[];
	readonly degraded: boolean;
	readonly quarantined: boolean;
}

/** Mirrors the accepted 5.0 supervisor quarantine policy exactly. */
export const NATIVE_MEDIA_BACKEND_QUARANTINE_FAILURE_LIMIT = 3;
export const NATIVE_MEDIA_BACKEND_QUARANTINE_WINDOW_MS = 60_000;

export class NativeMediaBackendPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NativeMediaBackendPolicyError';
	}
}

/**
 * Plan the ordered backend attempts for one job.
 *
 * The native CPU path must be usable for any native attempt at all: hardware is
 * never allowed to be the only way a job can run, because a hardware failure
 * has to have somewhere truthful to land.
 */
export function resolveNativeMediaBackendPlan(
	request: NativeMediaBackendPlanRequestV1,
): NativeMediaBackendPlanV1 {
	const platform = assertPlatform(request.platform);
	const operation = assertOperation(request.operation);
	const snapshot = request.snapshot;
	const cpuUsable = isNativeMediaCapabilityUsable(
		nativeMediaCapabilityEntry(snapshot, 'backend', NATIVE_MEDIA_CPU_BACKEND),
	) && isNativeMediaCapabilityUsable(
		nativeMediaCapabilityEntry(snapshot, 'operation', operation),
	);
	if (!snapshot.masterEnabled || !cpuUsable) {
		return plan(platform, operation, [], 'web-core-fallback');
	}
	const candidates = NATIVE_MEDIA_BACKEND_CANDIDATES[platform][operation];
	const preferred = request.preferredBackends ?? candidates;
	const hardware = preferred.find((backend) => (
		(candidates as readonly string[]).includes(backend)
		&& isNativeMediaCapabilityUsable(nativeMediaCapabilityEntry(snapshot, 'backend', backend))
	)) ?? null;
	return hardware === null
		? plan(platform, operation, [NATIVE_MEDIA_CPU_BACKEND], 'cpu-only')
		: plan(platform, operation, [hardware, NATIVE_MEDIA_CPU_BACKEND], 'hardware-then-cpu');
}

/** The backend a failed attempt hands the job to, without changing its plan. */
export function nativeMediaBackendAfterFailure(
	backendPlan: NativeMediaBackendPlanV1,
	failedBackend: string,
): string {
	const index = backendPlan.attempts.indexOf(failedBackend);
	if (index < 0) {
		throw new NativeMediaBackendPolicyError('A native media backend failure names a backend the plan never attempted.');
	}
	return backendPlan.attempts[index + 1] ?? backendPlan.fallback;
}

export function createNativeMediaBackendHealth(backend: string): NativeMediaBackendHealthV1 {
	return Object.freeze({
		backend: assertBackendId(backend),
		failureTimestamps: Object.freeze([]),
		degraded: false,
		quarantined: false,
	});
}

/**
 * Record one hardware failure. The first failure degrades the backend; three
 * inside the window quarantine it. Timestamps outside the window are dropped so
 * a machine that fails once a day never accumulates its way into quarantine.
 */
export function recordNativeMediaBackendFailure(
	health: NativeMediaBackendHealthV1,
	timestampMs: number,
): NativeMediaBackendHealthV1 {
	if (!Number.isFinite(timestampMs)) {
		throw new NativeMediaBackendPolicyError('A native media backend failure requires a finite timestamp.');
	}
	const cutoff = timestampMs - NATIVE_MEDIA_BACKEND_QUARANTINE_WINDOW_MS;
	const failureTimestamps = Object.freeze([
		...health.failureTimestamps.filter((value) => value > cutoff),
		timestampMs,
	]);
	return Object.freeze({
		backend: health.backend,
		failureTimestamps,
		degraded: true,
		quarantined: health.quarantined
			|| failureTimestamps.length >= NATIVE_MEDIA_BACKEND_QUARANTINE_FAILURE_LIMIT,
	});
}

/** Explicit user action is the only path out of quarantine, as in 5.0. */
export function clearNativeMediaBackendQuarantine(
	health: NativeMediaBackendHealthV1,
): NativeMediaBackendHealthV1 {
	return Object.freeze({
		backend: health.backend,
		failureTimestamps: Object.freeze([]),
		degraded: false,
		quarantined: false,
	});
}

function plan(
	platform: NativeMediaPlatform,
	operation: NativeMediaOperation,
	attempts: readonly string[],
	reason: NativeMediaAttemptReason,
): NativeMediaBackendPlanV1 {
	return Object.freeze({
		platform,
		operation,
		attempts: Object.freeze([...attempts]),
		fallback: NATIVE_MEDIA_WEB_BACKEND,
		reason,
	});
}

function assertPlatform(value: unknown): NativeMediaPlatform {
	if (typeof value !== 'string' || !(NATIVE_MEDIA_PLATFORMS as readonly string[]).includes(value)) {
		throw new NativeMediaBackendPolicyError('A native media backend plan must name a qualifying platform.');
	}
	return value as NativeMediaPlatform;
}

function assertOperation(value: unknown): NativeMediaOperation {
	if (typeof value !== 'string' || !(NATIVE_MEDIA_OPERATIONS as readonly string[]).includes(value)) {
		throw new NativeMediaBackendPolicyError('A native media backend plan must name a supported operation.');
	}
	return value as NativeMediaOperation;
}

function assertBackendId(value: unknown): string {
	if (value !== NATIVE_MEDIA_CPU_BACKEND
		&& !(NATIVE_MEDIA_HARDWARE_BACKENDS as readonly unknown[]).includes(value)) {
		throw new NativeMediaBackendPolicyError('A native media backend health record must name a known backend.');
	}
	return value as string;
}

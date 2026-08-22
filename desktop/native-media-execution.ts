/* SPDX-License-Identifier: AGPL-3.0-only */

/** One hardware attempt, one native-CPU retry, then an explicit Web fallback. */

import {
	NATIVE_MEDIA_CPU_BACKEND,
	NATIVE_MEDIA_HARDWARE_BACKENDS,
	NATIVE_MEDIA_WEB_BACKEND,
	type NativeMediaBackendPlanV1,
} from '../src/common/editor/native-media-backend-policy.ts';
import type {
	NativeMediaHelperPoolJobRequest,
} from './native-media-helper-pool.ts';

export const NATIVE_MEDIA_EXECUTION_JOB_KINDS = Object.freeze([
	'media-decode', 'media-encode', 'media-render', 'media-proxy',
] as const);

export type NativeMediaExecutionJobKind =
	(typeof NATIVE_MEDIA_EXECUTION_JOB_KINDS)[number];

export interface NativeMediaExecutionPoolPort {
	runJob(request: NativeMediaHelperPoolJobRequest): Promise<unknown>;
}

export interface NativeMediaExecutionAttempt {
	readonly planFingerprint: string;
	readonly request: NativeMediaHelperPoolJobRequest;
}

export interface NativeMediaExecutionFailure {
	readonly backend: string;
	readonly message: string;
}

export type NativeMediaExecutionResult =
	| Readonly<{
		readonly outcome: 'native';
		readonly backend: string;
		readonly result: unknown;
		readonly failures: readonly NativeMediaExecutionFailure[];
	}>
	| Readonly<{
		readonly outcome: 'web-core-fallback';
		readonly failures: readonly NativeMediaExecutionFailure[];
	}>;

export type NativeMediaExecutionFailureCause =
	| 'backend-plan-invalid'
	| 'operation-mismatch'
	| 'plan-mismatch';

export class NativeMediaExecutionError extends Error {
	readonly cause_: NativeMediaExecutionFailureCause;

	constructor(cause: NativeMediaExecutionFailureCause, message: string) {
		super(message);
		this.name = 'NativeMediaExecutionError';
		this.cause_ = cause;
	}
}

export interface NativeMediaExecutionRequest {
	readonly kind: NativeMediaExecutionJobKind;
	readonly planFingerprint: string;
	readonly backendPlan: NativeMediaBackendPlanV1;
	readonly pool: NativeMediaExecutionPoolPort;
	readonly createAttempt: (backend: string) => NativeMediaExecutionAttempt;
	readonly onHardwareFailure?: (backend: string, error: Error) => void;
}

const SHA256 = /^[a-f\d]{64}$/u;

export async function executeNativeMediaWithCpuFallback(
	request: NativeMediaExecutionRequest,
): Promise<NativeMediaExecutionResult> {
	const kind = operationKind(request.kind);
	const fingerprint = planFingerprint(request.planFingerprint);
	const attempts = backendAttempts(request.backendPlan);
	const failures: NativeMediaExecutionFailure[] = [];
	for (const backend of attempts) {
		if (backend !== NATIVE_MEDIA_CPU_BACKEND) {
			const error = new Error(
				`Native media hardware backend ${backend} has no authenticated helper grant.`,
			);
			failures.push(Object.freeze({ backend, message: error.message }));
			request.onHardwareFailure?.(backend, error);
			continue;
		}
		const attempt = request.createAttempt(backend);
		if (planFingerprint(attempt.planFingerprint) !== fingerprint) {
			throw new NativeMediaExecutionError(
				'plan-mismatch',
				'A native media CPU fallback cannot change the canonical plan fingerprint.',
			);
		}
		if (attempt.request.kind !== kind) {
			throw new NativeMediaExecutionError(
				'operation-mismatch',
				'A native media backend attempt cannot change its closed operation kind.',
			);
		}
		try {
			const result = await request.pool.runJob(attempt.request);
			return Object.freeze({
				outcome: 'native',
				backend,
				result,
				failures: Object.freeze([...failures]),
			});
		} catch (error) {
			if (attempt.request.signal?.aborted) throw error;
			const admittedError = error instanceof Error ? error : new Error(String(error));
			failures.push(Object.freeze({ backend, message: admittedError.message }));
		}
	}
	return Object.freeze({
		outcome: 'web-core-fallback',
		failures: Object.freeze(failures),
	});
}

function operationKind(value: unknown): NativeMediaExecutionJobKind {
	if (!(NATIVE_MEDIA_EXECUTION_JOB_KINDS as readonly unknown[]).includes(value)) {
		throw new NativeMediaExecutionError(
			'operation-mismatch',
			'A native media execution must name the closed decode, encode, render, or proxy operation.',
		);
	}
	return value as NativeMediaExecutionJobKind;
}

function planFingerprint(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new NativeMediaExecutionError(
			'plan-mismatch',
			'A native media execution requires an exact lowercase SHA-256 plan fingerprint.',
		);
	}
	return value;
}

function backendAttempts(plan: NativeMediaBackendPlanV1): readonly string[] {
	if (plan.fallback !== NATIVE_MEDIA_WEB_BACKEND || !Array.isArray(plan.attempts)
		|| plan.attempts.length > 2) {
		throw invalidBackendPlan();
	}
	if (plan.attempts.length === 0) return Object.freeze([]);
	if (plan.attempts.at(-1) !== NATIVE_MEDIA_CPU_BACKEND) {
		throw new NativeMediaExecutionError(
			'backend-plan-invalid',
			'A native media backend plan must terminate in native CPU before Web Core.',
		);
	}
	if (plan.attempts.length === 2
		&& (!(NATIVE_MEDIA_HARDWARE_BACKENDS as readonly string[]).includes(plan.attempts[0]!)
			|| plan.attempts[0] === plan.attempts[1])) {
		throw invalidBackendPlan();
	}
	return Object.freeze([...plan.attempts]);
}

function invalidBackendPlan(): NativeMediaExecutionError {
	return new NativeMediaExecutionError(
		'backend-plan-invalid',
		'A native media backend plan admits at most one known hardware attempt and one native CPU fallback.',
	);
}

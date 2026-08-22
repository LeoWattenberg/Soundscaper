/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	executeNativeMediaWithCpuFallback,
	NativeMediaExecutionError,
	type NativeMediaExecutionPoolPort,
} from '../desktop/native-media-execution.ts';
import type { NativeMediaBackendPlanV1 } from '../src/common/editor/native-media-backend-policy.ts';

const PLAN = 'a'.repeat(64);

test('an unauthenticated hardware backend is skipped before one native-CPU attempt', async () => {
	const attempts: string[] = [];
	const degraded: string[] = [];
	const result = await executeNativeMediaWithCpuFallback({
		kind: 'media-render',
		planFingerprint: PLAN,
		backendPlan: plan(['nvenc', 'native-cpu']),
		pool: pool(async () => {
			return { digest: 'native-cpu-output' };
		}),
		createAttempt: (backend) => {
			attempts.push(backend);
			return { planFingerprint: PLAN, request: { kind: 'media-render', grant: {} as never } };
		},
		onHardwareFailure: (backend) => { degraded.push(backend); },
	});

	assert.deepEqual(attempts, ['native-cpu']);
	assert.deepEqual(degraded, ['nvenc']);
	assert.deepEqual(result, {
		outcome: 'native', backend: 'native-cpu', result: { digest: 'native-cpu-output' },
		failures: [{
			backend: 'nvenc',
			message: 'Native media hardware backend nvenc has no authenticated helper grant.',
		}],
	});
});

test('an attempt cannot change the canonical plan fingerprint during CPU fallback', async () => {
	let calls = 0;
	await assert.rejects(executeNativeMediaWithCpuFallback({
		kind: 'media-encode',
		planFingerprint: PLAN,
		backendPlan: plan(['qsv', 'native-cpu']),
		pool: pool(async () => { calls += 1; throw new Error('backend failure'); }),
		createAttempt: (backend) => ({
			planFingerprint: backend === 'qsv' ? PLAN : 'b'.repeat(64),
			request: { kind: 'media-encode', grant: {} as never } as never,
		}),
	}), (error: unknown) => error instanceof NativeMediaExecutionError && error.cause_ === 'plan-mismatch');
	assert.equal(calls, 0);
});

test('complete native failure reports explicit Web Core fallback', async () => {
	const result = await executeNativeMediaWithCpuFallback({
		kind: 'media-decode',
		planFingerprint: PLAN,
		backendPlan: plan(['vaapi', 'native-cpu']),
		pool: pool(async () => { throw new Error('unavailable'); }),
		createAttempt: () => ({
			planFingerprint: PLAN,
			request: { kind: 'media-decode', grant: {} as never } as never,
		}),
	});
	assert.deepEqual(result, {
		outcome: 'web-core-fallback',
		failures: [
			{
				backend: 'vaapi',
				message: 'Native media hardware backend vaapi has no authenticated helper grant.',
			},
			{ backend: 'native-cpu', message: 'unavailable' },
		],
	});
});

test('a disabled native plan falls through without constructing a helper request', async () => {
	let created = 0;
	const result = await executeNativeMediaWithCpuFallback({
		kind: 'media-proxy',
		planFingerprint: PLAN,
		backendPlan: plan([]),
		pool: pool(async () => { throw new Error('must not run'); }),
		createAttempt: () => { created += 1; throw new Error('must not construct'); },
	});
	assert.deepEqual(result, { outcome: 'web-core-fallback', failures: [] });
	assert.equal(created, 0);
});

test('malformed backend plans and non-media operation kinds fail closed', async () => {
	const base = {
		planFingerprint: PLAN,
		pool: pool(async () => undefined),
		createAttempt: () => ({ planFingerprint: PLAN, request: { kind: 'media-render', grant: {} as never } as never }),
	};
	await assert.rejects(executeNativeMediaWithCpuFallback({
		...base, kind: 'media-render', backendPlan: plan(['qsv']),
	}), /terminate in native CPU/u);
	await assert.rejects(executeNativeMediaWithCpuFallback({
		...base, kind: 'probe-video-source' as never, backendPlan: plan(['native-cpu']),
	}), /closed decode, encode, render, or proxy/u);
});

function plan(attempts: readonly string[]): NativeMediaBackendPlanV1 {
	return {
		platform: 'linux', operation: 'encode', attempts,
		fallback: 'web-core', reason: attempts.length === 0 ? 'web-core-fallback' : 'cpu-only',
	};
}

function pool(runJob: NativeMediaExecutionPoolPort['runJob']): NativeMediaExecutionPoolPort {
	return { runJob };
}

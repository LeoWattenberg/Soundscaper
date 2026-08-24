/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNativeV14QueueReservationAuthority,
	framescaperNativeV14BackendPlanForRecord,
} from '../desktop/native-services-v14-backend-authority.ts';

test('main binds one immutable OS hardware reservation and execution consumes only that row', () => {
	let enabled = true;
	const reserve = createFramescaperNativeV14QueueReservationAuthority({
		platform: 'linux', hardwareEncodeEnabled: () => enabled,
	});
	const rendererRequest = request('encoded-export', 'nvenc');
	const admitted = reserve(rendererRequest);
	assert.equal(admitted.hardwareBackend, 'vaapi', 'renderer-supplied backend is never authority');
	enabled = false;
	assert.deepEqual(framescaperNativeV14BackendPlanForRecord({
		taskKind: 'encoded-export', reservations: admitted,
	}, 'linux').attempts, ['vaapi', 'native-cpu'], 'later preference changes do not rewrite a queued job');
	assert.equal(reserve(request('encoded-export', 'nvenc')).hardwareBackend, null);
	assert.equal(reserve(request('proxy-generation', 'vaapi')).hardwareBackend, null,
		'CPU-only proxy work cannot occupy a hardware capacity reservation');
});

test('dispatch honours the current hardware opt-in over the persisted reservation', () => {
	const record = Object.freeze({ taskKind: 'encoded-export' as const, reservations: reservations('vaapi') });
	assert.deepEqual(framescaperNativeV14BackendPlanForRecord(record, 'linux', true).attempts,
		['vaapi', 'native-cpu']);
	// The durable row keeps its reservation, but runtime capability is the
	// intersection with the user's current opt-in: a preference turned off
	// after enqueue must not hand the helper a hardware grant at dispatch.
	const disabled = framescaperNativeV14BackendPlanForRecord(record, 'linux', false);
	assert.deepEqual(disabled.attempts, ['native-cpu']);
	assert.equal(disabled.reason, 'cpu-only');
});

test('execution refuses a persisted backend outside the exact platform baseline', () => {
	assert.throws(() => framescaperNativeV14BackendPlanForRecord({
		taskKind: 'encoded-export', reservations: reservations('nvenc'),
	}, 'linux'), /not the selected V14 OS baseline/u);
});

function request(taskKind: 'encoded-export' | 'proxy-generation', hardwareBackend: string | null) {
	return Object.freeze({
		planVersion: 14 as const, taskKind,
		reservations: reservations(hardwareBackend),
	});
}

function reservations(hardwareBackend: string | null) {
	return Object.freeze({
		cpuCores: 2, processTreeRssBytes: 4 * 1_024 ** 3,
		scratchBytes: 32 * 1_024 ** 3, minimumFreeBytes: 10 * 1_024 ** 3,
		hardwareBackend,
	});
}

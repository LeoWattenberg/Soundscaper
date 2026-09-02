/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createParameterAutomationControlRouterV21,
} from '../src/common/editor/parameter-automation-control-router-v21.ts';

const ADDRESS = Object.freeze({
	kind: 'strip' as const,
	strip: Object.freeze({ kind: 'track' as const, id: 'voice' }),
	parameterId: 'gain' as const,
});
const PROJECT = Object.freeze({
	automationLanes: Object.freeze([Object.freeze({ id: 'gain-lane', address: ADDRESS })]),
});

test('the control router owns one continuous matching gesture and suppresses static mutation', () => {
	const calls: unknown[][] = [];
	const runtime = {
		snapshot: { mode: 'touch' as const, laneId: 'gain-lane', gestureActive: false },
		setMode: () => undefined,
		beginGesture: (laneId: string, value: number) => {
			calls.push(['begin', laneId, value]);
			return Object.freeze({ id: 'gesture' });
		},
		previewGesture: (token: unknown, value: number) => { calls.push(['preview', token, value]); },
		releaseGesture: (token: unknown, value?: number) => { calls.push(['release', token, value]); },
		cancelGesture: (token?: unknown) => { calls.push(['cancel', token]); },
	};
	const router = createParameterAutomationControlRouterV21({ runtime, project: PROJECT });

	assert.equal(router.captureAvailable(ADDRESS), true);
	assert.equal(router.begin(ADDRESS, 1), true);
	assert.equal(router.owns(ADDRESS), true);
	assert.equal(router.preview(ADDRESS, 0.5), true);
	assert.equal(router.release(ADDRESS, 0.5), true);
	assert.equal(router.owns(ADDRESS), false);
	assert.deepEqual(calls, [
		['begin', 'gain-lane', 1],
		['preview', { id: 'gesture' }, 0.5],
		['release', { id: 'gesture' }, 0.5],
	]);
});

test('an atomic matching control writes automation while unmatched and Read controls fall through', () => {
	const calls: unknown[][] = [];
	const errors: unknown[] = [];
	const runtime = {
		snapshot: { mode: 'write' as const, laneId: 'gain-lane', gestureActive: false },
		setMode: () => undefined,
		beginGesture: (_laneId: string, value: number) => ({ value }),
		previewGesture: (_token: unknown, value: number) => { calls.push(['preview', value]); },
		releaseGesture: (_token: unknown, value?: number) => { calls.push(['release', value]); },
	};
	const router = createParameterAutomationControlRouterV21({
		runtime,
		project: PROJECT,
		onError: (error) => errors.push(error),
	});

	assert.equal(router.performAtomic(ADDRESS, 0), true);
	assert.deepEqual(calls, [['preview', 0], ['release', 0]]);
	assert.equal(router.performAtomic({ ...ADDRESS, parameterId: 'pan' }, 0), false);
	router.setContext({
		runtime: { ...runtime, snapshot: { ...runtime.snapshot, mode: 'read' as const } },
		project: PROJECT,
		onError: (error) => errors.push(error),
	});
	assert.equal(router.performAtomic(ADDRESS, 1), false);
	assert.deepEqual(errors, []);
});

test('a rejected matching begin remains reserved and cannot leak into a static update', () => {
	const failure = new Error('stale automation authority');
	const errors: unknown[] = [];
	const runtime = {
		snapshot: { mode: 'touch' as const, laneId: 'gain-lane', gestureActive: false },
		setMode: () => undefined,
		beginGesture: () => { throw failure; },
	};
	const router = createParameterAutomationControlRouterV21({
		runtime,
		project: PROJECT,
		onError: (error) => errors.push(error),
	});

	assert.equal(router.begin(ADDRESS, 1), false);
	assert.equal(router.captureAvailable(ADDRESS), true);
	assert.equal(router.performAtomic(ADDRESS, 1), true);
	assert.deepEqual(errors, [failure, failure]);
});

test('a rejected release is cancelled and does not wedge the control router', async () => {
	const calls: unknown[][] = [];
	const failure = new Error('release refused');
	const errors: unknown[] = [];
	let generation = 0;
	const runtime = {
		snapshot: { mode: 'touch' as const, laneId: 'gain-lane', gestureActive: false },
		setMode: () => undefined,
		beginGesture: () => ({ generation: generation += 1 }),
		releaseGesture: (token: unknown) => {
			calls.push(['release', token]);
			return Promise.reject(failure);
		},
		cancelGesture: (token?: unknown) => { calls.push(['cancel', token]); },
	};
	const router = createParameterAutomationControlRouterV21({
		runtime,
		project: PROJECT,
		onError: (error) => errors.push(error),
	});

	assert.equal(router.begin(ADDRESS, 1), true);
	assert.equal(router.release(ADDRESS, 0.5), true);
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(router.owns(ADDRESS), false);
	assert.equal(router.begin(ADDRESS, 0.75), true);
	assert.deepEqual(calls, [
		['release', { generation: 1 }],
		['cancel', { generation: 1 }],
	]);
	assert.deepEqual(errors, [failure]);
});

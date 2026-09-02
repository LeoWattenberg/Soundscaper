/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	beginParameterAutomationGestureV21,
	cancelParameterAutomationGestureV21,
	parameterAutomationCaptureAvailableV21,
	previewParameterAutomationGestureV21,
	releaseParameterAutomationGestureV21,
} from '../src/common/editor/parameter-automation-gesture-adapter-v21.ts';
import type { TrackAutomationTargetV21 } from '../src/common/editor/track-automation-targets-v21.ts';

const address = Object.freeze({
	kind: 'effect' as const,
	strip: Object.freeze({ kind: 'track' as const, id: 'voice' }),
	effectId: 'compressor',
	parameterId: 'threshold',
});
const target = {
	key: JSON.stringify(['effect', ['track', 'voice'], 'compressor', null, 'threshold']),
	address,
	lane: { id: 'threshold-lane' },
} as unknown as TrackAutomationTargetV21;

test('the parameter adapter captures only the selected canonical address in a write mode', () => {
	const calls: unknown[][] = [];
	const runtime = {
		snapshot: { mode: 'touch' as const, laneId: 'threshold-lane', gestureActive: false },
		setMode: () => undefined,
		beginGesture: (laneId: string, value: number) => {
			calls.push(['begin', laneId, value]);
			return { id: 'token' };
		},
		previewGesture: (token: unknown, value: number) => { calls.push(['preview', token, value]); },
		releaseGesture: (token: unknown, value?: number) => { calls.push(['release', token, value]); },
		cancelGesture: (token?: unknown) => { calls.push(['cancel', token]); },
	};
	assert.equal(parameterAutomationCaptureAvailableV21({ runtime, target, address }), true);
	assert.equal(parameterAutomationCaptureAvailableV21({
		runtime,
		target,
		address: { ...address, parameterId: 'ratio' },
	}), false);

	const session = beginParameterAutomationGestureV21({ runtime, target, address }, -18);
	assert.ok(session);
	previewParameterAutomationGestureV21(session, -20);
	releaseParameterAutomationGestureV21(session, -20);
	assert.deepEqual(calls, [
		['begin', 'threshold-lane', -18],
		['preview', { id: 'token' }, -20],
		['release', { id: 'token' }, -20],
	]);
});

test('read mode and absent lanes fall through while cancellation retains the originating runtime', () => {
	const calls: unknown[][] = [];
	const runtime = {
		snapshot: { mode: 'write' as const, laneId: 'threshold-lane', gestureActive: false },
		setMode: () => undefined,
		beginGesture: () => 'token',
		cancelGesture: (token?: unknown) => { calls.push(['cancel', token]); },
	};
	const session = beginParameterAutomationGestureV21({ runtime, target, address }, -12);
	assert.ok(session);
	cancelParameterAutomationGestureV21(session);
	assert.deepEqual(calls, [['cancel', 'token']]);
	assert.equal(parameterAutomationCaptureAvailableV21({
		runtime: { ...runtime, snapshot: { ...runtime.snapshot, mode: 'read' as const } },
		target,
		address,
	}), false);
	assert.equal(parameterAutomationCaptureAvailableV21({
		runtime,
		target: { ...target, lane: null },
		address,
	}), false);
});

test('matching controls can resolve the active lane directly from the project', () => {
	const calls: unknown[][] = [];
	const runtime = {
		snapshot: { mode: 'latch' as const, laneId: 'threshold-lane', gestureActive: false },
		setMode: () => undefined,
		beginGesture: (laneId: string, value: number) => {
			calls.push(['begin', laneId, value]);
			return 'project-token';
		},
	};
	const project = { automationLanes: [{ id: 'threshold-lane', address }] };
	assert.equal(parameterAutomationCaptureAvailableV21({ runtime, project, address }), true);
	assert.equal(parameterAutomationCaptureAvailableV21({
		runtime, project, address: { ...address, parameterId: 'ratio' },
	}), false);
	assert.ok(beginParameterAutomationGestureV21({ runtime, project, address }, -9));
	assert.deepEqual(calls, [['begin', 'threshold-lane', -9]]);
});

test('a rejected release leaves its session active so it can be cancelled', async () => {
	const calls: unknown[][] = [];
	const runtime = {
		snapshot: { mode: 'touch' as const, laneId: 'threshold-lane', gestureActive: false },
		setMode: () => undefined,
		beginGesture: () => 'token',
		releaseGesture: () => Promise.reject(new Error('stale release')),
		cancelGesture: (token?: unknown) => { calls.push(['cancel', token]); },
	};
	const session = beginParameterAutomationGestureV21({ runtime, target, address }, -12);
	assert.ok(session);
	await assert.rejects(async () => {
		await Promise.resolve(releaseParameterAutomationGestureV21(session, -14));
	}, /stale release/u);
	cancelParameterAutomationGestureV21(session);
	assert.deepEqual(calls, [['cancel', 'token']]);
});

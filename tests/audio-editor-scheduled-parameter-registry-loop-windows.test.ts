/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import {
	ScheduledParameterRegistry,
	type ScheduledParameterEvent,
	type ScheduledParameterTarget,
} from '../src/common/editor/engine/scheduled-parameter-registry.ts';

const TRACK = Object.freeze({ kind: 'track' as const, id: 'track-1' });
const SAMPLE_RATE = 48_000;
const LOOP_FRAMES = 9_600;

/**
 * One loop iteration as the V21 lane scheduler compiles it: the leading set at
 * the loop start and the closing ramp at the loop end.
 */
const LOOP_WINDOW_EVENTS: readonly ScheduledParameterEvent[] = Object.freeze([
	Object.freeze({ kind: 'set' as const, frame: 0, value: 0 }),
	Object.freeze({ kind: 'linear' as const, frame: LOOP_FRAMES, value: 1 }),
]);

interface AudioParamCall {
	readonly kind: 'cancel' | 'set' | 'linear';
	readonly value?: number;
	readonly time: number;
}

function mockAudioParam(): AudioParam & { readonly calls: AudioParamCall[] } {
	const calls: AudioParamCall[] = [];
	return {
		calls,
		value: 1,
		defaultValue: 1,
		minValue: 0,
		maxValue: 4,
		automationRate: 'a-rate',
		cancelAndHoldAtTime: () => undefined,
		cancelScheduledValues: (time: number) => { calls.push({ kind: 'cancel', time }); },
		exponentialRampToValueAtTime: () => undefined,
		linearRampToValueAtTime: (value: number, time: number) => {
			calls.push({ kind: 'linear', value, time });
			return undefined as unknown as AudioParam;
		},
		setTargetAtTime: () => undefined,
		setValueAtTime: (value: number, time: number) => {
			calls.push({ kind: 'set', value, time });
			return undefined as unknown as AudioParam;
		},
		setValueCurveAtTime: () => undefined,
	} as unknown as AudioParam & { readonly calls: AudioParamCall[] };
}

function gainTarget(latencyFrames = 0): Readonly<{
	param: AudioParam & { readonly calls: AudioParamCall[] };
	target: ScheduledParameterTarget;
}> {
	const registry = new ScheduledParameterRegistry();
	const descriptor = stripParameterDescriptor({
		kind: 'strip', strip: TRACK, parameterId: 'gain',
	}, latencyFrames);
	const param = mockAudioParam();
	return { param, target: registry.registerAudioParam(descriptor, param) };
}

function scheduleLoopWindow(target: ScheduledParameterTarget, contextStartTime: number): void {
	target.schedule(LOOP_WINDOW_EVENTS, {
		fromFrame: 0,
		contextStartTime,
		sampleRate: SAMPLE_RATE,
		contextSampleRate: SAMPLE_RATE,
		transportRate: 1,
	});
}

test('a contiguous loop-ahead window keeps the previous iteration closing ramp', () => {
	const { param, target } = gainTarget();

	scheduleLoopWindow(target, 1);
	assert.deepEqual(param.calls, [
		{ kind: 'cancel', time: 1 },
		{ kind: 'set', value: 0, time: 1 },
		{ kind: 'linear', value: 1, time: 1.2 },
	]);

	const firstWindowCalls = param.calls.length;
	scheduleLoopWindow(target, 1.2);
	assert.deepEqual(
		param.calls.slice(firstWindowCalls),
		[
			{ kind: 'set', value: 0, time: 1.2 },
			{ kind: 'linear', value: 1, time: 1.4 },
		],
		'the next loop iteration must not cancel at the previous ramp end',
	);
});

test('a latency-shifted contiguous window keeps the previous iteration closing ramp', () => {
	const { param, target } = gainTarget(32);

	scheduleLoopWindow(target, 1);
	assert.deepEqual(param.calls, [
		{ kind: 'cancel', time: 1.000_666_666_666_666_6 },
		{ kind: 'set', value: 0, time: 1.000_666_666_666_666_6 },
		{ kind: 'linear', value: 1, time: 1.200_666_666_666_666_8 },
	]);

	// The next window starts at (1 + 0.2) + 32/48000, which rounds one ulp below
	// the previous closing ramp at 1 + (32/48000 + 0.2).
	const firstWindowCalls = param.calls.length;
	scheduleLoopWindow(target, 1.2);
	assert.deepEqual(
		param.calls.slice(firstWindowCalls).filter(({ kind }) => kind === 'cancel'),
		[],
		'sub-sample float drift at the loop boundary must not cancel the closing ramp',
	);
});

test('a window overlapping already scheduled events still cancels them', () => {
	const { param, target } = gainTarget();

	scheduleLoopWindow(target, 1);
	const firstWindowCalls = param.calls.length;
	scheduleLoopWindow(target, 1.1);
	assert.deepEqual(param.calls.slice(firstWindowCalls), [
		{ kind: 'cancel', time: 1.1 },
		{ kind: 'set', value: 0, time: 1.1 },
		{ kind: 'linear', value: 1, time: 1.3 },
	]);

	// The re-scheduled window now owns the timeline through 1.3, so a further
	// window that lands inside it cancels in turn.
	const secondWindowCalls = param.calls.length;
	scheduleLoopWindow(target, 1.2);
	assert.deepEqual(
		param.calls.slice(secondWindowCalls).filter(({ kind }) => kind === 'cancel'),
		[{ kind: 'cancel', time: 1.2 }],
	);
});

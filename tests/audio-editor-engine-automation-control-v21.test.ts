/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import {
	scheduleAutomationControlPreviewV21,
} from '../src/common/editor/engine/automation-control-v21.ts';
import { ScheduledParameterRegistry } from '../src/common/editor/engine/scheduled-parameter-registry.ts';

const ADDRESS = Object.freeze({
	kind: 'strip' as const,
	strip: Object.freeze({ kind: 'track' as const, id: 'voice' }),
	parameterId: 'gain' as const,
});

test('live automation preview schedules one native value through the active latency-owned target', () => {
	const registry = new ScheduledParameterRegistry();
	const calls: unknown[][] = [];
	const parameter = {
		value: 1, defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'a-rate',
		cancelAndHoldAtTime: () => undefined,
		cancelScheduledValues: (time: number) => { calls.push(['cancel', time]); },
		exponentialRampToValueAtTime: () => undefined,
		linearRampToValueAtTime: () => undefined,
		setTargetAtTime: () => undefined,
		setValueAtTime: (value: number, time: number) => { calls.push(['set', value, time]); },
		setValueCurveAtTime: () => undefined,
	} as unknown as AudioParam;
	registry.registerAudioParam(stripParameterDescriptor(ADDRESS, 48), parameter);
	assert.equal(scheduleAutomationControlPreviewV21({
		graph: { parameterRegistry: registry },
		context: { currentTime: 2, sampleRate: 48_000 },
		address: ADDRESS,
		value: 0.25,
		projectFrame: 9_600,
		projectSampleRate: 48_000,
		transportRate: 1,
	}), true);
	assert.deepEqual(calls, [
		['cancel', 2.001],
		['set', 0.25, 2.001],
	]);
});

test('live automation preview is inert without an active graph or registered target', () => {
	const registry = new ScheduledParameterRegistry();
	const base = {
		context: { currentTime: 0, sampleRate: 48_000 },
		address: ADDRESS,
		value: 1,
		projectFrame: 0,
		projectSampleRate: 48_000,
		transportRate: 1,
	};
	assert.equal(scheduleAutomationControlPreviewV21({ ...base, graph: null }), false);
	assert.equal(scheduleAutomationControlPreviewV21({
		...base, graph: { parameterRegistry: registry },
	}), false);
});

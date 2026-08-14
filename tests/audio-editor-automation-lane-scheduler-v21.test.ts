/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	compileAutomationLaneEventsV21,
	scheduleAutomationLaneV21,
} from '../src/common/editor/engine/automation-lane-scheduler-v21.ts';
import { canonicalParameterAddressKey, type ParameterAddress } from '../src/common/editor/parameter-address.ts';
import {
	ScheduledParameterRegistry,
	type ScheduledParameterMessage,
} from '../src/common/editor/engine/scheduled-parameter-registry.ts';

const ADDRESS: ParameterAddress = {
	kind: 'effect',
	strip: { kind: 'track', id: 'track-1' },
	effectId: 'effect-1',
	parameterId: 'mix',
};

function descriptor(latencyFrames = 0) {
	return {
		id: canonicalParameterAddressKey(ADDRESS),
		address: ADDRESS,
		unit: 'linear',
		minimum: 0,
		maximum: 1,
		defaultValue: 0,
		step: null,
		taper: 'linear' as const,
		automationTolerance: 0.001,
		automatable: true,
		latencyFrames,
		tailFrames: 0,
	};
}

function lane() {
	return {
		id: 'mix-lane',
		address: ADDRESS,
		timebase: 'absolute-samples',
		points: [
			{ id: 'point-0', position: 0, value: 0.25 },
			{ id: 'point-1', position: 10, value: 0.75 },
			{ id: 'point-2', position: 20, value: 1 },
		],
		segments: [{ kind: 'hold' }, { kind: 'linear' }],
	};
}

test('lane compilation emits exact set/linear events over a bounded playback range', () => {
	assert.deepEqual(compileAutomationLaneEventsV21(lane(), {
		fromFrame: 5,
		toFrame: 20,
		sampleRate: 48_000,
		descriptor: descriptor(),
	}), [
		{ kind: 'set', frame: 5, value: 0.25 },
		{ kind: 'set', frame: 10, value: 0.75 },
		{ kind: 'linear', frame: 20, value: 1 },
	]);
});

test('registry scheduling applies the target latency once to exact message offsets', () => {
	const packets: ScheduledParameterMessage[] = [];
	const registry = new ScheduledParameterRegistry();
	registry.registerMessageTarget(descriptor(7), (message) => { packets.push(message); });
	const events = scheduleAutomationLaneV21(lane(), registry, {
		fromFrame: 5,
		toFrame: 20,
		contextStartTime: 2,
		sampleRate: 48_000,
		contextSampleRate: 48_000,
		transportRate: 1,
	});

	assert.deepEqual(events, [
		{ kind: 'set', frame: 5, value: 0.25 },
		{ kind: 'set', frame: 10, value: 0.75 },
		{ kind: 'linear', frame: 20, value: 1 },
	]);
	assert.deepEqual(packets, [{
		type: 'schedule-parameter-v1',
		revision: 1,
		address: ADDRESS,
		fromFrame: 5,
		contextStartTime: 2,
		sampleRate: 48_000,
		contextSampleRate: 48_000,
		transportRate: 1,
		events: [
			{ kind: 'set', frameOffset: 7, value: 0.25 },
			{ kind: 'set', frameOffset: 12, value: 0.75 },
			{ kind: 'linear', frameOffset: 22, value: 1 },
		],
	}]);
});

test('musical points and tempo changes compile to deterministic exact frame events', () => {
	const tempoMap = {
		mode: 'musical' as const,
		events: [
			{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
		],
	};
	const musical = {
		...lane(),
		timebase: 'musical-beats',
		points: [
			{ id: 'point-0', position: { num: 0, den: 1 }, value: 0 },
			{ id: 'point-1', position: { num: 4, den: 1 }, value: 1 },
			{ id: 'point-2', position: { num: 5, den: 1 }, value: 0 },
		],
		segments: [{ kind: 'linear' }, { kind: 'linear' }],
	};
	const options = { fromFrame: 0, toFrame: 300, sampleRate: 100, tempoMap, descriptor: descriptor() };
	const first = compileAutomationLaneEventsV21(musical, options);
	assert.deepEqual(compileAutomationLaneEventsV21(musical, options), first);
	assert.deepEqual(first, [
		{ kind: 'set', frame: 0, value: 0 },
		{ kind: 'linear', frame: 200, value: 1 },
		{ kind: 'linear', frame: 300, value: 0 },
	]);
});

test('curved segments expand deterministically into bounded linear events within descriptor tolerance', () => {
	const curved = {
		...lane(),
		points: [
			{ id: 'point-0', position: 0, value: 0 },
			{ id: 'point-1', position: 64, value: 1 },
		],
		segments: [{ kind: 'eased' }],
	};
	const options = { fromFrame: 0, toFrame: 64, sampleRate: 48_000, descriptor: descriptor() };
	const first = compileAutomationLaneEventsV21(curved, options);
	assert.deepEqual(compileAutomationLaneEventsV21(curved, options), first);
	assert.deepEqual(first[0], { kind: 'set', frame: 0, value: 0 });
	assert.deepEqual(first.at(-1), { kind: 'linear', frame: 64, value: 1 });
	assert.ok(first.length > 2);
	assert.ok(first.length <= 65);
});

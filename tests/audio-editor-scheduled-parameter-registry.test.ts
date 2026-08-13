/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	effectParameterInventory,
	stripParameterDescriptor,
} from '../src/common/editor/effect-parameter-descriptors.ts';
import {
	registerEffectAudioParam,
	registerEffectMessageParameterProducer,
	WORKLET_PARAMETER_QUEUE_CONSUMER_REVISION_INPUT,
} from '../src/common/editor/engine/effect-parameter-bindings.ts';
import {
	ScheduledParameterRegistry,
	StaleScheduledParameterTargetError,
} from '../src/common/editor/engine/scheduled-parameter-registry.ts';
import {
	AUDIO_EFFECT_DEFINITIONS,
	AUDACITY_RACK_EFFECT_TYPES,
	createEffect,
} from '../src/common/editor/effects.js';

const TRACK = Object.freeze({ kind: 'track' as const, id: 'track-1' });

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

test('native targets apply exact per-target latency and remain inert without a lane', () => {
	const registry = new ScheduledParameterRegistry();
	const descriptor = stripParameterDescriptor({
		kind: 'strip', strip: TRACK, parameterId: 'gain',
	}, 48);
	const param = mockAudioParam();
	const target = registry.registerAudioParam(descriptor, param);
	assert.deepEqual(param.calls, []);

	target.schedule([
		{ kind: 'set', frame: 100, value: 0.5 },
		{ kind: 'linear', frame: 148, value: 1.5 },
	], {
		fromFrame: 100,
		contextStartTime: 1,
		sampleRate: 48_000,
		contextSampleRate: 48_000,
		transportRate: 1,
	});
	assert.deepEqual(param.calls, [
		{ kind: 'cancel', time: 1.001 },
		{ kind: 'set', value: 0.5, time: 1.001 },
		{ kind: 'linear', value: 1.5, time: 1.002 },
	]);
});

test('composite native targets schedule each AudioParam from one authoritative value', () => {
	const registry = new ScheduledParameterRegistry();
	const descriptor = stripParameterDescriptor({
		kind: 'strip', strip: TRACK, parameterId: 'gain',
	});
	const dry = mockAudioParam();
	const wet = mockAudioParam();
	const target = registry.registerAudioParamGroup(descriptor, [
		{ param: dry, transformValue: (value) => 1 - value },
		{ param: wet },
	]);
	assert.deepEqual(dry.calls, []);
	assert.deepEqual(wet.calls, []);

	target.schedule([
		{ kind: 'set', frame: 0, value: 0.25 },
		{ kind: 'linear', frame: 48, value: 0.75 },
	], scheduleOptions());
	assert.deepEqual(dry.calls, [
		{ kind: 'cancel', time: 0 },
		{ kind: 'set', value: 0.75, time: 0 },
		{ kind: 'linear', value: 0.25, time: 0.001 },
	]);
	assert.deepEqual(wet.calls, [
		{ kind: 'cancel', time: 0 },
		{ kind: 'set', value: 0.25, time: 0 },
		{ kind: 'linear', value: 0.75, time: 0.001 },
	]);
});

test('message targets emit bounded sample-offset packets with monotonic revisions', () => {
	const registry = new ScheduledParameterRegistry();
	const descriptor = stripParameterDescriptor({
		kind: 'strip', strip: TRACK, parameterId: 'pan',
	}, 32);
	const packets: unknown[] = [];
	const target = registry.registerMessageTarget(descriptor, (packet) => {
		packets.push(structuredClone(packet));
		return true;
	});
	target.schedule([
		{ kind: 'set', frame: 20, value: -0.5 },
		{ kind: 'linear', frame: 84, value: 0.5 },
	], {
		fromFrame: 20,
		contextStartTime: 5,
		sampleRate: 48_000,
		contextSampleRate: 48_000,
		transportRate: 2,
	});
	target.schedule([{ kind: 'set', frame: 20, value: 0 }], {
		fromFrame: 20,
		contextStartTime: 6,
		sampleRate: 48_000,
		contextSampleRate: 48_000,
		transportRate: 1,
	});
	assert.deepEqual(packets, [
		{
			type: 'schedule-parameter-v1',
			revision: 1,
			address: { kind: 'strip', strip: TRACK, parameterId: 'pan' },
			fromFrame: 20,
			contextStartTime: 5,
			sampleRate: 48_000,
			contextSampleRate: 48_000,
			transportRate: 2,
			events: [
				{ kind: 'set', frameOffset: 32, value: -0.5 },
				{ kind: 'linear', frameOffset: 64, value: 0.5 },
			],
		},
		{
			type: 'schedule-parameter-v1',
			revision: 2,
			address: { kind: 'strip', strip: TRACK, parameterId: 'pan' },
			fromFrame: 20,
			contextStartTime: 6,
			sampleRate: 48_000,
			contextSampleRate: 48_000,
			transportRate: 1,
			events: [{ kind: 'set', frameOffset: 32, value: 0 }],
		},
	]);
});

test('registry rejects duplicate targets, malformed schedules, and stale leases', () => {
	const registry = new ScheduledParameterRegistry();
	const descriptor = stripParameterDescriptor({
		kind: 'strip', strip: TRACK, parameterId: 'mute',
	});
	const target = registry.registerAudioParam(descriptor, mockAudioParam());
	assert.throws(() => registry.registerAudioParam(descriptor, mockAudioParam()), /already registered/iu);
	assert.throws(() => target.schedule([
		{ kind: 'set', frame: 10, value: 1 },
		{ kind: 'set', frame: 9, value: 0 },
	], scheduleOptions()), /ordered/iu);
	assert.throws(() => target.schedule([
		{ kind: 'linear', frame: 10, value: 1 },
	], scheduleOptions()), /discrete/iu);
	assert.throws(() => target.schedule([
		{ kind: 'set', frame: 10, value: 2 },
	], scheduleOptions()), /between 0 and 1/iu);

	assert.equal(registry.unregister(descriptor.address), true);
	assert.throws(
		() => target.schedule([{ kind: 'set', frame: 10, value: 1 }], scheduleOptions()),
		StaleScheduledParameterTargetError,
	);
	assert.equal(registry.unregister(descriptor.address), false);

	const replacement = registry.registerAudioParam(descriptor, mockAudioParam());
	registry.clear();
	assert.throws(
		() => replacement.schedule([{ kind: 'set', frame: 10, value: 1 }], scheduleOptions()),
		StaleScheduledParameterTargetError,
	);
});

test('registry accepts only closed own-data descriptor snapshots', () => {
	const registry = new ScheduledParameterRegistry();
	const descriptor = stripParameterDescriptor({
		kind: 'strip', strip: TRACK, parameterId: 'gain',
	});
	assert.throws(() => registry.registerAudioParam({
		...descriptor,
		unexpected: true,
	} as typeof descriptor, mockAudioParam()), /unknown member/iu);

	const accessor = { ...descriptor };
	Object.defineProperty(accessor, 'unit', {
		enumerable: true,
		get() { throw new Error('descriptor getter executed'); },
	});
	assert.throws(
		() => registry.registerAudioParam(accessor, mockAudioParam()),
		/own data/iu,
	);
	assert.throws(() => registry.registerAudioParam({
		...descriptor,
		automatable: false,
	} as typeof descriptor, mockAudioParam()), /block reason/iu);
	const serialized = JSON.stringify(descriptor);
	const parsed = JSON.parse(
		`${serialized.slice(0, -1)},"__proto__":{"automatable":false}}`,
	) as Record<string, unknown>;
	assert.throws(
		() => registry.registerAudioParam(parsed as unknown as typeof descriptor, mockAudioParam()),
		/unknown member: __proto__/iu,
	);
	assert.equal(({} as { automatable?: unknown }).automatable, undefined);
});

test('effect bindings expose stable native and worklet targets without posting eagerly', () => {
	const nativeRegistry = new ScheduledParameterRegistry();
	const frequency = mockAudioParam();
	registerEffectAudioParam(
		createEffect('highpass', { id: 'filter-1' }),
		'frequency',
		frequency,
		{ parameterRegistry: nativeRegistry, scope: 'track', targetId: 'track-1', latencyFrames: 96 },
	);
	const nativeTarget = nativeRegistry.get({
		kind: 'effect', strip: TRACK, effectId: 'filter-1', parameterId: 'frequency',
	});
	assert.ok(nativeTarget);
	assert.equal(nativeTarget.latencyFrames, 96);
	assert.deepEqual(frequency.calls, []);

	const messageRegistry = new ScheduledParameterRegistry();
	const messages: unknown[] = [];
	registerEffectMessageParameterProducer(
		createEffect('delay', { id: 'delay-1' }),
		{ postMessage: (message: unknown) => { messages.push(structuredClone(message)); } } as MessagePort,
		{ parameterRegistry: messageRegistry, scope: 'master', targetId: null, latencyFrames: 64 },
	);
	assert.equal(messageRegistry.size, 3);
	assert.deepEqual(messages, []);
	const feedback = messageRegistry.get({
		kind: 'effect', strip: { kind: 'master' }, effectId: 'delay-1', parameterId: 'feedback',
	});
	assert.ok(feedback);
	feedback.schedule([{ kind: 'set', frame: 0, value: 0.5 }], scheduleOptions());
	assert.equal(messages.length, 1);
	assert.equal((messages[0] as { events: readonly { frameOffset: number }[] }).events[0]?.frameOffset, 64);
});

test('worklet producer contracts cover every automatable scalar without claiming a consumer', () => {
	assert.deepEqual(WORKLET_PARAMETER_QUEUE_CONSUMER_REVISION_INPUT, {
		id: 'soundscaper-4a-worklet-parameter-queue-consumer-v1',
		protocol: 'schedule-parameter-v1',
		owner: 'Soundscaper 4A',
		reason: 'Current first-party effect worklets do not consume frame-offset parameter packets. A bounded sample-offset queue must be integrated and tested before a worklet target is exposed to an automation lane.',
	});
	const types = [...Object.keys(AUDIO_EFFECT_DEFINITIONS), ...AUDACITY_RACK_EFFECT_TYPES];
	for (const type of types) {
		const registry = new ScheduledParameterRegistry();
		const messages: unknown[] = [];
		const effect = createEffect(type, { id: `${type}-binding-inventory` });
		registerEffectMessageParameterProducer(
			effect,
			{ postMessage: (message: unknown) => { messages.push(message); } } as MessagePort,
			{ parameterRegistry: registry, scope: 'track', targetId: 'track-1' },
		);
		const expected = effectParameterInventory(TRACK, effect).descriptors
			.filter((descriptor) => descriptor.automatable)
			.map((descriptor) => descriptor.id);
		assert.deepEqual(
			registry.entries().map((target) => target.descriptor.id),
			expected,
			type,
		);
		assert.deepEqual(messages, [], type);
	}
});

function scheduleOptions() {
	return {
		fromFrame: 0,
		contextStartTime: 0,
		sampleRate: 48_000,
		contextSampleRate: 48_000,
		transportRate: 1,
	};
}

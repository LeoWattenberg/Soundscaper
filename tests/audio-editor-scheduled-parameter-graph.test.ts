/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffect } from '../src/common/editor/effects.js';
import {
	legacySendEdgeId,
	type ParameterAddress,
} from '../src/common/editor/parameter-address.ts';
import { applyEffect } from '../src/common/editor/engine/effect-rack.ts';
import { scheduleProjectGains } from '../src/common/editor/engine/clip-gain.ts';
import { buildProjectGraph } from '../src/common/editor/engine/project-graph.ts';
import { ScheduledParameterRegistry } from '../src/common/editor/engine/scheduled-parameter-registry.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

type ParamCall = readonly ['set' | 'linear' | 'cancel', number, number?];

class MockParam {
	value: number;
	readonly calls: ParamCall[] = [];

	constructor(value = 0) { this.value = value; }

	setValueAtTime(value: number, time: number): AudioParam {
		this.value = value;
		this.calls.push(['set', value, time]);
		return this as unknown as AudioParam;
	}

	linearRampToValueAtTime(value: number, time: number): AudioParam {
		this.value = value;
		this.calls.push(['linear', value, time]);
		return this as unknown as AudioParam;
	}

	cancelScheduledValues(time: number): AudioParam {
		this.calls.push(['cancel', time]);
		return this as unknown as AudioParam;
	}
}

class MockNode {
	readonly kind: string;
	readonly connections: MockNode[] = [];

	constructor(kind: string) { this.kind = kind; }

	connect(target: MockNode): MockNode {
		this.connections.push(target);
		return target;
	}

	disconnect(): void { this.connections.length = 0; }
}

class MockContext {
	readonly sampleRate = 48_000;
	readonly currentTime = 0;
	readonly destination = new MockNode('destination');
	readonly created: Array<MockNode & Record<string, unknown>> = [];
	#counters = new Map<string, number>();

	createGain() { return this.#make('gain', { gain: new MockParam(1) }); }
	createStereoPanner() { return this.#make('panner', { pan: new MockParam(0) }); }
	createDelay() { return this.#make('delay', { delayTime: new MockParam(0) }); }
	createDynamicsCompressor() {
		return this.#make('compressor', {
			threshold: new MockParam(),
			knee: new MockParam(),
			ratio: new MockParam(),
			attack: new MockParam(),
			release: new MockParam(),
		});
	}

	#make(kind: string, fields: Record<string, unknown>): MockNode & Record<string, unknown> {
		const index = (this.#counters.get(kind) || 0) + 1;
		this.#counters.set(kind, index);
		const node = Object.assign(new MockNode(`${kind}-${index}`), fields);
		this.created.push(node);
		return node;
	}
}

test('a graph with no lanes preserves the existing gain event stream exactly', () => {
	const context = new MockContext();
	const project: EngineProject = {
		sampleRate: 48_000,
		tracks: [{
			type: 'audio',
			id: 'track-1',
			gain: 0.5,
			pan: 0.25,
			mute: false,
			solo: false,
			effects: [],
			envelope: [
				{ frame: 0, value: 1 },
				{ frame: 4, value: 0 },
				{ frame: 8, value: 1 },
			],
		}],
		mixer: { groups: [], sends: [], routes: {} },
		master: { gain: 0.75, pan: 0, mute: false, effects: [], envelope: [] },
	};
	const graph = buildProjectGraph(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		project,
		{ metering: false },
	);
	assert.deepEqual(paramEvents(context), [
		['gain-3.gain', 'set', 0.5, 0],
		['panner-1.pan', 'set', 0.25, 0],
		['gain-4.gain', 'set', 1, 0],
		['gain-5.gain', 'set', 0.75, 0],
	]);
	assert.equal(graph.parameterRegistry.size, 4);
	assert.deepEqual(paramEvents(context), [
		['gain-3.gain', 'set', 0.5, 0],
		['panner-1.pan', 'set', 0.25, 0],
		['gain-4.gain', 'set', 1, 0],
		['gain-5.gain', 'set', 0.75, 0],
	]);

	scheduleProjectGains({
		context: context as unknown as BaseAudioContext,
		project,
		gainParams: graph.projectGainParams,
		fromFrame: 0,
		toFrame: 8,
		contextStartTime: 2,
		sampleRate: 8,
		transportRate: 1,
	});
	assert.deepEqual(paramEvents(context), [
		['gain-3.gain', 'set', 0.5, 0],
		['gain-3.gain', 'set', 0.5, 2],
		['gain-3.gain', 'linear', 0, 2.5],
		['gain-3.gain', 'linear', 0.5, 3],
		['panner-1.pan', 'set', 0.25, 0],
		['gain-4.gain', 'set', 1, 0],
		['gain-5.gain', 'set', 0.75, 0],
	]);
});

test('native AudioParams register while production-worklet fallback parameters remain fenced', () => {
	const context = new MockContext();
	const input = new MockNode('input');
	const registry = new ScheduledParameterRegistry();
	const options = {
		parameterRegistry: registry,
		scope: 'track',
		targetId: 'track-1',
	};
	applyEffect(
		context as unknown as BaseAudioContext,
		input as unknown as AudioNode,
		createEffect('compressor', { id: 'compressor-1' }),
		[],
		options,
	);
	applyEffect(
		context as unknown as BaseAudioContext,
		input as unknown as AudioNode,
		createEffect('limiter', { id: 'limiter-1' }),
		[],
		options,
	);
	applyEffect(
		context as unknown as BaseAudioContext,
		input as unknown as AudioNode,
		createEffect('delay', { id: 'delay-1', params: { mix: 0.25 } }),
		[],
		options,
	);
	assert.deepEqual(registry.entries().map((entry) => effectParameterId(entry.descriptor.address)), [
		'compressor-1:threshold',
		'compressor-1:knee',
		'compressor-1:ratio',
		'compressor-1:attack',
		'compressor-1:release',
	]);
	assert.equal(registry.has({
		kind: 'effect',
		strip: { kind: 'track', id: 'track-1' },
		effectId: 'limiter-1',
		parameterId: 'threshold',
	}), false);
	assert.equal(registry.has({
		kind: 'effect',
		strip: { kind: 'track', id: 'track-1' },
		effectId: 'delay-1',
		parameterId: 'mix',
	}), false);
});

test('a no-lane graph accepts existing long track, effect, bus, and send IDs', () => {
	const context = new MockContext();
	const trackId = `track-${'t'.repeat(8_192)}`;
	const effectId = `effect-${'e'.repeat(8_192)}`;
	const groupId = `group-${'g'.repeat(8_192)}`;
	const sendId = `send-${'s'.repeat(8_192)}`;
	const project: EngineProject = {
		sampleRate: 48_000,
		tracks: [{
			type: 'audio', id: trackId, gain: 1, pan: 0, mute: false, solo: false,
			effects: [createEffect('delay', {
				id: effectId,
				params: { time: 0.25, feedback: 0.3, mix: 0.2 },
			})],
		}],
		mixer: {
			groups: [{ id: groupId, gain: 1, pan: 0, mute: false, solo: false, effects: [] }],
			sends: [{ id: sendId, gain: 1, pan: 0, mute: false, solo: false, effects: [] }],
			routes: { [trackId]: { groupId, sends: { [sendId]: 0.5 } } },
		},
		master: { gain: 1, pan: 0, mute: false, effects: [] },
	};
	const graph = buildProjectGraph(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		project,
		{ metering: false },
	);
	assert.equal(graph.parameterRegistry.has({
		kind: 'strip', strip: { kind: 'track', id: trackId }, parameterId: 'gain',
	}), true);
	assert.equal(graph.parameterRegistry.has({
		kind: 'effect', strip: { kind: 'track', id: trackId }, effectId, parameterId: 'mix',
	}), false);
	assert.equal(graph.parameterRegistry.has({
		kind: 'strip', strip: { kind: 'mixer-node', id: groupId }, parameterId: 'gain',
	}), true);
	assert.equal(graph.parameterRegistry.has({
		kind: 'strip', strip: { kind: 'mixer-node', id: sendId }, parameterId: 'gain',
	}), true);
	assert.equal(graph.parameterRegistry.has({
		kind: 'edge', edgeId: legacySendEdgeId(trackId, sendId), parameterId: 'level',
	}), true);
});

test('effect parameter targets carry the latency standing ahead of them', () => {
	const context = new MockContext();
	const project: EngineProject = {
		sampleRate: 48_000,
		tracks: [{
			type: 'audio', id: 'track-1', gain: 1, pan: 0, mute: false, solo: false,
			effects: [
				createEffect('limiter', { id: 'limiter-1', params: { lookahead: 0.01 } }),
				createEffect('delay', { id: 'delay-1', params: { time: 0.25, feedback: 0.3, mix: 0.2 } }),
			],
		}],
		mixer: { groups: [], sends: [], routes: {} },
		master: {
			gain: 1, pan: 0, mute: false,
			effects: [createEffect('compressor', { id: 'compressor-1' })],
		},
	};
	const graph = buildProjectGraph(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		project,
		{ metering: false },
	);
	assert.equal(graph.latencyFrames, 480);
	const latencies = new Map<string, Set<number>>();
	for (const target of graph.parameterRegistry.entries()) {
		const address = target.descriptor.address;
		if (address.kind !== 'effect') continue;
		latencies.set(
			address.effectId,
			(latencies.get(address.effectId) ?? new Set<number>()).add(target.latencyFrames),
		);
	}
	// The rack head is uncompensated; a later effect carries its upstream rack
	// latency, and a master effect carries the whole track stage, exactly as the
	// strip gain target on the same graph already does.
	assert.deepEqual([...(latencies.get('limiter-1') ?? [])], []);
	assert.deepEqual([...(latencies.get('delay-1') ?? [])], []);
	assert.deepEqual([...(latencies.get('compressor-1') ?? [])], [480]);
	assert.equal(graph.parameterRegistry.get({
		kind: 'strip', strip: { kind: 'track', id: 'track-1' }, parameterId: 'gain',
	})?.latencyFrames, 480);
});

test('mute and send targets declare the latency of their own track only', () => {
	const context = new MockContext();
	const project: EngineProject = {
		sampleRate: 48_000,
		tracks: [
			{ type: 'audio', id: 'track-dry', gain: 1, pan: 0, mute: false, solo: false, effects: [] },
			{
				type: 'audio', id: 'track-limited', gain: 1, pan: 0, mute: false, solo: false,
				effects: [createEffect('limiter', { id: 'limiter-1', params: { lookahead: 0.01 } })],
			},
		],
		mixer: {
			groups: [],
			sends: [{ id: 'send-1', gain: 1, pan: 0, mute: false, solo: false, effects: [] }],
			routes: { 'track-dry': { sends: { 'send-1': 0.5 } } },
		},
		master: { gain: 1, pan: 0, mute: false, effects: [] },
	};
	const graph = buildProjectGraph(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		project,
		{ metering: false },
	);
	assert.equal(graph.latencyFrames, 480);
	// Both of these targets sit downstream of the per-track delay that
	// compensates maximumTrackLatency - trackLatency, so the latency standing
	// ahead of them is the graph latency, not their own track's. Whoever
	// schedules a lane onto mute or send level must revisit these declarations.
	assert.equal(graph.parameterRegistry.get({
		kind: 'strip', strip: { kind: 'track', id: 'track-dry' }, parameterId: 'mute',
	})?.latencyFrames, 0);
	assert.equal(graph.parameterRegistry.get({
		kind: 'edge', edgeId: legacySendEdgeId('track-dry', 'send-1'), parameterId: 'level',
	})?.latencyFrames, 0);
	assert.equal(graph.parameterRegistry.get({
		kind: 'strip', strip: { kind: 'track', id: 'track-limited' }, parameterId: 'mute',
	})?.latencyFrames, 480);
	// The strip gain target is upstream of that delay, so its declaration holds.
	assert.equal(graph.parameterRegistry.get({
		kind: 'strip', strip: { kind: 'track', id: 'track-dry' }, parameterId: 'gain',
	})?.latencyFrames, 0);
});

function paramEvents(context: MockContext): Array<readonly [string, string, number, number?]> {
	const events: Array<readonly [string, string, number, number?]> = [];
	for (const node of context.created) {
		for (const key of ['gain', 'pan'] as const) {
			const param = node[key];
			if (!(param instanceof MockParam)) continue;
			for (const [kind, value, time] of param.calls) {
				events.push([`${node.kind}.${key}`, kind, value, time]);
			}
		}
	}
	return events;
}

function effectParameterId(address: ParameterAddress): string {
	return address.kind === 'effect' ? `${address.effectId}:${address.parameterId}` : '';
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProjectGraphV21 } from '../src/common/editor/engine/project-graph-v21.ts';

const SAMPLE_RATE = 48_000;

interface MockNode extends Record<string, unknown> {
	readonly id: string;
	readonly kind: string;
	connect(target: MockNode): MockNode;
	disconnect(): void;
}

/**
 * Edge-level automation is registered output-referred: its scheduled offset
 * includes the edge's inserted PDC compensation. That is only correct when
 * the level node sits after the compensation delay — a level node before the
 * delay modulates material that reaches the output compensation-frames later
 * than a strip-gain or effect ramp authored at the same project frame.
 */
test('the edge level node sits after the edge compensation delay', () => {
	const connections: { from: MockNode; to: MockNode }[] = [];
	let counter = 0;
	const makeParam = (node: MockNode, initial: number) => ({
		value: initial, node,
		setValueAtTime(value: number) { this.value = value; },
		linearRampToValueAtTime() {},
		cancelScheduledValues() {},
	});
	const makeNode = (kind: string, extra: Record<string, unknown> = {}): MockNode => {
		const node: MockNode = {
			id: `${kind}#${String(counter += 1)}`, kind, ...extra,
			connect(target: MockNode) { connections.push({ from: node, to: target }); return target; },
			disconnect() {},
		};
		return node;
	};
	const context = {
		sampleRate: SAMPLE_RATE,
		currentTime: 0,
		createGain() { const node = makeNode('gain'); node.gain = makeParam(node, 1); return node; },
		createDelay() { const node = makeNode('delay'); node.delayTime = makeParam(node, 0); return node; },
		createChannelSplitter(channels: number) { return makeNode('splitter', { channels }); },
		createChannelMerger(channels: number) { return makeNode('merger', { channels }); },
	};
	const track = (id: string, effects: readonly unknown[]) => ({
		id, type: 'audio', gain: 1, pan: 0, mute: false, solo: false,
		effectsActive: true, effects, clipIds: [],
	});
	const edge = (id: string, source: unknown, destination: unknown) => ({
		id, kind: 'assignment', source, destination,
		position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1],
	});
	const project = {
		schemaVersion: 21,
		sampleRate: SAMPLE_RATE,
		masterChannels: 2,
		tracks: [
			track('A', []),
			track('B', [{
				id: 'b-limiter', type: 'limiter', enabled: true, bypassed: false,
				params: { lookahead: 0.01, ceiling: 0, release: 0.01 },
			}]),
		],
		master: { gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [] },
		mixer: {
			schemaVersion: 1,
			groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				edge('a-master', { kind: 'track', id: 'A' }, { kind: 'master' }),
				edge('b-master', { kind: 'track', id: 'B' }, { kind: 'master' }),
				edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
			],
		},
		automationLanes: [],
		clips: [], sources: [],
	};

	const graph = buildProjectGraphV21(
		context as never,
		makeNode('destination') as never,
		project as never,
		{ metering: false, includeTrackPan: false, monitoring: false } as never,
	);
	const plan = (graph as unknown as { pathPdcPlanV21: {
		edgeCompensationFrames: ReadonlyMap<string, number>;
		automationLatencyFrames(target: unknown): number;
	}; }).pathPdcPlanV21;
	const compensation = plan.edgeCompensationFrames.get('a-master') ?? 0;
	assert.ok(compensation > 0, 'track A borrows the limiter lookahead as edge compensation');

	const registry = (graph as unknown as { parameterRegistry: {
		get(target: unknown): { latencyFrames: number; binding: { params: readonly { param: { node: MockNode } }[] } };
	}; }).parameterRegistry;
	const target = registry.get({ kind: 'edge', edgeId: 'a-master', parameterId: 'level' });
	assert.equal(
		target.latencyFrames,
		plan.automationLatencyFrames({ kind: 'edge', edgeId: 'a-master', parameterId: 'level' }),
		'the registered latency stays the output-referred plan value',
	);
	const levelNode = target.binding.params[0]!.param.node;
	const upstream = connections.filter(({ to }) => to === levelNode).map(({ from }) => from);
	const compensationDelay = upstream.find((node) => node.kind === 'delay');
	assert.ok(
		compensationDelay,
		'the edge level node is fed by the compensation delay, not the raw strip tap',
	);
	assert.equal(
		(compensationDelay!.delayTime as { value: number }).value,
		compensation / SAMPLE_RATE,
		'the delay feeding the level node carries the edge compensation',
	);
});

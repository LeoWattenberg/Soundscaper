/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProjectGraph } from '../src/common/editor/engine/project-graph.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

class FakeParam {
	value: number;

	constructor(value = 0) { this.value = value; }

	setValueAtTime(value: number): AudioParam {
		this.value = value;
		return this as unknown as AudioParam;
	}

	linearRampToValueAtTime(value: number): AudioParam {
		this.value = value;
		return this as unknown as AudioParam;
	}

	cancelScheduledValues(): AudioParam { return this as unknown as AudioParam; }
}

class FakeNode {
	readonly connections: FakeNode[] = [];

	connect(target: FakeNode): FakeNode {
		this.connections.push(target);
		return target;
	}

	disconnect(): void { this.connections.length = 0; }
}

class FakeContext {
	readonly sampleRate = 48_000;
	readonly currentTime = 0;
	readonly destination = new FakeNode();

	createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam(1) }); }
	createStereoPanner() { return Object.assign(new FakeNode(), { pan: new FakeParam(0) }); }
	createDelay() { return Object.assign(new FakeNode(), { delayTime: new FakeParam(0) }); }
	createChannelSplitter(channels: number) { return Object.assign(new FakeNode(), { channels }); }
	createChannelMerger(channels: number) { return Object.assign(new FakeNode(), { channels }); }
	createAnalyser() {
		return Object.assign(new FakeNode(), {
			fftSize: 256,
			smoothingTimeConstant: 0,
			getFloatTimeDomainData(target: Float32Array) { target.fill(0); },
		});
	}
}

test('an all-silent route cannot make a track audible through a soloed bus', () => {
	const context = new FakeContext();
	const project = {
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		sampleRate: 48_000,
		masterChannels: 2,
		tracks: [
			{ type: 'audio', id: 'silent', clipIds: [], gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [] },
			{ type: 'audio', id: 'direct', clipIds: [], gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [] },
		],
		master: { gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [] },
		mixer: {
			schemaVersion: 1,
			groups: [{
				id: 'solo-bus', name: 'Solo bus', color: '', gain: 1, pan: 0, mute: false, solo: true,
				collapsed: false, effectsActive: true, effects: [], channelCount: 2,
			}],
			sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				{
					id: 'silent-bus', kind: 'assignment', source: { kind: 'track', id: 'silent' },
					destination: { kind: 'mixer-node', id: 'solo-bus' }, position: 'post-fader',
					level: 1, enabled: true, channelMap: [-1, -1],
				},
				{
					id: 'solo-bus-master', kind: 'assignment', source: { kind: 'mixer-node', id: 'solo-bus' },
					destination: { kind: 'master' }, position: 'post-fader',
					level: 1, enabled: true, channelMap: [0, 1],
				},
				{
					id: 'direct-master', kind: 'assignment', source: { kind: 'track', id: 'direct' },
					destination: { kind: 'master' }, position: 'post-fader',
					level: 1, enabled: true, channelMap: [0, 1],
				},
				{
					id: 'master-main', kind: 'assignment', source: { kind: 'master' },
					destination: { kind: 'output', id: 'main' }, position: 'post-fader',
					level: 1, enabled: true, channelMap: [0, 1],
				},
			],
		},
		automationLanes: [],
	} as unknown as EngineProject;
	const graph = buildProjectGraph(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		project,
		{ metering: false },
	);
	const gateValue = (kind: 'track' | 'mixer-node', id: string): number | undefined => {
		const target = graph.parameterRegistry.get({
			kind: 'strip', strip: { kind, id }, parameterId: 'mute',
		});
		return target?.binding.kind === 'audio-param'
			? (target.binding.params[0]!.param as unknown as FakeParam).value
			: undefined;
	};
	assert.equal(gateValue('mixer-node', 'solo-bus'), 1);
	assert.equal(gateValue('track', 'silent'), 0);
	assert.equal(gateValue('track', 'direct'), 0);
});

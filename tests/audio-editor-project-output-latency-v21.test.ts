/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { compileProjectPathPdcPlanV21 } from '../src/common/editor/engine/project-path-pdc-plan-v21.ts';
import { buildProjectGraph, projectGraphLatencyFrames } from '../src/common/editor/engine/project-graph.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

class FakeParam {
	value: number;

	constructor(value = 0) { this.value = value; }
	setValueAtTime(value: number) { this.value = value; return this; }
	linearRampToValueAtTime(value: number) { this.value = value; return this; }
	cancelScheduledValues() { return this; }
}

class FakeNode {
	readonly kind: string;
	readonly connections: FakeNode[] = [];

	constructor(kind: string) { this.kind = kind; }
	connect(target: FakeNode) { this.connections.push(target); return target; }
	disconnect() { this.connections.length = 0; }
}

class FakeContext {
	readonly sampleRate = 48_000;
	readonly currentTime = 0;
	readonly destination = new FakeNode('destination');
	readonly created: Array<FakeNode & { delayTime?: FakeParam }> = [];
	#counter = 0;

	createGain() { return this.#make('gain', { gain: new FakeParam(1) }); }
	createStereoPanner() { return this.#make('panner', { pan: new FakeParam(0) }); }
	createDelay() { return this.#make('delay', { delayTime: new FakeParam(0) }); }
	createChannelSplitter(channels: number) { return this.#make('splitter', { channels }); }
	createChannelMerger(channels: number) { return this.#make('merger', { channels }); }
	createAnalyser() { return this.#make('analyser', { fftSize: 256, smoothingTimeConstant: 0 }); }
	createDynamicsCompressor() {
		return this.#make('compressor', {
			threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(),
			attack: new FakeParam(), release: new FakeParam(),
		});
	}

	#make(kind: string, fields: Record<string, unknown>) {
		this.#counter += 1;
		const node = Object.assign(new FakeNode(`${kind}-${String(this.#counter)}`), fields);
		this.created.push(node);
		return node;
	}
}

test('the connected main output reaches the aggregate latency reported to render consumers', () => {
	const project = projectWithSlowerAuxiliaryOutput();
	const plan = compileProjectPathPdcPlanV21(project, { sampleRate: 48_000 });
	assert.equal(plan.outputLatencyFrames.get('main'), 0);
	assert.equal(plan.outputLatencyFrames.get('aux'), 480);
	assert.equal(plan.latencyFrames, 480);
	assert.equal(projectGraphLatencyFrames(project, { sampleRate: 48_000 }), 480);

	const context = new FakeContext();
	const graph = buildProjectGraph(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		project,
		{ metering: false },
	);
	assert.equal(graph.latencyFrames, 480);
	const delays = context.created.filter((node) => node.kind.startsWith('delay-'));
	assert.deepEqual(delays.map((node) => node.delayTime?.value), [0.01]);
	assert.deepEqual(delays[0]?.connections, [context.destination]);
});

function projectWithSlowerAuxiliaryOutput() {
	return createSoundscaperProjectV21({
		id: 'output-latency', title: 'Output latency', now: '2026-08-20T00:00:00.000Z',
		sources: [createAudioSource({
			id: 'source', storageKey: 'pcm:source', contentSha256: 'a'.repeat(64),
			frameCount: 100, sampleRate: 48_000, channelCount: 2,
		})],
		clips: [createAudioClip({
			id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0,
			durationFrames: 100, sourceDurationFrames: 100,
		})],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['clip'] })],
		sequences: [{ id: 'sequence', trackIds: ['track'] }],
		primarySequenceId: 'sequence',
		mixer: {
			schemaVersion: 1,
			groups: [strip('cue-bus', [{
				id: 'limiter', type: 'limiter', enabled: true, params: { lookahead: 0.01 },
			}])],
			sends: [], cues: [], vcas: [],
			outputs: [
				{ id: 'main', name: 'Main', role: 'main', channelCount: 2 },
				{ id: 'aux', name: 'Aux', role: 'auxiliary', channelCount: 2 },
			],
			edges: [
				edge('track-master', { kind: 'track', id: 'track' }, { kind: 'master' }),
				edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
				edge('track-cue', { kind: 'track', id: 'track' }, { kind: 'mixer-node', id: 'cue-bus' }),
				edge('cue-aux', { kind: 'mixer-node', id: 'cue-bus' }, { kind: 'output', id: 'aux' }),
			],
		},
	});
}

function strip(id: string, effects: readonly unknown[]) {
	return {
		id, name: id, color: '', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: effects.length > 0, effects, channelCount: 2,
	};
}

function edge(id: string, source: unknown, destination: unknown) {
	return {
		id, kind: 'assignment', source, destination, position: 'post-fader',
		level: 1, enabled: true, channelMap: [0, 1],
	};
}

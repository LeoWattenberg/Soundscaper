/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createAdmBedRouter,
} from '../src/common/editor/engine/adm-bed-routing.ts';
import { buildProjectGraph } from '../src/common/editor/engine/project-graph.ts';
import { createAudioEditorProjectV7 } from '../src/common/editor/project-v7.ts';

const NOW = '2026-07-28T12:34:56.000Z';

function authored(layout: 'mono' | 'stereo' | '5.1', assignments: readonly Record<string, unknown>[] = []) {
	return {
		mode: 'authored' as const,
		programme: { name: 'Programme', language: 'en' },
		content: { name: 'Content', language: 'en' },
		bed: { name: `${layout} bed`, layout, assignments },
	};
}

interface Connection {
	readonly source: MockNode;
	readonly target: MockNode;
	readonly output: number;
	readonly input: number;
}

class MockParam {
	value: number;
	constructor(value = 0) { this.value = value; }
	setValueAtTime(value: number) { this.value = value; }
}

class MockNode {
	readonly kind: string;
	readonly connections: Connection[] = [];
	readonly incoming: Connection[] = [];
	channelCount = 2;
	maxChannelCount?: number;
	channelCountMode = 'max';
	channelInterpretation = 'speakers';

	constructor(kind: string) { this.kind = kind; }

	connect(target: MockNode, output = 0, input = 0) {
		const connection = { source: this, target, output, input };
		this.connections.push(connection);
		target.incoming.push(connection);
		return target;
	}

	disconnect() {}
}

class MockContext {
	readonly sampleRate = 48_000;
	readonly currentTime = 0;
	readonly destination = new MockNode('destination');
	readonly created: MockNode[] = [];

	private node(kind: string, values: Record<string, unknown> = {}) {
		const node = Object.assign(new MockNode(kind), values);
		this.created.push(node);
		return node;
	}

	createGain() { return this.node('gain', { gain: new MockParam(1) }); }
	createStereoPanner() { return this.node('stereo-panner', { pan: new MockParam() }); }
	createChannelSplitter(channelCount: number) { return this.node('channel-splitter', { channelCount }); }
	createChannelMerger(channelCount: number) { return this.node('channel-merger', { channelCount }); }
	createDelay() { return this.node('delay', { delayTime: new MockParam() }); }
	createDynamicsCompressor() {
		return this.node('compressor', {
			threshold: new MockParam(), knee: new MockParam(), ratio: new MockParam(),
			attack: new MockParam(), release: new MockParam(),
		});
	}
}

test('authored ADM creation and metadata updates synchronize the project master width', () => {
	const created = createAudioEditorProjectV7({
		now: NOW,
		masterChannels: 2,
		metadata: { adm: authored('5.1') },
	});
	assert.equal(created.masterChannels, 6);

	const stereo = createAudioEditorProjectV7({ now: NOW });
	const mono = applyEditorCommand(stereo, {
		type: 'metadata/update', changes: { adm: authored('mono') },
	}, { now: NOW });
	assert.equal(mono.masterChannels, 1);
	const surround = applyEditorCommand(mono, {
		type: 'metadata/update', changes: { adm: authored('5.1') },
	}, { now: NOW });
	assert.equal(surround.masterChannels, 6);
	const cleared = applyEditorCommand(surround, {
		type: 'metadata/update', changes: { adm: null },
	}, { now: NOW });
	assert.equal(cleared.masterChannels, 6, 'clearing ADM preserves the explicitly configured master');

});

test('the ADM bed router maps terminal source channels into canonical bed order', () => {
	const context = new MockContext();
	const masterInput = context.createGain();
	const nodes: MockNode[] = [];
	const router = createAdmBedRouter(
		context as unknown as BaseAudioContext,
		nodes as unknown as AudioNode[],
		authored('5.1', [
			{ stripKind: 'track', stripId: 'dialogue', sourceChannel: 0, bedChannel: 'C', gain: 0.75 },
			{ stripKind: 'group', stripId: 'music', sourceChannel: 1, bedChannel: 'R', gain: 1 },
			{ stripKind: 'send', stripId: 'reverb', sourceChannel: 0, bedChannel: 'Ls', gain: 0.5 },
		]),
		masterInput as unknown as AudioNode,
	);
	assert.ok(router);
	assert.equal(router.channelCount, 6);
	assert.deepEqual(router.channelOrder, ['L', 'R', 'C', 'LFE', 'Ls', 'Rs']);
	assert.equal(router.merger.channelCountMode, 'explicit');
	assert.equal(router.merger.channelInterpretation, 'discrete');
	assert.equal(masterInput.channelCount, 6);
	assert.equal(masterInput.channelCountMode, 'explicit');
	assert.equal(masterInput.channelInterpretation, 'discrete');

	const dialogue = new MockNode('dialogue-output');
	const music = new MockNode('music-output');
	const reverb = new MockNode('reverb-output');
	assert.equal(router.routeTerminal('track', 'dialogue', dialogue as unknown as AudioNode, 6), true);
	assert.equal(router.routeTerminal('group', 'music', music as unknown as AudioNode), true);
	assert.equal(router.routeTerminal('send', 'reverb', reverb as unknown as AudioNode), true);
	assert.equal(router.routeTerminal('track', 'unassigned', new MockNode('unused') as unknown as AudioNode), false);

	const merger = router.merger as unknown as MockNode;
	assert.deepEqual(merger.incoming.map(({ input }) => input).sort(), [1, 2, 4]);
	assert.deepEqual(merger.incoming.map(({ source }) => (source as unknown as { gain: MockParam }).gain.value).sort(), [0.5, 0.75, 1]);
	assert.equal(masterInput.incoming[0]?.source, merger);
	assert.deepEqual(dialogue.connections.map(({ target }) => target.kind), ['channel-splitter']);
	assert.equal(dialogue.connections[0]?.target.channelCount, 6);
	assert.equal(dialogue.connections[0]?.target.connections[0]?.output, 0);
	assert.equal(music.connections[0]?.target.connections[0]?.output, 1);
});

test('project graph routes terminal tracks, groups, and sends after latency compensation', () => {
	const context = new MockContext();
	context.destination.maxChannelCount = 8;
	const project = {
		sampleRate: 48_000,
		masterChannels: 6,
		metadata: { adm: authored('5.1', [
			{ stripKind: 'track', stripId: 'dry', sourceChannel: 5, bedChannel: 'L', gain: 1 },
			{ stripKind: 'group', stripId: 'group', sourceChannel: 0, bedChannel: 'R', gain: 1 },
			{ stripKind: 'send', stripId: 'send', sourceChannel: 0, bedChannel: 'C', gain: 1 },
		]) },
		sources: [{ id: 'surround-source', channelCount: 6 }, { id: 'stereo-source', channelCount: 2 }],
		clips: [
			{ id: 'dry-clip', sourceId: 'surround-source' },
			{ id: 'routed-clip', sourceId: 'stereo-source' },
		],
		tracks: [
			{ id: 'dry', type: 'audio', clipIds: ['dry-clip'], effects: [], gain: 1, pan: 0 },
			{ id: 'routed', type: 'audio', clipIds: ['routed-clip'], effects: [], gain: 1, pan: 0 },
		],
		mixer: {
			groups: [{
				id: 'group', gain: 1, pan: 0,
				effects: [{ id: 'limiter', type: 'limiter', enabled: true, params: { lookahead: 0.01 } }],
			}],
			sends: [{ id: 'send', gain: 1, pan: 0, effects: [] }],
			routes: { routed: { groupId: 'group', sends: { send: 1 } } },
		},
		master: { gain: 1, pan: 0, effects: [] },
	};
	buildProjectGraph(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		project,
		{ metering: false, monitoring: true },
	);
	const merger = context.created.find((node) => node.kind === 'channel-merger');
	assert.ok(merger);
	assert.equal(merger.channelCount, 6);
	assert.deepEqual(merger.incoming.map(({ input }) => input).sort(), [0, 1, 2]);
	const splitters = context.created.filter((node) => node.kind === 'channel-splitter');
	assert.equal(splitters.length, 3);
	assert.deepEqual(splitters.map(({ channelCount }) => channelCount).sort((left, right) => left - right), [2, 2, 6]);
	assert.ok(
		splitters.some((splitter) => splitter.incoming[0]?.source.kind === 'delay'),
		'the direct track reaches its ADM splitter after bus-latency compensation',
	);
	assert.equal(context.created.some((node) => node.kind === 'stereo-panner'), false);
	assert.equal(context.destination.channelCount, 6);
	assert.equal(context.destination.channelCountMode, 'explicit');
	assert.equal(context.destination.channelInterpretation, 'discrete');
});

test('the production mixer graph routes its authored ADM bed too', () => {
	// The V21 graph builder returns before the legacy ADM stage, so on the schema
	// the product actually mounts the authored assignments reached no sample: the
	// master-destined edges summed through their own channel maps instead, and the
	// bed-channel and gain controls the operator authored did nothing at all.
	const channels = [0, 1, 2, 3, 4, 5];
	const context = new MockContext();
	context.destination.maxChannelCount = 8;
	const project = {
		schemaVersion: 21,
		sampleRate: 48_000,
		masterChannels: 6,
		metadata: { adm: authored('5.1', [
			{ stripKind: 'track', stripId: 'dialogue', sourceChannel: 0, bedChannel: 'C', gain: 0.5 },
			{ stripKind: 'track', stripId: 'music', sourceChannel: 0, bedChannel: 'L', gain: 1 },
			{ stripKind: 'track', stripId: 'music', sourceChannel: 1, bedChannel: 'R', gain: 1 },
		]) },
		tracks: ['dialogue', 'music'].map((id) => ({
			type: 'audio', id, clipIds: [], gain: 1, pan: 0,
			mute: false, solo: false, effectsActive: true, effects: [],
		})),
		master: { gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [] },
		mixer: {
			schemaVersion: 1,
			groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 6 }],
			edges: [
				...['dialogue', 'music'].map((id) => ({
					id: `assignment:track:${id}:master`, kind: 'assignment',
					source: { kind: 'track', id }, destination: { kind: 'master' },
					position: 'post-fader', level: 1, enabled: true, channelMap: channels,
				})),
				{
					id: 'assignment:master:output:main', kind: 'assignment',
					source: { kind: 'master' }, destination: { kind: 'output', id: 'main' },
					position: 'post-fader', level: 1, enabled: true, channelMap: channels,
				},
			],
		},
		automationLanes: [],
	};
	buildProjectGraph(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		project as never,
		{ metering: false, monitoring: true },
	);

	const merger = context.created.find((node) => node.kind === 'channel-merger');
	assert.ok(merger, 'the bed merger is built');
	assert.equal(merger.channelCount, 6);
	assert.deepEqual(
		merger.incoming.map(({ input }) => input).sort(),
		[0, 1, 2],
		'every authored bed channel is fed, and only those',
	);
	assert.deepEqual(
		merger.incoming.map(({ source }) => (source as unknown as { gain: MockParam }).gain.value).sort(),
		[0.5, 1, 1],
		'the authored per-assignment gains reach the graph',
	);
	assert.equal(context.created.filter((node) => node.kind === 'channel-splitter').length, 2);
	assert.equal(
		context.created.some((node) => node.kind === 'stereo-panner'),
		false,
		'a stereo panner would fold the bed back down to two channels',
	);
});

test('ordinary projects retain the direct master mix path', () => {
	const context = new MockContext();
	buildProjectGraph(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		{
			sampleRate: 48_000, masterChannels: 2,
			tracks: [{ id: 'track', type: 'audio', clipIds: [], effects: [], gain: 1, pan: 0 }],
			master: { gain: 1, pan: 0, effects: [] },
		},
		{ metering: false },
	);
	assert.equal(context.created.some((node) => node.kind === 'channel-merger'), false);
	assert.equal(context.created.some((node) => node.kind === 'channel-splitter'), false);
	assert.equal(context.created.some((node) => node.kind === 'stereo-panner'), true);
	assert.ok(context.destination.incoming.length > 0);
});

test('authored mono and passthrough multichannel graphs never enter stereo panners', () => {
	for (const [masterChannels, adm] of [
		[1, authored('mono', [{
			stripKind: 'track', stripId: 'track', sourceChannel: 0, bedChannel: 'M', gain: 1,
		}])],
		[6, { mode: 'passthrough' }],
	] as const) {
		const context = new MockContext();
		buildProjectGraph(
			context as unknown as BaseAudioContext,
			context.destination as unknown as AudioNode,
			{
				sampleRate: 48_000, masterChannels, metadata: { adm },
				sources: [{ id: 'source', channelCount: masterChannels }],
				clips: [{ id: 'clip', sourceId: 'source' }],
				tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'], effects: [], gain: 1, pan: 0 }],
				master: { gain: 1, pan: 0, effects: [] },
			},
			{ metering: false },
		);
		assert.equal(context.created.some((node) => node.kind === 'stereo-panner'), false);
	}
});

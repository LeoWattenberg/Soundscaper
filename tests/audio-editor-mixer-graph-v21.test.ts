/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createDefaultMixerGraphV21,
	normalizeMixerGraphV21,
	validateMixerGraphV21,
} from '../src/common/editor/mixer-graph-v21.ts';
import { mixerTrackSurfaceRouteV21 } from '../src/common/editor/mixer-graph-surface-v21.ts';

const context = Object.freeze({
	audioTracks: Object.freeze([
		Object.freeze({ id: 'voice', effects: Object.freeze([{ id: 'voice-fx' }]) }),
		Object.freeze({ id: 'music', effects: Object.freeze([]) }),
	]),
	masterEffects: Object.freeze([{ id: 'master-fx' }]),
	masterChannels: 2,
});

test('creates one explicit assignment per audio track and one main output path', () => {
	const graph = createDefaultMixerGraphV21(context.audioTracks);
	assert.equal(graph.schemaVersion, 1);
	assert.deepEqual(graph.groups, []);
	assert.deepEqual(graph.sends, []);
	assert.deepEqual(graph.cues, []);
	assert.deepEqual(graph.vcas, []);
	assert.deepEqual(graph.outputs, [{ id: 'main', name: 'Main output', role: 'main', channelCount: 2 }]);
	assert.deepEqual(graph.edges.map(({ id, source, destination, kind }) => ({ id, source, destination, kind })), [
		{ id: 'assignment:track:voice:master', source: { kind: 'track', id: 'voice' }, destination: { kind: 'master' }, kind: 'assignment' },
		{ id: 'assignment:track:music:master', source: { kind: 'track', id: 'music' }, destination: { kind: 'master' }, kind: 'assignment' },
		{ id: 'assignment:master:output:main', source: { kind: 'master' }, destination: { kind: 'output', id: 'main' }, kind: 'assignment' },
	]);
	assert.equal(validateMixerGraphV21(graph, context), true);
});

test('default assignments adapt authoritative terminal widths without missing source channels', () => {
	const stereo = createDefaultMixerGraphV21([
		{ id: 'mono', channelCount: 1 },
		{ id: 'stereo', channelCount: 2 },
		{ id: 'surround', channelCount: 6 },
	], 2);
	assert.deepEqual(stereo.edges.slice(0, 3).map(({ channelMap }) => channelMap), [
		[0, 0],
		[0, 1],
		[0, 1],
	]);
	const surround = createDefaultMixerGraphV21([
		{ id: 'mono', channelCount: 1 },
		{ id: 'stereo', channelCount: 2 },
	], 6);
	assert.deepEqual(surround.edges.slice(0, 2).map(({ channelMap }) => channelMap), [
		[0, 0, -1, -1, -1, -1],
		[0, 1, -1, -1, -1, -1],
	]);
});

test('the compact mixer reads only canonical V21 assignment and send edges', () => {
	const base = createDefaultMixerGraphV21([{ id: 'voice', channelCount: 2 }]);
	const graph = normalizeMixerGraphV21({
		...base,
		groups: [strip('dialogue')],
		sends: [strip('reverb')],
		edges: [
			...base.edges.filter(({ source }) => source.kind !== 'track'),
			edge(
				'assignment:track:voice:mixer-node:dialogue',
				{ kind: 'track', id: 'voice' },
				{ kind: 'mixer-node', id: 'dialogue' },
			),
			edge(
				'assignment:mixer-node:dialogue:master',
				{ kind: 'mixer-node', id: 'dialogue' },
				{ kind: 'master' },
			),
			edge(
				'assignment:mixer-node:reverb:master',
				{ kind: 'mixer-node', id: 'reverb' },
				{ kind: 'master' },
			),
			edge(
				'send:track:voice:mixer-node:reverb',
				{ kind: 'track', id: 'voice' },
				{ kind: 'mixer-node', id: 'reverb' },
				{ kind: 'send', level: 0.5 },
			),
		],
	});
	assert.deepEqual(mixerTrackSurfaceRouteV21(graph, 'voice'), {
		groupId: 'dialogue', sends: { reverb: 0.5 },
		groupEditable: true, editableSendIds: ['reverb'],
	});
	const advanced = normalizeMixerGraphV21({
		...graph,
		edges: graph.edges.map((value) => value.id === 'send:track:voice:mixer-node:reverb'
			? { ...value, id: 'authored-parallel-send' } : value),
	});
	assert.deepEqual(mixerTrackSurfaceRouteV21(advanced, 'voice').editableSendIds, []);
});

test('normalizes nested buses, multiple assignments, sends, cues, VCAs, outputs, sidechains, and channel maps', () => {
	const graph = normalizeMixerGraphV21({
		schemaVersion: 1,
		groups: [strip('dialogue'), strip('stem')],
		sends: [strip('reverb')],
		cues: [strip('talent-cue')],
		vcas: [{ id: 'all-dialogue', name: 'All dialogue', gain: 1, mute: false, members: [
			{ kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'dialogue' },
		] }],
		outputs: [
			{ id: 'main', name: 'Main', role: 'main', channelCount: 6 },
			{ id: 'phones', name: 'Phones', role: 'cue', channelCount: 2 },
		],
		edges: [
			edge('voice-dialogue', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'dialogue' }),
			edge('dialogue-stem', { kind: 'mixer-node', id: 'dialogue' }, { kind: 'mixer-node', id: 'stem' }),
			edge('music-stem', { kind: 'track', id: 'music' }, { kind: 'mixer-node', id: 'stem' }),
			edge('stem-master', { kind: 'mixer-node', id: 'stem' }, { kind: 'master' }, { channelMap: [0, 1, 0, 1, -1, -1] }),
			edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
			edge('voice-reverb', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'reverb' }, { kind: 'send', position: 'pre-fader', level: 0.5 }),
			edge('reverb-master', { kind: 'mixer-node', id: 'reverb' }, { kind: 'master' }),
			edge('voice-cue', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'talent-cue' }, { kind: 'send', position: 'post-fader' }),
			edge('cue-phones', { kind: 'mixer-node', id: 'talent-cue' }, { kind: 'output', id: 'phones' }),
			{
				...edge('music-duck', { kind: 'track', id: 'music' }, {
					kind: 'effect-sidechain', strip: { kind: 'track', id: 'voice' }, effectId: 'voice-fx',
				}),
				kind: 'sidechain',
			},
		],
	});
	assert.equal(validateMixerGraphV21(graph, { ...context, masterChannels: 6 }), true);
	assert.equal(Object.isFrozen(graph), true);
	assert.equal(Object.isFrozen(graph.edges), true);
	assert.equal(Object.isFrozen(graph.edges[3]!.channelMap), true);
	assert.equal(graph.edges[5]!.position, 'pre-fader');
	assert.equal(graph.edges[5]!.level, 0.5);
});

test('rejects cycles across assignments, sends, and sidechains without repairing', () => {
	const base = graphWithGroups();
	const baseEdges = base.edges as readonly unknown[];
	for (const candidate of [
		{ ...base, edges: [...baseEdges, edge('cycle', { kind: 'mixer-node', id: 'stem' }, { kind: 'mixer-node', id: 'dialogue' })] },
		{ ...base, edges: [...baseEdges, edge('send-cycle', { kind: 'mixer-node', id: 'stem' }, { kind: 'mixer-node', id: 'dialogue' }, { kind: 'send' })] },
		{ ...base, edges: [...baseEdges, { ...edge('sidechain-cycle', { kind: 'mixer-node', id: 'stem' }, {
			kind: 'effect-sidechain', strip: { kind: 'mixer-node', id: 'dialogue' }, effectId: 'dialogue-fx',
		}), kind: 'sidechain' }] },
	]) {
		assert.throws(() => validateMixerGraphV21(candidate, {
			...context,
			audioTracks: context.audioTracks,
			mixerNodeEffects: new Map([['dialogue', [{ id: 'dialogue-fx' }]]]),
		}), /cycle/iu);
	}
});

test('rejects dangling identities, duplicate IDs, wrong endpoint roles, and unreachable tracks', () => {
	const valid = createDefaultMixerGraphV21(context.audioTracks);
	const cases: readonly [unknown, RegExp][] = [
		[{ ...valid, edges: [...valid.edges, { ...valid.edges[0], id: valid.edges[1]!.id }] }, /duplicate.*edge/iu],
		[{ ...valid, edges: valid.edges.map((value, index) => index ? value : { ...value, source: { kind: 'track', id: 'missing' } }) }, /missing.*track/iu],
		[{ ...valid, edges: valid.edges.map((value, index) => index ? value : { ...value, source: { kind: 'output', id: 'main' } }) }, /source|output/iu],
		[{ ...valid, edges: valid.edges.filter((edgeValue) => edgeValue.source.kind !== 'track' || edgeValue.source.id !== 'voice') }, /voice.*output|output.*voice|reachable/iu],
		[{ ...valid, outputs: [...valid.outputs, { ...valid.outputs[0], id: 'other', role: 'main' }] }, /one main/iu],
	];
	for (const [candidate, message] of cases) assert.throws(() => validateMixerGraphV21(candidate, context), message);
});

test('rejects accessors, symbols, sparse arrays, noncanonical numbers, and graph overflow', () => {
	const valid = createDefaultMixerGraphV21(context.audioTracks);
	assert.throws(() => normalizeMixerGraphV21(Object.defineProperty({}, 'schemaVersion', { enumerable: true, get: () => 1 })), /data propert|field/iu);
	assert.throws(() => normalizeMixerGraphV21({ ...valid, [Symbol('hidden')]: true }), /symbol|field/iu);
	const sparse = new Array(1);
	assert.throws(() => normalizeMixerGraphV21({ ...valid, edges: sparse }), /data property|dense|array/iu);
	assert.throws(() => normalizeMixerGraphV21({ ...valid, edges: valid.edges.map((value, index) => index ? value : { ...value, level: -0 }) }), /level|negative zero/iu);
	assert.throws(() => normalizeMixerGraphV21({ ...valid, groups: Array.from({ length: 4_097 }, (_, index) => strip(`g-${index}`)) }), /4,096|4096|maximum/iu);
});

function strip(id: string): Readonly<Record<string, unknown>> {
	return { id, name: id, color: '#4f87c8', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: true, effectsActive: true, effects: [], channelCount: 2 };
}

function edge(
	id: string,
	source: Readonly<Record<string, unknown>>,
	destination: Readonly<Record<string, unknown>>,
	overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
	return { id, kind: 'assignment', source, destination, position: 'post-fader', level: 1,
		enabled: true, channelMap: [], ...overrides };
}

function graphWithGroups(): Readonly<Record<string, unknown>> {
	return {
		schemaVersion: 1,
		groups: [
			{ ...strip('dialogue'), effects: [{ id: 'dialogue-fx' }] },
			strip('stem'),
		],
		sends: [], cues: [], vcas: [],
		outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
		edges: [
			edge('voice-dialogue', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'dialogue' }),
			edge('dialogue-stem', { kind: 'mixer-node', id: 'dialogue' }, { kind: 'mixer-node', id: 'stem' }),
			edge('music-stem', { kind: 'track', id: 'music' }, { kind: 'mixer-node', id: 'stem' }),
			edge('stem-master', { kind: 'mixer-node', id: 'stem' }, { kind: 'master' }),
			edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
		],
	};
}

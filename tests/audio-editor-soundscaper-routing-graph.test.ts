/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { MixerEdgeV21, MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import {
	addSoundscaperRoutingItem,
	connectSoundscaperRoutingEdge,
	removeSoundscaperRoutingItem,
	rewireSoundscaperRoutingEdge,
	updateSoundscaperRoutingEdge,
	updateSoundscaperRoutingNode,
	updateSoundscaperRoutingOutput,
} from '../src/common/editor/ui/workspace/soundscaper-routing-graph-candidates.ts';
import { layoutSoundscaperRoutingGraph } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-layout.ts';
import { routingStaticEdgeLevel } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-gesture.ts';

test('routing graph layout is deterministic, topological, and keeps VCA controls in their own rail', () => {
	const graph = routedGraph({
		groups: [strip('dialogue', 'Dialogue')],
		vcas: [{ id: 'all', name: 'All', gain: 1, mute: false, members: [{ kind: 'track', id: 'voice' }] }],
		edges: [
			edge('voice-dialogue', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'dialogue' }),
			edge('voice-dialogue:2', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'dialogue' }),
			edge('dialogue-master', { kind: 'mixer-node', id: 'dialogue' }, { kind: 'master' }),
			edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
			{ ...edge('disabled-back', { kind: 'master' }, { kind: 'mixer-node', id: 'dialogue' }), enabled: false },
		],
	});

	const first = layoutSoundscaperRoutingGraph(PROJECT, graph);
	const second = layoutSoundscaperRoutingGraph(PROJECT, graph);
	assert.deepEqual(first, second);
	const byKey = new Map(first.nodes.map((node) => [node.key, node]));
	assert.ok(byKey.get('track:voice')!.x < byKey.get('mixer-node:dialogue')!.x);
	assert.ok(byKey.get('mixer-node:dialogue')!.x < byKey.get('master')!.x);
	assert.ok(byKey.get('master')!.x < byKey.get('output:main')!.x);
	assert.equal(byKey.get('vca:all')!.rail, 'control');
	assert.ok(first.width >= byKey.get('output:main')!.x + byKey.get('output:main')!.width);
	const parallel = first.edges.filter(({ sourceKey, destinationKey }) => (
		sourceKey === 'track:voice' && destinationKey === 'mixer-node:dialogue'
	));
	assert.equal(parallel.length, 2);
	assert.notEqual(parallel[0]?.path, parallel[1]?.path);
	assert.notEqual(parallel[0]?.parallelOffset, parallel[1]?.parallelOffset);
});

test('routing graph creates cues, VCAs, and reachable auxiliary outputs with stable selections', () => {
	const cue = addSoundscaperRoutingItem(PROJECT, PROJECT.mixer, 'cue');
	assert.equal(cue.selection.kind, 'node');
	assert.equal(cue.graph.cues.length, 1);

	const vca = addSoundscaperRoutingItem({ ...PROJECT, mixer: cue.graph }, cue.graph, 'vca');
	assert.equal(vca.selection.kind, 'vca');
	assert.equal(vca.graph.vcas.length, 1);

	const output = addSoundscaperRoutingItem({ ...PROJECT, mixer: vca.graph }, vca.graph, 'output');
	const addedOutput = output.graph.outputs.at(-1)!;
	assert.equal(addedOutput.role, 'auxiliary');
	assert.ok(output.graph.edges.some((candidate) => (
		candidate.source.kind === 'master'
		&& candidate.destination.kind === 'output'
		&& candidate.destination.id === addedOutput.id
	)));
});

test('captured edge automation does not become a duplicate static mixer edit', () => {
	assert.equal(routingStaticEdgeLevel(1, 0.25, true), 1);
	assert.equal(routingStaticEdgeLevel(1, 0.25, false), 0.25);
});

test('new connections choose their semantic kind and map while parallel edges receive suffixes', () => {
	const send = strip('reverb', 'Reverb');
	const graph = routedGraph({ sends: [send] });
	const first = connectSoundscaperRoutingEdge(PROJECT, graph,
		{ kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'reverb' });
	const firstEdge = first.graph.edges.find(({ id }) => id === first.selection.id)!;
	assert.equal(firstEdge.kind, 'send');
	assert.deepEqual(firstEdge.channelMap, [0, 1]);

	const second = connectSoundscaperRoutingEdge({ ...PROJECT, mixer: first.graph }, first.graph,
		{ kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'reverb' });
	assert.notEqual(second.selection.id, first.selection.id);
	assert.match(second.selection.id, /:2$/u);
});

test('rewiring preserves edge identity and advanced attributes while resetting the channel map', () => {
	const graph = routedGraph({
		groups: [strip('mono', 'Mono', 1)],
		edges: [
			{ ...edge('voice-master', { kind: 'track', id: 'voice' }, { kind: 'master' }), level: 0.5, position: 'pre-fader' },
			edge('mono-master', { kind: 'mixer-node', id: 'mono' }, { kind: 'master' }, [0, 0]),
			edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
		],
	});
	const result = rewireSoundscaperRoutingEdge(PROJECT, graph, 'voice-master',
		{ kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'mono' });
	const rewired = result.graph.edges.find(({ id }) => id === 'voice-master')!;
	assert.equal(rewired.id, 'voice-master');
	assert.equal(rewired.level, 0.5);
	assert.equal(rewired.position, 'pre-fader');
	assert.deepEqual(rewired.channelMap, [0]);
});

test('channel-count edits reset incident default maps but preserve custom maps and reject invalid ones', () => {
	const defaultGraph = routedGraph({
		groups: [strip('stem', 'Stem')],
		edges: [
			edge('voice-stem', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'stem' }),
			edge('stem-master', { kind: 'mixer-node', id: 'stem' }, { kind: 'master' }),
			edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
		],
	});
	const narrowed = updateSoundscaperRoutingNode(PROJECT, defaultGraph, 'groups', 'stem', {
		name: 'Stem', channelCount: 1,
	});
	assert.deepEqual(narrowed.graph.edges.find(({ id }) => id === 'voice-stem')?.channelMap, [0]);
	assert.deepEqual(narrowed.graph.edges.find(({ id }) => id === 'stem-master')?.channelMap, [0, 0]);

	const customGraph = {
		...defaultGraph,
		edges: defaultGraph.edges.map((candidate) => candidate.id === 'stem-master'
			? { ...candidate, channelMap: [1, 0] } : candidate),
	};
	const widened = updateSoundscaperRoutingNode(PROJECT, customGraph, 'groups', 'stem', {
		name: 'Stem', channelCount: 3,
	});
	assert.deepEqual(widened.graph.edges.find(({ id }) => id === 'stem-master')?.channelMap, [1, 0]);
	assert.throws(() => updateSoundscaperRoutingNode(PROJECT, customGraph, 'groups', 'stem', {
		name: 'Stem', channelCount: 1,
	}), /missing source channel/u);
});

test('promoting an output atomically demotes the previous main and invalid cascades are refused', () => {
	const withOutput = addSoundscaperRoutingItem(PROJECT, PROJECT.mixer, 'output').graph;
	const auxiliary = withOutput.outputs.find(({ role }) => role === 'auxiliary')!;
	const promoted = updateSoundscaperRoutingOutput(
		{ ...PROJECT, mixer: withOutput }, withOutput, auxiliary.id,
		{ name: auxiliary.name, role: 'main', channelCount: auxiliary.channelCount },
	);
	assert.equal(promoted.graph.outputs.find(({ id }) => id === auxiliary.id)?.role, 'main');
	assert.equal(promoted.graph.outputs.find(({ id }) => id === 'main')?.role, 'auxiliary');

	assert.throws(() => removeSoundscaperRoutingItem(PROJECT, PROJECT.mixer, { kind: 'edge', id: 'voice-master' }),
		/cannot reach an output/u);
	assert.throws(() => removeSoundscaperRoutingItem(PROJECT, PROJECT.mixer, { kind: 'output', id: 'main' }),
		/exactly one main output/u);
});

test('folder authority rejects canonical node and assignment edits while allowing parallel authored routes', () => {
	const canonical = FOLDER_PROJECT.mixer.edges.find(({ id }) => id === 'assignment:track:voice:mixer-node:dialogue')!;
	assert.throws(() => updateSoundscaperRoutingNode(
		FOLDER_PROJECT, FOLDER_PROJECT.mixer, 'groups', 'dialogue',
		{ name: 'Dialogue', channelCount: 1 },
	), /managed by its track folder/iu);
	assert.throws(() => updateSoundscaperRoutingEdge(
		FOLDER_PROJECT, FOLDER_PROJECT.mixer, canonical.id,
		{ ...canonical, level: 0.5 },
	), /managed by the track-folder hierarchy/iu);
	assert.throws(() => rewireSoundscaperRoutingEdge(
		FOLDER_PROJECT, FOLDER_PROJECT.mixer, canonical.id,
		canonical.source, { kind: 'master' },
	), /managed by the track-folder hierarchy/iu);
	assert.throws(() => removeSoundscaperRoutingItem(
		FOLDER_PROJECT, FOLDER_PROJECT.mixer, { kind: 'edge', id: canonical.id },
	), /managed by the track-folder hierarchy/iu);

	const authored = connectSoundscaperRoutingEdge(
		FOLDER_PROJECT, FOLDER_PROJECT.mixer,
		{ kind: 'mixer-node', id: 'dialogue' }, { kind: 'master' },
	);
	assert.equal(authored.graph.edges.length, FOLDER_PROJECT.mixer.edges.length + 1);
	assert.notEqual(authored.selection.id, 'assignment:mixer-node:dialogue:master');
	const authoredEdge = authored.graph.edges.find(({ id }) => id === authored.selection.id)!;
	const adjusted = updateSoundscaperRoutingEdge(
		{ ...FOLDER_PROJECT, mixer: authored.graph }, authored.graph, authoredEdge.id,
		{ ...authoredEdge, level: 0.5 },
	);
	assert.equal(adjusted.graph.edges.find(({ id }) => id === authoredEdge.id)?.level, 0.5);
});

const PROJECT = Object.freeze({
	schemaVersion: 21,
	masterChannels: 2,
	master: Object.freeze({ effects: Object.freeze([]) }),
	tracks: Object.freeze([Object.freeze({
		id: 'voice', type: 'audio', name: 'Voice', effects: Object.freeze([]),
	})]),
	trackFolders: Object.freeze([]),
	sequences: Object.freeze([]),
	mixer: routedGraph({}),
});

const FOLDER_PROJECT = Object.freeze({
	...PROJECT,
	trackFolders: Object.freeze([Object.freeze({ id: 'dialogue', name: 'Dialogue' })]),
	sequences: Object.freeze([Object.freeze({
		trackNodes: Object.freeze([
			Object.freeze({ kind: 'folder', id: 'dialogue', parentFolderId: null }),
			Object.freeze({ kind: 'track', id: 'voice', parentFolderId: 'dialogue' }),
		]),
	})]),
	mixer: routedGraph({
		groups: [strip('dialogue', 'Dialogue')],
		edges: [
			edge('assignment:track:voice:mixer-node:dialogue', { kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: 'dialogue' }),
			edge('assignment:mixer-node:dialogue:master', { kind: 'mixer-node', id: 'dialogue' }, { kind: 'master' }),
			edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
		],
	}),
});

function routedGraph(overrides: Partial<MixerGraphV21>): MixerGraphV21 {
	return {
		schemaVersion: 1,
		groups: [], sends: [], cues: [], vcas: [],
		outputs: [{ id: 'main', name: 'Main output', role: 'main', channelCount: 2 }],
		edges: [
			edge('voice-master', { kind: 'track', id: 'voice' }, { kind: 'master' }),
			edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' }),
		],
		...overrides,
	};
}

function strip(id: string, name: string, channelCount = 2) {
	return {
		id, name, color: '', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount,
	};
}

function edge(
	id: string,
	source: MixerEdgeV21['source'],
	destination: MixerEdgeV21['destination'],
	channelMap: readonly number[] = [0, 1],
): MixerEdgeV21 {
	return {
		id, kind: destination.kind === 'effect-sidechain' ? 'sidechain' : 'assignment',
		source, destination, position: 'post-fader', level: 1, enabled: true, channelMap,
	};
}

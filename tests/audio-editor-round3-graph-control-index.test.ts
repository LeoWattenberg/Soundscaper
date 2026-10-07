/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareProjectEdgeGeometryV21 } from '../src/common/editor/engine/project-edge-geometry-v21.ts';
import { createProjectSoloGainResolverV21, createProjectVcaGainResolverV21 } from '../src/common/editor/engine/project-strip-control-index-v21.ts';
import { edgeDestinationWidth, admTerminalStrip } from '../src/common/editor/engine/project-graph-v21-edges.ts';
import { createDefaultMixerGraphV21, type MixerEdgeV21, type MixerStripV21, type MixerVcaV21 } from '../src/common/editor/mixer-graph-v21.ts';

function strip(id: string, width = 2): MixerStripV21 {
	return { id, name: id, color: '', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: false, effects: [], channelCount: width };
}

test('graph edge geometry avoids repeat track, mixer, output and group scans and owns current widths', () => {
	let trackReads = 0;
	let mixerReads = 0;
	let outputReads = 0;
	let groupReads = 0;
	let groupWidth = 6;
	const tracks = Array.from({ length: 100 }, (_, index) => ({
		get id() { trackReads += 1; return `track-${String(index)}`; },
	}));
	const graph = createDefaultMixerGraphV21([{ id: 'track-99' }]);
	const group = { ...strip('group'), get id() { groupReads += 1; return 'group'; },
		get channelCount() { mixerReads += 1; return groupWidth; } };
	const mixer = { ...graph, groups: [group], sends: [strip('send', 4)], outputs: [{
		...graph.outputs[0]!, get channelCount() { outputReads += 1; return 8; },
	}] };
	const widths = new Map([['track-99', 4], ['', 3], ['orphan', 12]]);
	const prepared = prepareProjectEdgeGeometryV21(mixer, tracks, widths, 2);
	const initial = [trackReads, mixerReads, outputReads, groupReads];
	const template = graph.edges[0]!;
	for (let iteration = 0; iteration < 100; iteration += 1) {
		assert.equal(prepared.destinationWidth({ ...template, destination: { kind: 'effect-sidechain',
			strip: { kind: 'track', id: 'track-99' }, effectId: 'effect' } }), 4);
		assert.equal(prepared.destinationWidth({ ...template, destination: { kind: 'mixer-node', id: 'group' } }), 6);
		assert.equal(prepared.destinationWidth(graph.edges.at(-1)!), 8);
		assert.equal(prepared.isGroup('group'), true);
		assert.deepEqual(prepared.admTerminal({ kind: 'mixer-node', id: 'group' }), { kind: 'group', id: 'group' });
	}
	assert.deepEqual([trackReads, mixerReads, outputReads, groupReads], initial);
	assert.equal(trackReads, 100);
	assert.equal(mixerReads, 1);
	assert.equal(outputReads, 1);
	assert.equal(prepared.destinationWidth({ ...template, destination: { kind: 'effect-sidechain',
		strip: { kind: 'track', id: 'orphan' }, effectId: 'effect' } }), 3);
	groupWidth = 7;
	widths.set('track-99', 5);
	assert.equal(prepared.destinationWidth({ ...template, destination: { kind: 'mixer-node', id: 'group' } }), 6);
	const next = prepareProjectEdgeGeometryV21(mixer, tracks, widths, 2);
	assert.equal(next.destinationWidth({ ...template, destination: { kind: 'mixer-node', id: 'group' } }), 7);
});

test('prepared edge geometry matches direct lookup semantics for every destination and first duplicate', () => {
	const tracks = [{ id: 'one' }, { id: 'two' }];
	const graph = { ...createDefaultMixerGraphV21(tracks), groups: [strip('same', 6)],
		sends: [strip('same', 8), strip('send', 4)], cues: [strip('cue', 3)] };
	const widths = new Map([['one', 1], ['two', 2]]);
	const prepared = prepareProjectEdgeGeometryV21(graph, tracks, widths, 6);
	const destinations: MixerEdgeV21['destination'][] = [
		{ kind: 'master' }, { kind: 'output', id: 'main' },
		...['same', 'send', 'cue'].map(id => ({ kind: 'mixer-node' as const, id })),
		{ kind: 'effect-sidechain', strip: { kind: 'master' }, effectId: 'fx' },
		{ kind: 'effect-sidechain', strip: { kind: 'track', id: 'one' }, effectId: 'fx' },
		{ kind: 'effect-sidechain', strip: { kind: 'track', id: 'missing' }, effectId: 'fx' },
		{ kind: 'effect-sidechain', strip: { kind: 'mixer-node', id: 'same' }, effectId: 'fx' },
	];
	for (const destination of destinations) {
		const edge = { ...graph.edges[0]!, destination };
		assert.equal(prepared.destinationWidth(edge), edgeDestinationWidth(edge, graph, tracks, widths, 6));
	}
	for (const source of [graph.edges[0]!.source, { kind: 'master' as const },
		{ kind: 'mixer-node' as const, id: 'same' }, { kind: 'mixer-node' as const, id: 'send' }]) {
		assert.deepEqual(prepared.admTerminal(source), admTerminalStrip(graph, source));
	}
	assert.throws(() => prepared.destinationWidth({ ...graph.edges[0]!, destination: { kind: 'mixer-node', id: 'absent' } }), /Unknown V21 mixer node: absent/u);
	assert.throws(() => prepared.destinationWidth({ ...graph.edges[0]!, destination: { kind: 'output', id: 'absent' } }), TypeError);
});

test('VCA gain preparation retains authored multiplication order and visits membership once', () => {
	let reads = 0;
	const member = { kind: 'track' as const, get id() { reads += 1; return 'one'; } };
	const vcas: MixerVcaV21[] = [
		{ id: 'first', name: '', gain: 0.7, mute: false, members: [member, member, { kind: 'master' }] },
		{ id: 'second', name: '', gain: 0.3, mute: false, members: [member, { kind: 'master' }] },
		{ id: 'third', name: '', gain: 0.9, mute: false, members: [member] },
	];
	const prepared = createProjectVcaGainResolverV21(vcas);
	const initialReads = reads;
	for (let iteration = 0; iteration < 100; iteration += 1) {
		assert.equal(prepared({ kind: 'track', id: 'one' }, true), ((1 * 0.7) * 0.3) * 0.9);
		assert.equal(prepared({ kind: 'master' }, true), 0.7 * 0.3);
		assert.equal(prepared({ kind: 'master' }, false), 1);
		assert.equal(prepared({ kind: 'track', id: 'absent' }, true), 1);
	}
	assert.equal(reads, initialReads);
	assert.equal(createProjectVcaGainResolverV21([{ ...vcas[0]!, mute: true }])({ kind: 'track', id: 'one' }, true), 0);
});

test('solo audibility retains a bounded graph result instead of retraversing routing on every parameter update', (context) => {
	const tracks = [{ id: 'one', solo: true }, { id: 'two', solo: false }];
	const graph = createDefaultMixerGraphV21(tracks);
	const heard = createProjectSoloGainResolverV21(graph, tracks, true);
	let visits = 0;
	const original = Set.prototype.has;
	context.mock.method(Set.prototype, 'has', function(this: Set<unknown>, key: unknown): boolean {
		visits += 1;
		return Reflect.apply(original, this, [key]) as boolean;
	});
	assert.equal(heard('track:one'), true);
	assert.equal(heard('track:two'), false);
	assert.equal(heard('master'), true);
	const firstVisits = visits;
	assert.ok(firstVisits > 0);
	for (let iteration = 0; iteration < 100; iteration += 1) {
		assert.equal(heard('track:two'), false);
		assert.equal(heard('master'), true);
	}
	assert.equal(visits, firstVisits);
	assert.equal(createProjectSoloGainResolverV21(graph, tracks, false)('track:two'), true);
	assert.equal(createProjectSoloGainResolverV21(graph, [{ id: 'one', solo: false }], true)('track:two'), true);
});

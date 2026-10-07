/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { indexRoutingNodes, indexRoutingEdges, indexRoutingPorts, indexRoutingConnections, indexRoutingEndpointLabels, routingNavigationTarget } from '../src/common/editor/ui/workspace/routing-graph-presentation.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import type { RoutingLayoutNode } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-layout.ts';

const node = (id: string, x: number, y: number): RoutingLayoutNode => ({ key: `track:${id}`, id, kind: 'track', label: id, detail: 'Audio', channelCount: 2, rank: 0, rail: 'audio', x, y, width: 184, height: 78 });
test('routing indexes preserve first edge authority, port ordering and all incoming/outgoing counts', () => {
	const nodes = [node('a', 0, 0), node('b', 100, 0)];
	const edge = { id: 'edge', kind: 'assignment' as const, source: { kind: 'track' as const, id: 'a' }, destination: { kind: 'master' as const }, position: 'post-fader' as const, level: 1, enabled: false, channelMap: [0, 1] };
	let edgeReads = 0;
	const graph: MixerGraphV21 = { schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [], outputs: [], edges: [edge, { ...edge, get source() { edgeReads++; return edge.source; } }] };
	const nodesByKey = indexRoutingNodes(nodes); assert.equal(nodesByKey.get('track:a'), nodes[0]);
	assert.equal(indexRoutingEndpointLabels([{ value: 'a', label: 'First' }, { value: 'a', label: 'Later' }]).get('a'), 'First');
	assert.equal(indexRoutingEdges(graph.edges).get('edge'), edge);
	const counts = indexRoutingConnections(graph);
	assert.deepEqual(counts.get('track:a'), { inputs: 0, outputs: 2 });
	assert.deepEqual(counts.get('master'), { inputs: 2, outputs: 0 });
	for (let lookup = 0; lookup < 500; lookup++) counts.get('track:a');
	assert.equal(edgeReads, 1, 'node lookups do not rescan graph edges');
	const ports = [
		{ value: 'master', label: 'Master', width: 2, endpoint: { kind: 'master' as const } },
		{ value: 'first', label: 'First', width: 2, endpoint: { kind: 'effect-sidechain' as const, strip: { kind: 'track' as const, id: 'a' }, effectId: 'one' } },
		{ value: 'second', label: 'Second', width: 2, endpoint: { kind: 'effect-sidechain' as const, strip: { kind: 'track' as const, id: 'a' }, effectId: 'two' } },
	];
	assert.deepEqual(indexRoutingPorts(ports).get('track:a')?.sidechains.map(port => port.value), ['first', 'second']);
	assert.equal(indexRoutingPorts(ports).get('master')?.normal, ports[0]);
});
test('spatial navigation retains stable ties, reading order endpoints and missing-key behavior without sorting', () => {
	const nodes = [node('current', 100, 100), node('left', 0, 100), node('left-tie', 0, 100), node('right', 200, 100), node('above', 100, 0), node('below', 100, 200)];
	assert.equal(routingNavigationTarget(nodes, 'track:current', 'left')?.id, 'left');
	assert.equal(routingNavigationTarget(nodes, 'track:current', 'right')?.id, 'right');
	assert.equal(routingNavigationTarget(nodes, 'track:current', 'up')?.id, 'above');
	assert.equal(routingNavigationTarget(nodes, 'track:current', 'down')?.id, 'below');
	assert.equal(routingNavigationTarget(nodes, 'track:current', 'home')?.id, 'above');
	assert.equal(routingNavigationTarget(nodes, 'track:current', 'end')?.id, 'below');
	assert.equal(routingNavigationTarget(nodes, 'missing', 'home'), undefined);
	assert.equal(routingNavigationTarget([node('a', 0, 0), node('b', 0, 0)], 'track:a', 'end')?.id, 'b');
});

test('linear spatial navigation exactly matches the original stable sorts over 3000 dense layouts/directions', () => {
	const directions = ['left', 'right', 'up', 'down', 'home', 'end'] as const;
	function reference(nodes: readonly RoutingLayoutNode[], fromKey: string, direction: typeof directions[number]) {
		const ordered = [...nodes].sort((left, right) => left.y - right.y || left.x - right.x);
		const current = nodes.find(({ key }) => key === fromKey);
		if (!current || ordered.length === 0) return undefined;
		if (direction === 'home') return ordered[0];
		if (direction === 'end') return ordered.at(-1);
		const distance = (target: RoutingLayoutNode) => {
			const horizontal = Math.abs(target.x - current.x), vertical = Math.abs(target.y - current.y);
			return direction === 'left' || direction === 'right' ? horizontal + vertical * 2 : vertical + horizontal * 2;
		};
		return nodes.filter(candidate => candidate.key !== current.key && (direction === 'left' ? candidate.x < current.x : direction === 'right' ? candidate.x > current.x : direction === 'up' ? candidate.y < current.y : candidate.y > current.y))
			.sort((left, right) => distance(left) - distance(right))[0];
	}
	for (let fixture = 0; fixture < 500; fixture++) {
		const nodes = Array.from({ length: 1 + fixture % 70 }, (_, index) => node(String(index), ((index * 31 + fixture * 13) % 17 - 8) * 40, ((index * 17 + fixture * 31) % 13 - 6) * 40));
		const from = fixture % 7 === 0 ? 'missing' : nodes[fixture % nodes.length]!.key;
		for (const direction of directions) assert.equal(routingNavigationTarget(nodes, from, direction), reference(nodes, from, direction));
	}
});

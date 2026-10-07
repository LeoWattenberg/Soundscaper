/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MixerEdgeV21, MixerGraphV21 } from '../../mixer-graph-v21.ts';
import type { RoutingEndpointOption } from './soundscaper-routing-graph-candidates.ts';
import { routingLayoutNodeKeyForEndpoint, type RoutingLayoutNode } from './soundscaper-routing-graph-layout.ts';

export function indexRoutingNodes(nodes: readonly RoutingLayoutNode[]): ReadonlyMap<string, RoutingLayoutNode> {
	return new Map(nodes.map(node => [node.key, node]));
}
export function indexRoutingEdges(edges: readonly MixerEdgeV21[]): ReadonlyMap<string, MixerEdgeV21> {
	const indexed = new Map<string, MixerEdgeV21>();
	for (const edge of edges) if (!indexed.has(edge.id)) indexed.set(edge.id, edge);
	return indexed;
}
type Destination = RoutingEndpointOption<MixerEdgeV21['destination']>;
export function indexRoutingPorts(destinations: readonly Destination[]) {
	const indexed = new Map<string, { normal?: Destination; sidechains: Destination[] }>();
	for (const destination of destinations) {
		const key = routingLayoutNodeKeyForEndpoint(destination.endpoint);
		let ports = indexed.get(key);
		if (!ports) { ports = { sidechains: [] }; indexed.set(key, ports); }
		if (destination.endpoint.kind === 'effect-sidechain') ports.sidechains.push(destination);
		else ports.normal ??= destination;
	}
	return indexed;
}
export function indexRoutingConnections(graph: MixerGraphV21) {
	const indexed = new Map<string, { inputs: number; outputs: number }>();
	const counts = (key: string) => {
		let count = indexed.get(key);
		if (!count) { count = { inputs: 0, outputs: 0 }; indexed.set(key, count); }
		return count;
	};
	for (const edge of graph.edges) {
		counts(routingLayoutNodeKeyForEndpoint(edge.source)).outputs++;
		counts(routingLayoutNodeKeyForEndpoint(edge.destination)).inputs++;
	}
	for (const vca of graph.vcas) if (!indexed.has(`vca:${vca.id}`)) indexed.set(`vca:${vca.id}`, { inputs: 0, outputs: vca.members.length });
	return indexed;
}
export function indexRoutingEndpointLabels(options: readonly Readonly<{ value: string; label: string }>[]) {
	const indexed = new Map<string, string>();
	for (const option of options) if (!indexed.has(option.value)) indexed.set(option.value, option.label);
	return indexed;
}
export type RoutingDirection = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';
/** Stable minima match the original stable sort, without allocating/sorting candidates. */
export function routingNavigationTarget(nodes: readonly RoutingLayoutNode[], fromKey: string, direction: RoutingDirection): RoutingLayoutNode | undefined {
	const current = nodes.find(node => node.key === fromKey);
	if (!current) return undefined;
	let selected: RoutingLayoutNode | undefined;
	let distance = Infinity;
	for (const node of nodes) {
		if (direction === 'home' || direction === 'end') {
			const order = selected ? node.y - selected.y || node.x - selected.x : 0;
			if (!selected || (direction === 'home' ? order < 0 : order >= 0)) selected = node;
			continue;
		}
		if (node.key === current.key || !(direction === 'left' ? node.x < current.x : direction === 'right' ? node.x > current.x : direction === 'up' ? node.y < current.y : node.y > current.y)) continue;
		const horizontal = Math.abs(node.x - current.x), vertical = Math.abs(node.y - current.y);
		const nextDistance = direction === 'left' || direction === 'right' ? horizontal + vertical * 2 : vertical + horizontal * 2;
		if (!selected || nextDistance < distance) { selected = node; distance = nextDistance; }
	}
	return selected;
}

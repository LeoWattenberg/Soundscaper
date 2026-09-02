/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerEdgeV21, MixerGraphV21, MixerNodeKindV21 } from '../../mixer-graph-v21.ts';
import type { StripRef } from '../../parameter-address.ts';
import { resolveTerminalChannelWidths } from '../../terminal-channel-widths.ts';

type DataRecord = Readonly<Record<string, unknown>>;
export type RoutingLayoutNodeKind = 'track' | MixerNodeKindV21 | 'master' | 'output' | 'vca';

export interface RoutingLayoutNode {
	readonly key: string;
	readonly id: string;
	readonly kind: RoutingLayoutNodeKind;
	readonly label: string;
	readonly detail: string;
	readonly channelCount: number | null;
	readonly rank: number;
	readonly rail: 'audio' | 'control';
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface RoutingLayoutEdge {
	readonly key: string;
	readonly id: string;
	readonly kind: MixerEdgeV21['kind'] | 'vca-membership';
	readonly sourceKey: string;
	readonly destinationKey: string;
	readonly enabled: boolean;
	readonly parallelOffset: number;
	readonly path: string;
}

export interface SoundscaperRoutingGraphLayout {
	readonly nodes: readonly RoutingLayoutNode[];
	readonly edges: readonly RoutingLayoutEdge[];
	readonly width: number;
	readonly height: number;
}

interface PendingNode {
	readonly key: string;
	readonly id: string;
	readonly kind: RoutingLayoutNodeKind;
	readonly label: string;
	readonly detail: string;
	readonly channelCount: number | null;
	readonly semanticOrder: number;
	readonly rail: 'audio' | 'control';
	readonly initialRank: number;
}

const CARD_WIDTH = 184;
const CARD_HEIGHT = 78;
const COLUMN_GAP = 76;
const ROW_GAP = 30;
const GRAPH_PADDING = 32;
const CONTROL_Y = 28;

export function layoutSoundscaperRoutingGraph(
	projectValue: unknown,
	graph: MixerGraphV21,
): SoundscaperRoutingGraphLayout {
	const project = record(projectValue);
	const masterChannels = positiveInteger(project?.masterChannels, 2);
	const terminalWidths = resolveTerminalChannelWidths(projectValue as never, masterChannels);
	const pending: PendingNode[] = [];
	let semanticOrder = 0;
	for (const track of records(project?.tracks)) {
		if (track.type !== 'audio' || typeof track.id !== 'string' || track.id.length === 0) continue;
		pending.push({
			key: `track:${track.id}`, id: track.id, kind: 'track',
			label: label(track.name, track.id), detail: 'Track',
			channelCount: terminalWidths.tracks.get(track.id) ?? masterChannels,
			semanticOrder: semanticOrder++, rail: 'audio', initialRank: 0,
		});
	}
	for (const [collection, kind, detail] of NODE_COLLECTIONS) {
		for (const node of graph[collection]) pending.push({
			key: `mixer-node:${node.id}`, id: node.id, kind,
			label: node.name || node.id, detail, channelCount: node.channelCount,
			semanticOrder: semanticOrder++, rail: 'audio', initialRank: 1,
		});
	}
	pending.push({
		key: 'master', id: 'master', kind: 'master', label: 'Master', detail: 'Master',
		channelCount: masterChannels, semanticOrder: semanticOrder++, rail: 'audio', initialRank: 1,
	});
	for (const output of graph.outputs) pending.push({
		key: `output:${output.id}`, id: output.id, kind: 'output',
		label: output.name || output.id, detail: outputDetail(output.role),
		channelCount: output.channelCount, semanticOrder: semanticOrder++, rail: 'audio', initialRank: 2,
	});
	for (const vca of graph.vcas) pending.push({
		key: `vca:${vca.id}`, id: vca.id, kind: 'vca', label: vca.name || vca.id,
		detail: `${vca.members.length} member${vca.members.length === 1 ? '' : 's'}`,
		channelCount: null, semanticOrder: semanticOrder++, rail: 'control', initialRank: 0,
	});

	const audioKeys = new Set(pending.filter(({ rail }) => rail === 'audio').map(({ key }) => key));
	const rank = new Map(pending.map((node) => [node.key, node.initialRank]));
	const predecessors = new Map<string, string[]>();
	for (const edge of graph.edges) {
		if (!edge.enabled || edge.kind === 'sidechain') continue;
		const source = endpointKey(edge.source);
		const destination = edge.destination.kind === 'effect-sidechain'
			? stripKey(edge.destination.strip) : endpointKey(edge.destination);
		if (!audioKeys.has(source) || !audioKeys.has(destination)) continue;
		const entries = predecessors.get(destination) ?? [];
		entries.push(source);
		predecessors.set(destination, entries);
	}
	// Validation guarantees the enabled routing graph is acyclic. Bounded relaxation
	// therefore produces stable left-to-right ranks without persisting presentation state.
	for (let pass = 0; pass < pending.length; pass += 1) {
		let changed = false;
		for (const [destination, sources] of predecessors) for (const source of sources) {
			const candidate = (rank.get(source) ?? 0) + 1;
			if (candidate > (rank.get(destination) ?? 0)) {
				rank.set(destination, candidate);
				changed = true;
			}
		}
		if (!changed) break;
	}

	const byRank = new Map<number, PendingNode[]>();
	for (const node of pending.filter(({ rail }) => rail === 'audio')) {
		const nodeRank = rank.get(node.key) ?? node.initialRank;
		const entries = byRank.get(nodeRank) ?? [];
		entries.push(node);
		byRank.set(nodeRank, entries);
	}
	const orderIndex = new Map(pending.map((node) => [node.key, node.semanticOrder]));
	for (const [nodeRank, entries] of [...byRank].sort(([left], [right]) => left - right)) {
		if (nodeRank === 0) continue;
		entries.sort((left, right) => {
			const leftMedian = median((predecessors.get(left.key) ?? []).map((key) => orderIndex.get(key) ?? 0));
			const rightMedian = median((predecessors.get(right.key) ?? []).map((key) => orderIndex.get(key) ?? 0));
			return leftMedian - rightMedian || left.semanticOrder - right.semanticOrder;
		});
		entries.forEach((node, index) => orderIndex.set(node.key, index));
	}

	const hasControlRail = graph.vcas.length > 0;
	const audioY = hasControlRail ? CONTROL_Y + CARD_HEIGHT + 66 : GRAPH_PADDING;
	const positioned: RoutingLayoutNode[] = [];
	for (const [nodeRank, entries] of [...byRank].sort(([left], [right]) => left - right)) {
		entries.forEach((node, row) => positioned.push(positionedNode(
			node, nodeRank,
			GRAPH_PADDING + nodeRank * (CARD_WIDTH + COLUMN_GAP),
			audioY + row * (CARD_HEIGHT + ROW_GAP),
		)));
	}
	graph.vcas.forEach((vca, index) => {
		const node = pending.find(({ key }) => key === `vca:${vca.id}`)!;
		positioned.push(positionedNode(
			node, 0, GRAPH_PADDING + index * (CARD_WIDTH + 18), CONTROL_Y,
		));
	});
	positioned.sort((left, right) => left.rail.localeCompare(right.rail) || left.x - right.x || left.y - right.y);

	const nodeByKey = new Map(positioned.map((node) => [node.key, node]));
	const edges: RoutingLayoutEdge[] = [];
	const visibleEdges = graph.edges.flatMap((edge) => {
		const sourceKey = endpointKey(edge.source);
		const destinationKey = edge.destination.kind === 'effect-sidechain'
			? stripKey(edge.destination.strip) : endpointKey(edge.destination);
		const source = nodeByKey.get(sourceKey);
		const destination = nodeByKey.get(destinationKey);
		return source && destination ? [{ edge, sourceKey, destinationKey, source, destination }] : [];
	});
	const parallelCounts = new Map<string, number>();
	for (const { sourceKey, destinationKey } of visibleEdges) {
		const key = `${sourceKey}\u0000${destinationKey}`;
		parallelCounts.set(key, (parallelCounts.get(key) ?? 0) + 1);
	}
	const parallelSeen = new Map<string, number>();
	for (const { edge, sourceKey, destinationKey, source, destination } of visibleEdges) {
		const parallelKey = `${sourceKey}\u0000${destinationKey}`;
		const index = parallelSeen.get(parallelKey) ?? 0;
		const count = parallelCounts.get(parallelKey) ?? 1;
		parallelSeen.set(parallelKey, index + 1);
		const parallelOffset = (index - (count - 1) / 2) * 24;
		edges.push({
			key: `edge:${edge.id}`, id: edge.id, kind: edge.kind, sourceKey, destinationKey,
			enabled: edge.enabled, parallelOffset, path: curvePath(source, destination, parallelOffset),
		});
	}
	for (const vca of graph.vcas) for (const [index, member] of vca.members.entries()) {
		const sourceKey = `vca:${vca.id}`;
		const destinationKey = stripKey(member);
		const source = nodeByKey.get(sourceKey);
		const destination = nodeByKey.get(destinationKey);
		if (!source || !destination) continue;
		edges.push({
			key: `vca:${vca.id}:${destinationKey}:${index}`, id: vca.id,
			kind: 'vca-membership', sourceKey, destinationKey, enabled: true,
			parallelOffset: 0,
			path: controlPath(source, destination),
		});
	}
	const width = Math.max(640, ...positioned.map((node) => node.x + node.width + GRAPH_PADDING));
	const height = Math.max(300, ...positioned.map((node) => node.y + node.height + GRAPH_PADDING));
	return Object.freeze({
		nodes: Object.freeze(positioned.map((node) => Object.freeze(node))),
		edges: Object.freeze(edges.map((edge) => Object.freeze(edge))),
		width,
		height,
	});
}

export function routingLayoutNodeKeyForEndpoint(endpoint: MixerEdgeV21['source'] | MixerEdgeV21['destination']): string {
	return endpoint.kind === 'effect-sidechain' ? stripKey(endpoint.strip) : endpointKey(endpoint);
}

function positionedNode(node: PendingNode, rank: number, x: number, y: number): RoutingLayoutNode {
	return {
		key: node.key, id: node.id, kind: node.kind, label: node.label,
		detail: node.detail, channelCount: node.channelCount, rank, rail: node.rail,
		x, y, width: CARD_WIDTH, height: CARD_HEIGHT,
	};
}

function endpointKey(endpoint: MixerEdgeV21['source'] | Exclude<MixerEdgeV21['destination'], { kind: 'effect-sidechain' }>): string {
	return endpoint.kind === 'master' ? 'master' : `${endpoint.kind}:${endpoint.id}`;
}

function stripKey(strip: StripRef): string {
	return strip.kind === 'master' ? 'master' : `${strip.kind}:${strip.id}`;
}

function curvePath(source: RoutingLayoutNode, destination: RoutingLayoutNode, parallelOffset: number): string {
	const startX = source.x + source.width;
	const startY = source.y + source.height / 2;
	const endX = destination.x;
	const endY = destination.y + destination.height / 2;
	const curve = Math.max(42, Math.abs(endX - startX) * 0.45);
	return `M ${startX} ${startY} C ${startX + curve} ${startY + parallelOffset}, ${endX - curve} ${endY + parallelOffset}, ${endX} ${endY}`;
}

function controlPath(source: RoutingLayoutNode, destination: RoutingLayoutNode): string {
	const startX = source.x + source.width / 2;
	const startY = source.y + source.height;
	const endX = destination.x + destination.width / 2;
	const endY = destination.y;
	const midpointY = startY + Math.max(24, (endY - startY) / 2);
	return `M ${startX} ${startY} C ${startX} ${midpointY}, ${endX} ${midpointY}, ${endX} ${endY}`;
}

function median(values: readonly number[]): number {
	if (values.length === 0) return Number.MAX_SAFE_INTEGER;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0;
}

function outputDetail(role: string): string {
	return `${role === 'control-room' ? 'Control room' : role.charAt(0).toUpperCase() + role.slice(1)} output`;
}

function label(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function records(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value.map(record).filter((entry): entry is DataRecord => entry !== null) : [];
}

function positiveInteger(value: unknown, fallback: number): number {
	return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 32 ? Number(value) : fallback;
}

const NODE_COLLECTIONS = [
	['groups', 'group', 'Group'],
	['sends', 'send', 'Send'],
	['cues', 'cue', 'Cue'],
] as const;

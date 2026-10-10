/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RoutingLayoutNode } from './soundscaper-routing-graph-layout.ts';

type Point = Readonly<{ x: number; y: number }>;
const HANDLE_RADIUS = 12;
const NODE_CLEARANCE = 8;

/** Keep a connection's pointer target on its wire and outside every node card. */
export function routingEdgeHandleStyle(
	source: RoutingLayoutNode,
	destination: RoutingLayoutNode,
	nodes: readonly RoutingLayoutNode[],
	parallelOffset = 0,
): Readonly<{ left: string; top: string }> {
	const start = { x: source.x + source.width, y: source.y + source.height / 2 };
	const end = { x: destination.x, y: destination.y + destination.height / 2 };
	const curve = Math.max(42, Math.abs(end.x - start.x) * 0.45);
	const first = { x: start.x + curve, y: start.y + parallelOffset };
	const second = { x: end.x - curve, y: end.y + parallelOffset };
	let point = bezierPoint(start, first, second, end, 0.5);
	for (let offset = 0; offset < 32; offset += 1) {
		const distance = offset / 64;
		const candidates = offset === 0 ? [0.5] : [0.5 - distance, 0.5 + distance];
		const available = candidates.map(t => bezierPoint(start, first, second, end, t))
			.find(candidate => nodes.every(node => clearsNode(candidate, node)));
		if (available) { point = available; break; }
	}
	return { left: `${point.x - HANDLE_RADIUS}px`, top: `${point.y - HANDLE_RADIUS}px` };
}

function clearsNode(point: Point, node: RoutingLayoutNode): boolean {
	const radius = HANDLE_RADIUS + NODE_CLEARANCE;
	return point.x + radius <= node.x || point.x - radius >= node.x + node.width
		|| point.y + radius <= node.y || point.y - radius >= node.y + node.height;
}

function bezierPoint(start: Point, first: Point, second: Point, end: Point, t: number): Point {
	const u = 1 - t;
	return {
		x: u ** 3 * start.x + 3 * u ** 2 * t * first.x + 3 * u * t ** 2 * second.x + t ** 3 * end.x,
		y: u ** 3 * start.y + 3 * u ** 2 * t * first.y + 3 * u * t ** 2 * second.y + t ** 3 * end.y,
	};
}

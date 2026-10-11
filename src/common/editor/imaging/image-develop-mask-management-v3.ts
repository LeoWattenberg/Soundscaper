/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_MASK_MATTE_LIMITS_V1, type VideoMaskMatteNodeV1 } from '../video-mask-matte-v24.ts';
import { IMAGE_DEVELOP_LIMITS_V1 } from './image-develop-contract-v1.ts';
import { manageImageDevelopMasksV2, type ImageDevelopMaskManagementCommandV2 } from './image-develop-mask-management-v2.ts';
import { normalizeImageDevelopStateV1OrV2 } from './image-develop-state-v2.ts';
import { field, id, oneOf, record } from './image-develop-value.ts';

export type ImageDevelopMaskManagementCommandV3 = ImageDevelopMaskManagementCommandV2
	| Readonly<{ type: 'compose'; maskId: string; operandMaskId: string; operation: 'union' | 'subtract' | 'intersect' }>;
type Develop = ReturnType<typeof normalizeImageDevelopStateV1OrV2>;
type Graph = Develop['masks'][number];

/** Composition copies complete graph declarations, never evaluated coverage or
 * body authority. Existing graph bindings evaluate both definitions at their
 * destination effect input; selected-minus-operand retains Boolean ordering. */
export function manageImageDevelopMasksV3(developValue: unknown, commandValue: unknown): Develop {
	const develop = normalizeImageDevelopStateV1OrV2(developValue);
	const command = record(commandValue, 'mask management command3',
		['type', 'maskId', 'name', 'duplicateId', 'effectIds', 'operandMaskId', 'operation'], ['type', 'maskId']);
	if (field(command, 'type') !== 'compose') return manageImageDevelopMasksV2(develop, command);
	const compose = record(command, 'mask composition command', ['type', 'maskId', 'operandMaskId', 'operation']);
	const maskId = id(field(compose, 'maskId'), 'mask composition selected ID');
	const operandMaskId = id(field(compose, 'operandMaskId'), 'mask composition operand ID');
	const operation = oneOf(field(compose, 'operation'), ['union', 'subtract', 'intersect'] as const, 'mask composition operation');
	if (maskId === operandMaskId) throw new RangeError('A mask cannot compose with itself.');
	const selected = develop.masks.find(mask => mask.id === maskId), operand = develop.masks.find(mask => mask.id === operandMaskId);
	if (!selected || !operand) throw new ReferenceError('Mask composition references a missing graph.');
	admitBytes(develop);
	if (selected.nodes.length + operand.nodes.length + 1 > VIDEO_MASK_MATTE_LIMITS_V1.maximumNodes
		|| selected.inputs.length + operand.inputs.length > VIDEO_MASK_MATTE_LIMITS_V1.maximumInputs
		|| pointCount(selected) + pointCount(operand) > VIDEO_MASK_MATTE_LIMITS_V1.maximumPathPoints) {
		throw new RangeError('Mask composition exceeds the existing graph node, input or path point budget.');
	}
	const nodeIds = namespace(selected.nodes.map(node => node.id), operand.nodes.map(node => node.id), 'composed-node-');
	const inputNames = namespace(selected.inputs.map(input => input.name), operand.inputs.map(input => input.name), 'ComposedInput_');
	const pathIds = namespace(paths(selected), paths(operand), 'composed-path-');
	const nodes = operand.nodes.map(node => copyNode(node, nodeIds.mapping, inputNames.mapping, pathIds.mapping));
	const outputNodeId = nodeIds.allocate();
	const graph = { ...selected,
		inputs: [...selected.inputs, ...operand.inputs.map(input => ({ ...input, name: inputNames.mapping.get(input.name)! }))],
		nodes: [...selected.nodes, ...nodes, { id: outputNodeId, kind: 'boolean', operation, inputNodeIds: [selected.outputNodeId, nodeIds.mapping.get(operand.outputNodeId)!] }],
		outputNodeId };
	// The graph owner verifies all topology, including unused nodes and depth.
	// The recipe owner detaches and canonicalizes the complete successor.
	const result = normalizeImageDevelopStateV1OrV2({ ...develop, masks: develop.masks.map(mask => mask.id === maskId ? graph : mask) });
	admitBytes(result); return result;
}

function admitBytes(value: Develop): void {
	const serialized = JSON.stringify(value), limit = IMAGE_DEVELOP_LIMITS_V1.maximumBytes;
	if (serialized.length > limit || new TextEncoder().encode(serialized).byteLength > limit) {
		throw new RangeError('Mask composition exceeds the existing two-MiB recipe byte budget.');
	}
}
function paths(graph: Graph): string[] { return graph.nodes.flatMap(node => node.kind === 'vector-path' ? node.paths.map(path => path.id) : []); }
function pointCount(graph: Graph): number { return graph.nodes.reduce((total, node) => total
	+ (node.kind === 'vector-path' ? node.paths.reduce((points, path) => points + path.points.length, 0) : 0), 0); }

/** Reserve both complete original namespaces before allocating aliases. A
 * collision may not steal an unchanged donor symbol that sorts later. */
function namespace(selected: readonly string[], operand: readonly string[], prefix: string) {
	const kept = new Set(selected), reserved = new Set([...selected, ...operand]), mapping = new Map<string, string>();
	let sequence = 0;
	const allocate = () => {
		let candidate: string;
		do { sequence++; candidate = `${prefix}${String(sequence)}`; } while (reserved.has(candidate));
		reserved.add(candidate); return candidate;
	};
	for (const original of operand) mapping.set(original, kept.has(original) ? allocate() : original);
	return { mapping, allocate };
}
function copyNode(node: VideoMaskMatteNodeV1, nodes: ReadonlyMap<string, string>, inputs: ReadonlyMap<string, string>,
	pathIds: ReadonlyMap<string, string>): VideoMaskMatteNodeV1 {
	const nodeId = nodes.get(node.id)!;
	if (node.kind === 'raster' || node.kind === 'alpha') return { ...node, id: nodeId, inputName: inputs.get(node.inputName)! };
	if (node.kind === 'feather' || node.kind === 'invert') return { ...node, id: nodeId, inputNodeId: nodes.get(node.inputNodeId)! };
	if (node.kind === 'boolean') return { ...node, id: nodeId, inputNodeIds: node.inputNodeIds.map(reference => nodes.get(reference)!) };
	if (node.kind === 'vector-path') return { ...node, id: nodeId, paths: node.paths.map(path => ({ ...path, id: pathIds.get(path.id)! })) };
	return { ...node, id: nodeId };
}

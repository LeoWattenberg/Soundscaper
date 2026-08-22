/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';

export const VIDEO_MASK_MATTE_LIMITS_V1 = Object.freeze({
	maximumDepth: 32,
	maximumNodes: 4_096,
	maximumPathPoints: 16_384,
	maximumInputs: 256,
	maximumBooleanInputs: 64,
});

export interface VideoMaskMatteInputV1 {
	readonly name: string;
	readonly sourceRef: string;
	readonly kind: 'raster' | 'alpha';
}

export interface VideoMaskPointV1 {
	readonly position: VideoMaskCoordinateV1;
	readonly inHandle: VideoMaskCoordinateV1 | null;
	readonly outHandle: VideoMaskCoordinateV1 | null;
}

export interface VideoMaskCoordinateV1 { readonly x: number; readonly y: number }

export interface VideoMaskPathV1 {
	readonly id: string;
	readonly closed: boolean;
	readonly points: readonly VideoMaskPointV1[];
}

export interface VideoVectorShapeMaskNodeV1 {
	readonly id: string;
	readonly kind: 'vector-shape';
	readonly shape: 'rectangle' | 'ellipse';
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface VideoVectorPathMaskNodeV1 {
	readonly id: string;
	readonly kind: 'vector-path';
	readonly fillRule: 'even-odd' | 'nonzero';
	readonly paths: readonly VideoMaskPathV1[];
}

export interface VideoRasterMaskNodeV1 {
	readonly id: string;
	readonly kind: 'raster';
	readonly inputName: string;
	readonly channel: 'luma' | 'red' | 'green' | 'blue' | 'alpha';
}

export interface VideoAlphaMaskNodeV1 {
	readonly id: string;
	readonly kind: 'alpha';
	readonly inputName: string;
}

export interface VideoFeatherMaskNodeV1 {
	readonly id: string;
	readonly kind: 'feather';
	readonly inputNodeId: string;
	readonly radius: number;
}

export interface VideoInvertMaskNodeV1 {
	readonly id: string;
	readonly kind: 'invert';
	readonly inputNodeId: string;
}

export interface VideoBooleanMaskNodeV1 {
	readonly id: string;
	readonly kind: 'boolean';
	readonly operation: 'union' | 'intersect' | 'subtract' | 'xor';
	readonly inputNodeIds: readonly string[];
}

export type VideoMaskMatteNodeV1 =
	| VideoVectorShapeMaskNodeV1
	| VideoVectorPathMaskNodeV1
	| VideoRasterMaskNodeV1
	| VideoAlphaMaskNodeV1
	| VideoFeatherMaskNodeV1
	| VideoInvertMaskNodeV1
	| VideoBooleanMaskNodeV1;

export interface VideoMaskMatteGraphV1 {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly kind: 'mask' | 'matte';
	readonly inputs: readonly VideoMaskMatteInputV1[];
	readonly nodes: readonly VideoMaskMatteNodeV1[];
	readonly outputNodeId: string;
}

const GRAPH_FIELDS = Object.freeze(['schemaVersion', 'id', 'kind', 'inputs', 'nodes', 'outputNodeId']);
const INPUT_FIELDS = Object.freeze(['name', 'sourceRef', 'kind']);
const SHAPE_FIELDS = Object.freeze(['id', 'kind', 'shape', 'x', 'y', 'width', 'height']);
const PATH_NODE_FIELDS = Object.freeze(['id', 'kind', 'fillRule', 'paths']);
const PATH_FIELDS = Object.freeze(['id', 'closed', 'points']);
const POINT_FIELDS = Object.freeze(['position', 'inHandle', 'outHandle']);
const COORDINATE_FIELDS = Object.freeze(['x', 'y']);
const RASTER_FIELDS = Object.freeze(['id', 'kind', 'inputName', 'channel']);
const ALPHA_FIELDS = Object.freeze(['id', 'kind', 'inputName']);
const FEATHER_FIELDS = Object.freeze(['id', 'kind', 'inputNodeId', 'radius']);
const INVERT_FIELDS = Object.freeze(['id', 'kind', 'inputNodeId']);
const BOOLEAN_FIELDS = Object.freeze(['id', 'kind', 'operation', 'inputNodeIds']);
const ALL_NODE_FIELDS = Object.freeze([...new Set([
	...SHAPE_FIELDS, ...PATH_NODE_FIELDS, ...RASTER_FIELDS, ...ALPHA_FIELDS,
	...FEATHER_FIELDS, ...INVERT_FIELDS, ...BOOLEAN_FIELDS,
])]);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const INPUT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const MAXIMUM_COORDINATE = 1_000_000;

/** Detach, canonicalize, and fully validate one V24 mask/matte graph. */
export function normalizeVideoMaskMatteGraphV1(value: unknown): VideoMaskMatteGraphV1 {
	const record = readClosedDomainRecord(value, 'video mask/matte graph', GRAPH_FIELDS);
	if (field(record, 'schemaVersion', 'video mask/matte graph') !== 1) {
		throw new RangeError('video mask/matte graph.schemaVersion must be 1.');
	}
	const kind = oneOf(field(record, 'kind', 'video mask/matte graph'), ['mask', 'matte'] as const, 'video mask/matte graph.kind');
	const inputs = normalizeInputs(field(record, 'inputs', 'video mask/matte graph'));
	const inputByName = new Map(inputs.map((input) => [input.name, input]));
	const nodes = normalizeNodes(field(record, 'nodes', 'video mask/matte graph'));
	const nodeById = new Map<string, VideoMaskMatteNodeV1>();
	for (const node of nodes) {
		if (nodeById.has(node.id)) throw new RangeError(`The video mask/matte graph contains duplicate node ID ${node.id}.`);
		nodeById.set(node.id, node);
	}
	validateInputBindings(nodes, inputByName);
	validateTopology(nodes, nodeById);
	const outputNodeId = stableId(field(record, 'outputNodeId', 'video mask/matte graph'), 'video mask/matte graph.outputNodeId');
	if (!nodeById.has(outputNodeId)) throw new ReferenceError(`The video mask/matte output references missing node ${outputNodeId}.`);
	return Object.freeze({
		schemaVersion: 1 as const,
		id: stableId(field(record, 'id', 'video mask/matte graph'), 'video mask/matte graph.id'),
		kind,
		inputs,
		nodes,
		outputNodeId,
	});
}

export function validateVideoMaskMatteGraphV1(value: unknown): VideoMaskMatteGraphV1 {
	return normalizeVideoMaskMatteGraphV1(value);
}

function normalizeInputs(value: unknown): readonly VideoMaskMatteInputV1[] {
	const values = readClosedDomainArray(value, 'video mask/matte graph inputs', 0, VIDEO_MASK_MATTE_LIMITS_V1.maximumInputs);
	const seen = new Set<string>();
	const inputs = values.map((candidate, index) => {
		const name = `video mask/matte graph inputs[${String(index)}]`;
		const record = readClosedDomainRecord(candidate, name, INPUT_FIELDS);
		const inputNameValue = namedInput(field(record, 'name', name), `${name}.name`);
		if (seen.has(inputNameValue)) throw new RangeError(`The graph contains duplicate input ${inputNameValue}.`);
		seen.add(inputNameValue);
		return Object.freeze({
			name: inputNameValue,
			sourceRef: stableId(field(record, 'sourceRef', name), `${name}.sourceRef`),
			kind: oneOf(field(record, 'kind', name), ['raster', 'alpha'] as const, `${name}.kind`),
		});
	});
	inputs.sort((left, right) => compareText(left.name, right.name));
	return Object.freeze(inputs);
}

function normalizeNodes(value: unknown): readonly VideoMaskMatteNodeV1[] {
	const candidates = readClosedDomainArray(value, 'video mask/matte graph nodes', 1, VIDEO_MASK_MATTE_LIMITS_V1.maximumNodes);
	let pointCount = 0;
	const pathIds = new Set<string>();
	const nodes = candidates.map((candidate, index) => {
		const name = `video mask/matte graph nodes[${String(index)}]`;
		const record = readClosedDomainRecord(candidate, name, ALL_NODE_FIELDS, ['id', 'kind']);
		const id = stableId(field(record, 'id', name), `${name}.id`);
		const kind = field(record, 'kind', name);
		if (kind === 'vector-shape') return vectorShape(candidate, name, id);
		if (kind === 'vector-path') {
			const result = vectorPath(candidate, name, id, pathIds);
			pointCount += result.pointCount;
			if (pointCount > VIDEO_MASK_MATTE_LIMITS_V1.maximumPathPoints) throw new RangeError('A video mask/matte graph may contain at most 16384 path points.');
			return result.node;
		}
		if (kind === 'raster') return rasterNode(candidate, name, id);
		if (kind === 'alpha') return alphaNode(candidate, name, id);
		if (kind === 'feather') return featherNode(candidate, name, id);
		if (kind === 'invert') return invertNode(candidate, name, id);
		if (kind === 'boolean') return booleanNode(candidate, name, id);
		throw new RangeError(`${name}.kind is unsupported.`);
	});
	nodes.sort((left, right) => compareText(left.id, right.id));
	return Object.freeze(nodes);
}

function vectorShape(value: unknown, name: string, id: string): VideoVectorShapeMaskNodeV1 {
	const record = readClosedDomainRecord(value, name, SHAPE_FIELDS);
	return Object.freeze({
		id,
		kind: 'vector-shape' as const,
		shape: oneOf(field(record, 'shape', name), ['rectangle', 'ellipse'] as const, `${name}.shape`),
		x: coordinate(field(record, 'x', name), `${name}.x`),
		y: coordinate(field(record, 'y', name), `${name}.y`),
		width: positiveCoordinate(field(record, 'width', name), `${name}.width`),
		height: positiveCoordinate(field(record, 'height', name), `${name}.height`),
	});
}

function vectorPath(
	value: unknown,
	name: string,
	id: string,
	pathIds: Set<string>,
): Readonly<{ node: VideoVectorPathMaskNodeV1; pointCount: number }> {
	const record = readClosedDomainRecord(value, name, PATH_NODE_FIELDS);
	const candidates = readClosedDomainArray(field(record, 'paths', name), `${name}.paths`, 1, 4_096);
	let pointCount = 0;
	const paths = candidates.map((candidate, index) => {
		const pathName = `${name}.paths[${String(index)}]`;
		const path = readClosedDomainRecord(candidate, pathName, PATH_FIELDS);
		const pathId = stableId(field(path, 'id', pathName), `${pathName}.id`);
		if (pathIds.has(pathId)) throw new RangeError(`The graph contains duplicate path ID ${pathId}.`);
		pathIds.add(pathId);
		const closed = boolean(field(path, 'closed', pathName), `${pathName}.closed`);
		const pointValues = readClosedDomainArray(field(path, 'points', pathName), `${pathName}.points`, closed ? 3 : 2, VIDEO_MASK_MATTE_LIMITS_V1.maximumPathPoints);
		pointCount += pointValues.length;
		return Object.freeze({
			id: pathId,
			closed,
			points: Object.freeze(pointValues.map((point, pointIndex) => normalizePoint(point, `${pathName}.points[${String(pointIndex)}]`))),
		});
	});
	return Object.freeze({
		node: Object.freeze({
			id,
			kind: 'vector-path' as const,
			fillRule: oneOf(field(record, 'fillRule', name), ['even-odd', 'nonzero'] as const, `${name}.fillRule`),
			paths: Object.freeze(paths),
		}),
		pointCount,
	});
}

function normalizePoint(value: unknown, name: string): VideoMaskPointV1 {
	const record = readClosedDomainRecord(value, name, POINT_FIELDS);
	return Object.freeze({
		position: normalizeCoordinate(field(record, 'position', name), `${name}.position`),
		inHandle: optionalCoordinate(field(record, 'inHandle', name), `${name}.inHandle`),
		outHandle: optionalCoordinate(field(record, 'outHandle', name), `${name}.outHandle`),
	});
}

function normalizeCoordinate(value: unknown, name: string): VideoMaskCoordinateV1 {
	const record = readClosedDomainRecord(value, name, COORDINATE_FIELDS);
	return Object.freeze({ x: coordinate(field(record, 'x', name), `${name}.x`), y: coordinate(field(record, 'y', name), `${name}.y`) });
}

function optionalCoordinate(value: unknown, name: string): VideoMaskCoordinateV1 | null {
	return value === null ? null : normalizeCoordinate(value, name);
}

function rasterNode(value: unknown, name: string, id: string): VideoRasterMaskNodeV1 {
	const record = readClosedDomainRecord(value, name, RASTER_FIELDS);
	return Object.freeze({
		id,
		kind: 'raster' as const,
		inputName: namedInput(field(record, 'inputName', name), `${name}.inputName`),
		channel: oneOf(field(record, 'channel', name), ['luma', 'red', 'green', 'blue', 'alpha'] as const, `${name}.channel`),
	});
}

function alphaNode(value: unknown, name: string, id: string): VideoAlphaMaskNodeV1 {
	const record = readClosedDomainRecord(value, name, ALPHA_FIELDS);
	return Object.freeze({ id, kind: 'alpha' as const, inputName: namedInput(field(record, 'inputName', name), `${name}.inputName`) });
}

function featherNode(value: unknown, name: string, id: string): VideoFeatherMaskNodeV1 {
	const record = readClosedDomainRecord(value, name, FEATHER_FIELDS);
	return Object.freeze({
		id,
		kind: 'feather' as const,
		inputNodeId: stableId(field(record, 'inputNodeId', name), `${name}.inputNodeId`),
		radius: boundedFinite(field(record, 'radius', name), 0, MAXIMUM_COORDINATE, `${name}.radius`),
	});
}

function invertNode(value: unknown, name: string, id: string): VideoInvertMaskNodeV1 {
	const record = readClosedDomainRecord(value, name, INVERT_FIELDS);
	return Object.freeze({ id, kind: 'invert' as const, inputNodeId: stableId(field(record, 'inputNodeId', name), `${name}.inputNodeId`) });
}

function booleanNode(value: unknown, name: string, id: string): VideoBooleanMaskNodeV1 {
	const record = readClosedDomainRecord(value, name, BOOLEAN_FIELDS);
	const values = readClosedDomainArray(field(record, 'inputNodeIds', name), `${name}.inputNodeIds`, 2, VIDEO_MASK_MATTE_LIMITS_V1.maximumBooleanInputs);
	const seen = new Set<string>();
	const inputNodeIds = values.map((candidate, index) => {
		const inputId = stableId(candidate, `${name}.inputNodeIds[${String(index)}]`);
		if (seen.has(inputId)) throw new RangeError(`${name} contains duplicate input node ID ${inputId}.`);
		seen.add(inputId);
		return inputId;
	});
	return Object.freeze({
		id,
		kind: 'boolean' as const,
		operation: oneOf(field(record, 'operation', name), ['union', 'intersect', 'subtract', 'xor'] as const, `${name}.operation`),
		inputNodeIds: Object.freeze(inputNodeIds),
	});
}

function validateInputBindings(nodes: readonly VideoMaskMatteNodeV1[], inputs: ReadonlyMap<string, VideoMaskMatteInputV1>): void {
	for (const node of nodes) {
		if (node.kind !== 'raster' && node.kind !== 'alpha') continue;
		const input = inputs.get(node.inputName);
		if (!input) throw new ReferenceError(`The ${node.kind} node ${node.id} references missing named input ${node.inputName}.`);
		if (input.kind !== node.kind) throw new RangeError(`The ${node.kind} node ${node.id} requires a ${node.kind} input.`);
	}
}

function validateTopology(nodes: readonly VideoMaskMatteNodeV1[], byId: ReadonlyMap<string, VideoMaskMatteNodeV1>): void {
	const unresolved = new Map<string, number>();
	const depth = new Map<string, number>();
	const dependents = new Map<string, string[]>();
	const queue: string[] = [];
	for (const node of nodes) {
		const references = nodeReferences(node);
		for (const reference of references) {
			if (!byId.has(reference)) throw new ReferenceError(`The video mask/matte node ${node.id} references missing node ${reference}.`);
			const downstream = dependents.get(reference) ?? [];
			downstream.push(node.id);
			dependents.set(reference, downstream);
		}
		unresolved.set(node.id, references.length);
		if (references.length === 0) {
			depth.set(node.id, 1);
			queue.push(node.id);
		}
	}
	let visited = 0;
	for (let cursor = 0; cursor < queue.length; cursor += 1) {
		const id = queue[cursor]!;
		visited += 1;
		const parentDepth = depth.get(id)!;
		for (const dependentId of dependents.get(id) ?? []) {
			const nextDepth = Math.max(depth.get(dependentId) ?? 1, parentDepth + 1);
			if (nextDepth > VIDEO_MASK_MATTE_LIMITS_V1.maximumDepth) throw new RangeError('A video mask/matte graph may not exceed depth 32.');
			depth.set(dependentId, nextDepth);
			const remaining = unresolved.get(dependentId)! - 1;
			unresolved.set(dependentId, remaining);
			if (remaining === 0) queue.push(dependentId);
		}
	}
	if (visited !== nodes.length) throw new RangeError('The video mask/matte graph contains a cycle.');
}

function nodeReferences(node: VideoMaskMatteNodeV1): readonly string[] {
	if (node.kind === 'feather' || node.kind === 'invert') return [node.inputNodeId];
	if (node.kind === 'boolean') return node.inputNodeIds;
	return [];
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !STABLE_ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function namedInput(value: unknown, name: string): string {
	if (typeof value !== 'string' || !INPUT_NAME.test(value)) throw new TypeError(`${name} must be a canonical named input.`);
	return value;
}

function boolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean.`);
	return value;
}

function coordinate(value: unknown, name: string): number {
	return boundedFinite(value, -MAXIMUM_COORDINATE, MAXIMUM_COORDINATE, name);
}

function positiveCoordinate(value: unknown, name: string): number {
	return boundedFinite(value, Number.MIN_VALUE, MAXIMUM_COORDINATE, name);
}

function boundedFinite(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0) || value < minimum || value > maximum) throw new RangeError(`${name} must be a finite bounded number.`);
	return value;
}

function oneOf<const Values extends readonly string[]>(value: unknown, values: Values, name: string): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new RangeError(`${name} is unsupported.`);
	return value as Values[number];
}

function field(record: ClosedDomainRecord, name: string, owner: string): unknown {
	return readClosedDomainField(record, name, owner);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

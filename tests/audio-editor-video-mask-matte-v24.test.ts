/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeVideoMaskMatteGraphV1,
	validateVideoMaskMatteGraphV1,
	VIDEO_MASK_MATTE_LIMITS_V1,
} from '../src/common/editor/video-mask-matte-v24.ts';

function point(x: number, y: number): Record<string, unknown> {
	return { position: { x, y }, inHandle: null, outHandle: null };
}

function graph(): Record<string, unknown> {
	return {
		schemaVersion: 1,
		id: 'mask-graph-1',
		kind: 'matte',
		inputs: [
			{ name: 'Video', sourceRef: 'source-video', kind: 'raster' },
			{ name: 'Alpha', sourceRef: 'source-alpha', kind: 'alpha' },
		],
		nodes: [
			{ id: 'shape', kind: 'vector-shape', shape: 'ellipse', x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
			{ id: 'path', kind: 'vector-path', fillRule: 'even-odd', paths: [{
				id: 'path-1', closed: true, points: [point(0, 0), point(1, 0), point(0.5, 1)],
			}] },
			{ id: 'raster', kind: 'raster', inputName: 'Video', channel: 'luma' },
			{ id: 'alpha', kind: 'alpha', inputName: 'Alpha' },
			{ id: 'feather', kind: 'feather', inputNodeId: 'shape', radius: 8 },
			{ id: 'invert', kind: 'invert', inputNodeId: 'alpha' },
			{ id: 'output', kind: 'boolean', operation: 'intersect', inputNodeIds: ['feather', 'raster', 'invert'] },
		],
		outputNodeId: 'output',
	};
}

test('V24 freezes the exact mask/matte graph bounds and all maintained node families', () => {
	assert.deepEqual(VIDEO_MASK_MATTE_LIMITS_V1, {
		maximumDepth: 32,
		maximumNodes: 4_096,
		maximumPathPoints: 16_384,
		maximumInputs: 256,
		maximumBooleanInputs: 64,
	});
	const normalized = normalizeVideoMaskMatteGraphV1(graph());
	assert.deepEqual(normalized.inputs.map(({ name }) => name), ['Alpha', 'Video']);
	assert.deepEqual(normalized.nodes.map(({ id }) => id), [
		'alpha', 'feather', 'invert', 'output', 'path', 'raster', 'shape',
	]);
	assert.equal(normalized.kind, 'matte');
	assert.equal(normalized.outputNodeId, 'output');
	assertDeepFrozen(normalized);
	assert.deepEqual(validateVideoMaskMatteGraphV1(normalized), normalized);
});

test('mask/matte graphs are detached, idempotent, closed, and retain vector handles', () => {
	const input = graph();
	const pathNode = (input.nodes as Record<string, unknown>[])[1]!;
	const path = (pathNode.paths as Record<string, unknown>[])[0]!;
	(path.points as Record<string, unknown>[])[1] = {
		position: { x: 1, y: 0 },
		inHandle: { x: 0.75, y: -0.25 },
		outHandle: { x: 1.25, y: 0.25 },
	};
	const normalized = normalizeVideoMaskMatteGraphV1(input);
	const normalizedPath = normalized.nodes.find(({ id }) => id === 'path');
	assert.equal(normalizedPath?.kind, 'vector-path');
	if (normalizedPath?.kind !== 'vector-path') throw new Error('Expected vector path.');
	assert.deepEqual(normalizedPath.paths[0]?.points[1], {
		position: { x: 1, y: 0 },
		inHandle: { x: 0.75, y: -0.25 },
		outHandle: { x: 1.25, y: 0.25 },
	});
	assert.notStrictEqual(normalized, input);
	assert.deepEqual(normalizeVideoMaskMatteGraphV1(normalized), normalized);
	assert.throws(() => normalizeVideoMaskMatteGraphV1({ ...input, executable: 'shader()' }),
		/unsupported|field/iu);
	assert.throws(() => normalizeVideoMaskMatteGraphV1({ ...input, kind: 'rotoscope' }),
		/mask|matte|kind/iu);

	let getterCalls = 0;
	const accessor = { ...input };
	Object.defineProperty(accessor, 'nodes', {
		enumerable: true,
		get() { getterCalls += 1; return input.nodes; },
	});
	assert.throws(() => normalizeVideoMaskMatteGraphV1(accessor), /data property|accessor/iu);
	assert.equal(getterCalls, 0);
});

test('graph validation rejects duplicate identities, bad named inputs, and dangling references', () => {
	const duplicateInput = graph();
	duplicateInput.inputs = [
		{ name: 'Input', sourceRef: 'source-a', kind: 'raster' },
		{ name: 'Input', sourceRef: 'source-b', kind: 'raster' },
	];
	assert.throws(() => normalizeVideoMaskMatteGraphV1(duplicateInput), /duplicate.*input/iu);

	const duplicateNode = graph();
	(duplicateNode.nodes as Record<string, unknown>[]).push({
		id: 'shape', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1,
	});
	assert.throws(() => normalizeVideoMaskMatteGraphV1(duplicateNode), /duplicate.*ID|identity/iu);

	const dangling = graph();
	const feather = (dangling.nodes as Record<string, unknown>[]).find(({ id }) => id === 'feather')!;
	feather.inputNodeId = 'missing';
	assert.throws(() => normalizeVideoMaskMatteGraphV1(dangling), /missing|reference/iu);

	const wrongInputKind = graph();
	const raster = (wrongInputKind.nodes as Record<string, unknown>[]).find(({ id }) => id === 'raster')!;
	raster.inputName = 'Alpha';
	assert.throws(() => normalizeVideoMaskMatteGraphV1(wrongInputKind), /raster.*input|kind/iu);
});

test('graph validation rejects cycles and every independent depth/node/path-point overflow', () => {
	const cycle = graph();
	const shape = (cycle.nodes as Record<string, unknown>[]).find(({ id }) => id === 'shape')!;
	Object.assign(shape, { kind: 'invert', inputNodeId: 'feather' });
	delete shape.shape;
	delete shape.x;
	delete shape.y;
	delete shape.width;
	delete shape.height;
	assert.throws(() => normalizeVideoMaskMatteGraphV1(cycle), /cycle/iu);

	const chainNodes: Record<string, unknown>[] = [{
		id: 'node-0', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1,
	}];
	for (let index = 1; index <= 32; index += 1) {
		chainNodes.push({ id: `node-${String(index)}`, kind: 'invert', inputNodeId: `node-${String(index - 1)}` });
	}
	assert.throws(() => normalizeVideoMaskMatteGraphV1({
		schemaVersion: 1, id: 'deep-graph', kind: 'mask', inputs: [], nodes: chainNodes,
		outputNodeId: 'node-32',
	}), /depth|32/iu);

	assert.throws(() => normalizeVideoMaskMatteGraphV1({
		schemaVersion: 1,
		id: 'wide-graph',
		kind: 'mask',
		inputs: [],
		nodes: new Array(4_097).fill({
			id: 'node', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1,
		}),
		outputNodeId: 'node',
	}), /4096|nodes|entries/iu);

	const points = Array.from({ length: 16_385 }, (_, index) => point(index, 0));
	assert.throws(() => normalizeVideoMaskMatteGraphV1({
		schemaVersion: 1,
		id: 'point-graph',
		kind: 'mask',
		inputs: [],
		nodes: [{ id: 'path-node', kind: 'vector-path', fillRule: 'nonzero', paths: [{
			id: 'too-many-points', closed: false, points,
		}] }],
		outputNodeId: 'path-node',
	}), /16384|point|entries/iu);
});

function assertDeepFrozen(value: unknown): void {
	if (!value || typeof value !== 'object') return;
	assert.equal(Object.isFrozen(value), true);
	for (const child of Object.values(value)) assertDeepFrozen(child);
}

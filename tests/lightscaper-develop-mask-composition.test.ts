/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { manageImageDevelopMasksV3 } from '../src/common/editor/imaging/image-develop-mask-management-v3.ts';
import { manageImageDevelopMasksV2 } from '../src/common/editor/imaging/image-develop-mask-management-v2.ts';
import { manageImageDevelopMasksV1 } from '../src/common/editor/imaging/image-develop-mask-management-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { IMAGE_DEVELOP_LIMITS_V1 } from '../src/common/editor/imaging/image-develop-contract-v1.ts';
import { videoMaskMatteGraphComputationV1 } from '../src/common/editor/video-mask-matte-name-v2.ts';
import { withVideoMaskMatteBrushV1 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

type Develop = ReturnType<typeof normalizeImageDevelopStateV1OrV2>;
type Graph = Develop['masks'][number];
const BRUSH = `brush-mask-v1:4:1:${'a'.repeat(64)}`;
const COMPOSE = { type: 'compose', maskId: 'selected', operandMaskId: 'operand', operation: 'union' } as const;
function shape(id = 'shape') { return { id, kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }; }
function graph(id: string, count = 1) { return { schemaVersion: 1, id, kind: 'matte', inputs: [],
	nodes: Array.from({ length: count }, (_, index) => shape(index === 0 ? 'shape' : `shape-${String(index)}`)), outputNodeId: 'shape' }; }
function recipe(masks: readonly unknown[], processVersion: 1 | 2 = 1): Develop {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV1(), processVersion, masks,
		effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } }),
			createVideoEffect('detail-sharpen-v1', { id: 'detail', enabled: false, params: { amount: 37 } }),
			createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropX: 0.2, cropWidth: 0.7 } })],
		geometry: { crop: null, rotationDegrees: 0, flipHorizontal: true, flipVertical: false },
		maskBindings: [{ effectId: 'tone', maskId: 'selected' }, { effectId: 'detail', maskId: 'operand' }] });
}
function selected(develop: Develop, id = 'selected'): Graph { const value = develop.masks.find(mask => mask.id === id); assert.ok(value); return value; }
function body(alpha: readonly number[]) {
	assert.equal(alpha.length, 4);
	// Independent SCMASK01 literal: four one-byte alpha samples, no encoder oracle.
	const bytes = Uint8Array.from([83, 67, 77, 65, 83, 75, 48, 49, 4, 0, 0, 0, 1, 0, 0, 0, ...alpha]);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	return { bytes, reference: Object.freeze({ storageKey: `brush-mask-v1:4:1:${sha256}`, sha256, width: 4, height: 1, byteLength: 20 }) };
}
function brushGraph(id: string, sourceRef: string) { return { schemaVersion: 1, id, kind: 'matte',
	inputs: [{ name: 'Paint', kind: 'alpha', sourceRef }], nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'Paint' }], outputNodeId: 'alpha' }; }
function source(bodies: readonly ReturnType<typeof body>[], calls: string[]): MaskRasterSourcePortV1 {
	const port: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, port); calls.push(reference.storageKey);
		const value = bodies.find(candidate => candidate.reference.storageKey === reference.storageKey);
		assert.ok(value, 'The complete graph asked for an undeclared fixture body.'); assert.deepEqual(reference, value.reference);
		return await consume(new Uint8Array(value.bytes));
	} }; return port;
}

for (const [operation, expected] of [
	['union', [255, 192, 192, 255]], ['intersect', [0, 64, 64, 0]], ['subtract', [0, 63, 191, 255]],
] as const) test(`composition ${operation} follows the existing exact partial-alpha byte arithmetic`, async () => {
	const a = body([0, 64, 192, 255]), b = body([255, 192, 64, 0]), calls: string[] = [];
	const input = recipe([brushGraph('selected', a.reference.storageKey), brushGraph('operand', b.reference.storageKey)]), before = structuredClone(input);
	const result = manageImageDevelopMasksV3(input, { ...COMPOSE, operation }), composite = selected(result), output = composite.nodes.find(node => node.id === composite.outputNodeId);
	assert.ok(output?.kind === 'boolean'); assert.equal(output.operation, operation);
	assert.equal(output.inputNodeIds[0], selected(input).outputNodeId); assert.notEqual(output.inputNodeIds[0], output.inputNodeIds[1]);
	assert.deepEqual(await withVideoMaskMatteBrushV1({ graph: videoMaskMatteGraphComputationV1(composite), width: 4, height: 1 },
		coverage => [...coverage], source([a, b], calls)), [...expected]);
	assert.deepEqual(new Set(calls), new Set([a.reference.storageKey, b.reference.storageKey])); assert.equal(calls.length, 2);
	assert.deepEqual(input, before); assert.deepEqual(selected(result, 'operand'), selected(input, 'operand'));
});

test('named selected matte and mixed legacy donors preserve identities, names, effects and all bindings', () => {
	const input = recipe([{ ...graph('selected'), schemaVersion: 2, name: 'Sky é' }, graph('operand'), { ...graph('unrelated'), schemaVersion: 2, name: 'Other' }], 2);
	const before = structuredClone(input), result = manageImageDevelopMasksV3(input, COMPOSE), composite = selected(result), target = selected(input);
	assert.equal(composite.id, target.id); assert.equal(composite.kind, target.kind); assert.equal(composite.schemaVersion, 2);
	assert.ok(composite.schemaVersion === 2); assert.equal(composite.name, 'Sky é');
	for (const node of target.nodes) assert.deepEqual(composite.nodes.find(value => value.id === node.id), node);
	assert.deepEqual(composite.inputs, target.inputs); assert.equal(composite.nodes.length, target.nodes.length + selected(input, 'operand').nodes.length + 1);
	assert.notEqual(composite.outputNodeId, target.outputNodeId); assert.equal(result.processVersion, 2);
	assert.deepEqual(result.effects, input.effects); assert.deepEqual(result.geometry, input.geometry); assert.deepEqual(result.maskBindings, input.maskBindings);
	assert.deepEqual(result.masks.filter(mask => mask.id !== 'selected'), input.masks.filter(mask => mask.id !== 'selected'));
	assert.deepEqual(input, before); assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(composite.nodes), true);
	assert.deepEqual(manageImageDevelopMasksV3(input, COMPOSE), result, 'Alias allocation is deterministic.');
});

test('complete donor node, input and vector-path namespaces remap collisions without dropping unused declarations', () => {
	const point = (x: number, y: number) => ({ position: { x, y }, inHandle: null, outHandle: null });
	const complex = (id: string, sourceRef: string, x: number) => ({ schemaVersion: 1, id, kind: 'matte',
		inputs: [{ name: 'Paint', kind: 'alpha', sourceRef }, { name: 'UnusedPaint', kind: 'alpha', sourceRef: BRUSH }],
		nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'Paint' }, { id: 'inverse', kind: 'invert', inputNodeId: 'alpha' },
			{ id: 'feather', kind: 'feather', inputNodeId: 'inverse', radius: 0 },
			{ id: 'blend', kind: 'boolean', operation: 'subtract', inputNodeIds: ['alpha', 'feather'] },
			{ id: 'path-node', kind: 'vector-path', fillRule: 'even-odd', paths: [{ id: 'path', closed: true, points: [point(x, 0), point(x + 0.25, 0), point(x, 1)] }] },
			shape(id === 'operand' ? 'composed-node-1' : 'selected-spare')], outputNodeId: 'blend' });
	const input = recipe([complex('selected', 'body-a', 0), complex('operand', 'body-b', 0.5)]), before = structuredClone(input);
	const result = manageImageDevelopMasksV3(input, COMPOSE), composite = selected(result), target = selected(input), donor = selected(input, 'operand');
	for (const node of target.nodes) assert.deepEqual(composite.nodes.find(value => value.id === node.id), node);
	for (const declared of target.inputs) assert.deepEqual(composite.inputs.find(value => value.name === declared.name), declared);
	assert.equal(composite.nodes.length, target.nodes.length + donor.nodes.length + 1);
	assert.equal(composite.inputs.length, target.inputs.length + donor.inputs.length); assert.equal(new Set(composite.nodes.map(node => node.id)).size, composite.nodes.length);
	assert.deepEqual(composite.inputs.map(value => value.sourceRef).sort(), ['body-a', 'body-b', BRUSH, BRUSH].sort());
	const donorInput = composite.inputs.find(value => value.sourceRef === 'body-b')!; assert.notEqual(donorInput.name, 'Paint');
	const donorAlpha = composite.nodes.find(node => node.kind === 'alpha' && node.inputName === donorInput.name); assert.ok(donorAlpha);
	const donorInvert = composite.nodes.find(node => node.kind === 'invert' && node.inputNodeId === donorAlpha.id); assert.ok(donorInvert);
	const donorFeather = composite.nodes.find(node => node.kind === 'feather' && node.inputNodeId === donorInvert.id); assert.ok(donorFeather);
	const donorBlend = composite.nodes.find(node => node.kind === 'boolean' && node.operation === 'subtract' && node.inputNodeIds[0] === donorAlpha.id);
	assert.ok(donorBlend?.kind === 'boolean'); assert.deepEqual(donorBlend.inputNodeIds, [donorAlpha.id, donorFeather.id]);
	const output = composite.nodes.find(node => node.id === composite.outputNodeId); assert.ok(output?.kind === 'boolean');
	assert.deepEqual(output.inputNodeIds, [target.outputNodeId, donorBlend.id]);
	const paths = composite.nodes.flatMap(node => node.kind === 'vector-path' ? node.paths : []);
	assert.equal(paths.length, 2); assert.equal(new Set(paths.map(path => path.id)).size, 2);
	const donorPath = donor.nodes.find(node => node.kind === 'vector-path'); assert.ok(donorPath?.kind === 'vector-path');
	assert.deepEqual(paths.find(path => path.id !== 'path')?.points, donorPath.paths[0]!.points);
	assert.deepEqual(composite.nodes.find(node => node.id === 'composed-node-1'), donor.nodes.find(node => node.id === 'composed-node-1'));
	assert.deepEqual(selected(result, 'operand'), donor); assert.deepEqual(input, before);
});

test('unused immutable brush inputs remain declared and must still authenticate in the real scoped evaluator', async () => {
	const a = body([0, 64, 192, 255]), b = body([255, 192, 64, 0]), unused = body([17, 18, 19, 20]), calls: string[] = [];
	const donor = brushGraph('operand', b.reference.storageKey);
	const input = recipe([brushGraph('selected', a.reference.storageKey), { ...donor, inputs: [...donor.inputs, { name: 'Unused', kind: 'alpha', sourceRef: unused.reference.storageKey }] }]);
	const result = manageImageDevelopMasksV3(input, COMPOSE), composite = videoMaskMatteGraphComputationV1(selected(result));
	assert.deepEqual(composite.inputs.map(value => value.sourceRef).sort(), [a.reference.storageKey, b.reference.storageKey, unused.reference.storageKey].sort());
	assert.deepEqual(await withVideoMaskMatteBrushV1({ graph: composite, width: 4, height: 1 }, coverage => [...coverage], source([a, b, unused], calls)), [255, 192, 192, 255]);
	assert.deepEqual(new Set(calls), new Set([a.reference.storageKey, b.reference.storageKey, unused.reference.storageKey])); assert.equal(calls.length, 3);
	const corrupt = { ...unused, bytes: unused.bytes.slice() }; corrupt.bytes[16] = 99; let delivered = false;
	await assert.rejects(withVideoMaskMatteBrushV1({ graph: composite, width: 4, height: 1 }, () => { delivered = true; }, source([a, b, corrupt], [])));
	assert.equal(delivered, false); assert.deepEqual(selected(result, 'operand').inputs, selected(input, 'operand').inputs);
});

test('V3 delegates every V2 action while legacy closed command owners keep refusing composition', () => {
	const input = recipe([{ ...graph('selected'), schemaVersion: 2, name: 'Sky' }, graph('operand')], 2);
	for (const command of [{ type: 'rename', maskId: 'selected', name: ' Clouds ' },
		{ type: 'duplicate', maskId: 'selected', duplicateId: 'copy' }, { type: 'remove', maskId: 'operand' },
		{ type: 'bindings', maskId: 'selected', effectIds: ['detail', 'tone'] }, { type: 'bindings', maskId: 'selected', effectIds: [] }]) {
		assert.deepEqual(manageImageDevelopMasksV3(input, command), manageImageDevelopMasksV2(input, command));
	}
	assert.throws(() => manageImageDevelopMasksV1(input, COMPOSE)); assert.throws(() => manageImageDevelopMasksV2(input, COMPOSE));
});

test('closed composition rejects missing, self, future and accessor commands atomically without coercion or body authority', () => {
	const input = recipe([graph('selected'), graph('operand')]), before = structuredClone(input); let calls = 0;
	const coercion = { toString() { calls++; return 'union'; } };
	for (const command of [{ ...COMPOSE, maskId: 'missing' }, { ...COMPOSE, operandMaskId: 'missing' }, { ...COMPOSE, operandMaskId: 'selected' },
		{ ...COMPOSE, maskId: 'bad id' }, { ...COMPOSE, operation: 'xor' }, { ...COMPOSE, operation: coercion },
		{ ...COMPOSE, type: 'compose-next' }, { type: 'compose', maskId: 'selected', operandMaskId: 'operand' },
		{ ...COMPOSE, effectIds: [] }, { ...COMPOSE, source: new Proxy({}, { get() { calls++; throw Error('Body authority inspected'); } }) },
		{ ...COMPOSE, get operation() { calls++; return 'union'; } }, Object.create(COMPOSE) as unknown]) {
		assert.throws(() => manageImageDevelopMasksV3(input, command)); assert.deepEqual(input, before);
	}
	assert.throws(() => manageImageDevelopMasksV3({ ...input, get masks() { calls++; return input.masks; } }, COMPOSE));
	assert.equal(calls, 0);
});

test('128-character node IDs and 64-character input names collide safely without overflowing canonical aliases', () => {
	const nodeId = 'n'.repeat(128), inputName = 'P'.repeat(64);
	const make = (id: string, sourceRef: string) => ({ schemaVersion: 1, id, kind: 'mask', inputs: [{ name: inputName, kind: 'alpha', sourceRef }],
		nodes: [{ id: nodeId, kind: 'alpha', inputName }], outputNodeId: nodeId });
	const input = recipe([make('selected', 'body-a'), make('operand', 'body-b')]), result = manageImageDevelopMasksV3(input, COMPOSE), composite = selected(result);
	assert.equal(composite.nodes.length, 3); assert.equal(composite.inputs.length, 2);
	assert.ok(composite.nodes.every(node => node.id.length <= 128)); assert.ok(composite.inputs.every(value => value.name.length <= 64));
	assert.deepEqual(composite.nodes.find(node => node.id === nodeId), selected(input).nodes[0]);
	assert.deepEqual(composite.inputs.map(value => value.sourceRef).sort(), ['body-a', 'body-b']);
	assert.deepEqual(normalizeImageDevelopStateV1OrV2(JSON.parse(JSON.stringify(result)) as unknown), result);
});

test('composition preserves the 64-graph recipe bound and refuses combined node/input overflows atomically', () => {
	const full = recipe([graph('selected'), graph('operand'), ...Array.from({ length: 62 }, (_, index) => graph(`other-${String(index)}`))]);
	assert.equal(manageImageDevelopMasksV3(full, COMPOSE).masks.length, 64);
	const atNodes = recipe([graph('selected', 4094), graph('operand')]); assert.equal(selected(manageImageDevelopMasksV3(atNodes, COMPOSE)).nodes.length, 4096);
	const overNodes = recipe([graph('selected', 4095), graph('operand')]), nodeBefore = structuredClone(overNodes);
	assert.throws(() => manageImageDevelopMasksV3(overNodes, COMPOSE)); assert.deepEqual(overNodes, nodeBefore);
	const inputGraph = (id: string, count: number) => ({ ...graph(id), inputs: Array.from({ length: count }, (_, index) => ({ name: `Paint_${String(index)}`, kind: 'alpha', sourceRef: `body-${String(index)}` })) });
	const atInputs = recipe([inputGraph('selected', 255), inputGraph('operand', 1)]);
	assert.equal(selected(manageImageDevelopMasksV3(atInputs, COMPOSE)).inputs.length, 256);
	const overInputs = recipe([inputGraph('selected', 256), inputGraph('operand', 1)]), inputBefore = structuredClone(overInputs);
	assert.throws(() => manageImageDevelopMasksV3(overInputs, COMPOSE)); assert.deepEqual(overInputs, inputBefore);
});

test('combined path point and topology depth budgets retain the strict graph owner limits', () => {
	const pathGraph = (id: string, count: number) => ({ schemaVersion: 1, id, kind: 'mask', inputs: [], nodes: [{ id: 'path-node', kind: 'vector-path', fillRule: 'even-odd',
		paths: [{ id: 'path', closed: false, points: Array.from({ length: count }, () => ({ position: { x: 0, y: 0 }, inHandle: null, outHandle: null })) }] }], outputNodeId: 'path-node' });
	const points = recipe([pathGraph('selected', 8192), pathGraph('operand', 8193)]), before = structuredClone(points);
	assert.throws(() => manageImageDevelopMasksV3(points, COMPOSE)); assert.deepEqual(points, before);
	const chain = (depth: number) => ({ ...graph('selected'), nodes: [shape('node-0'), ...Array.from({ length: depth - 1 }, (_, index) =>
		({ id: `node-${String(index + 1)}`, kind: 'invert', inputNodeId: `node-${String(index)}` }))], outputNodeId: `node-${String(depth - 1)}` });
	const atDepth = recipe([chain(31), graph('operand')]); assert.ok(manageImageDevelopMasksV3(atDepth, COMPOSE));
	const overDepth = recipe([chain(32), graph('operand')]), depthBefore = structuredClone(overDepth);
	assert.throws(() => manageImageDevelopMasksV3(overDepth, COMPOSE)); assert.deepEqual(overDepth, depthBefore);
});

test('new composition refuses a normalized input or successor beyond the existing two-MiB recipe byte budget', () => {
	const large = (id: string, count: number) => ({ ...graph(id), nodes: Array.from({ length: count }, (_, index) => shape(`${id}-${String(index)}-`.padEnd(128, 'x'))),
		outputNodeId: `${id}-0-`.padEnd(128, 'x') });
	const fixed = [large('selected', 200), large('operand', 200), large('filler-a', 3000), large('filler-b', 3000)];
	const raw = (count: number) => ({ ...defaultImageDevelopStateV1(), masks: [...fixed, large('filler-c', count)] });
	const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
	const limit = IMAGE_DEVELOP_LIMITS_V1.maximumBytes; let lower = 1, upper = 4096;
	assert.ok(size(raw(lower)) < limit); assert.ok(size(raw(upper)) > limit);
	while (upper - lower > 1) { const middle = Math.floor((lower + upper) / 2); if (size(raw(middle)) <= limit) lower = middle; else upper = middle; }
	const input = normalizeImageDevelopStateV1OrV2(raw(lower)), before = structuredClone(input);
	assert.ok(size(input) <= limit); assert.ok(limit - size(input) < 512);
	assert.throws(() => manageImageDevelopMasksV3(input, COMPOSE), /byte|budget|MiB/iu); assert.deepEqual(input, before);
	assert.throws(() => manageImageDevelopMasksV3(raw(upper), COMPOSE), /byte|budget|MiB/iu);
});

test('composition detaches every returned node, input and path while leaving the caller-owned raw graphs untouched', () => {
	const raw = { ...defaultImageDevelopStateV1(), masks: [graph('selected'), graph('operand')] }, before = structuredClone(raw);
	const result = manageImageDevelopMasksV3(raw, COMPOSE), wire = JSON.stringify(result);
	assert.deepEqual(raw, before); raw.masks[0]!.nodes[0]!.width = 0.5;
	assert.equal(JSON.stringify(result), wire); assert.equal(Object.isFrozen(selected(result).nodes[0]), true);
	assert.notEqual(selected(result).nodes[0], raw.masks[0]!.nodes[0]);
});

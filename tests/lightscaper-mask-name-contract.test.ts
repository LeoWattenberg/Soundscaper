/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoMaskMatteGraphV1 } from '../src/common/editor/video-mask-matte-v24.ts';
import { normalizeVideoMaskMatteGraphV2, normalizeVideoMaskMatteGraphV1OrV2,
	videoMaskMatteGraphComputationV1, renameVideoMaskMatteGraphV2 } from '../src/common/editor/video-mask-matte-name-v2.ts';

const BRUSH = `brush-mask-v1:2:1:${'a'.repeat(64)}`;
function graph() {
	return { schemaVersion: 1, id: 'retained-mask', kind: 'matte',
		inputs: [{ name: 'Paint', kind: 'alpha', sourceRef: BRUSH },
			{ name: 'Unused', kind: 'raster', sourceRef: 'external-unused-source' }],
		nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'Paint' },
			{ id: 'gradient', kind: 'linear-gradient', start: { x: -0.2, y: 0 }, end: { x: 1.2, y: 1 } },
			{ id: 'unused', kind: 'raster', inputName: 'Unused', channel: 'red' },
			{ id: 'output', kind: 'boolean', operation: 'intersect', inputNodeIds: ['alpha', 'gradient'] }],
		outputNodeId: 'output' };
}
function named(name: unknown = 'Sky') { return { ...graph(), schemaVersion: 2, name }; }

test('named graph admission detaches the complete graph while preserving IDs, matte kind and unused resource declarations', () => {
	const input = named('Sky'), before = structuredClone(input), legacy = normalizeVideoMaskMatteGraphV1(graph());
	const result = normalizeVideoMaskMatteGraphV2(input);
	assert.deepEqual(result, { ...legacy, schemaVersion: 2, name: 'Sky' });
	assert.deepEqual(normalizeVideoMaskMatteGraphV1OrV2(input), result);
	assert.equal(result.id, 'retained-mask'); assert.equal(result.outputNodeId, 'output');
	assert.equal(result.inputs.find(value => value.name === 'Paint')?.sourceRef, BRUSH);
	assert.equal(result.inputs.find(value => value.name === 'Unused')?.sourceRef, 'external-unused-source');
	assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.nodes), true);
	assert.equal(Object.isFrozen(result.inputs[0]), true); assert.deepEqual(input, before);
	input.nodes[1]!.id = 'changed'; input.inputs[0]!.sourceRef = 'changed';
	assert.deepEqual(result, { ...legacy, schemaVersion: 2, name: 'Sky' });
});

test('the unnamed V1 owner remains exact and refuses named fields or a successor schema', () => {
	const legacy = normalizeVideoMaskMatteGraphV1(graph());
	assert.deepEqual(normalizeVideoMaskMatteGraphV1OrV2(graph()), legacy);
	assert.equal(JSON.stringify(normalizeVideoMaskMatteGraphV1OrV2(graph())), JSON.stringify(legacy));
	assert.equal(Object.hasOwn(legacy, 'name'), false);
	assert.throws(() => normalizeVideoMaskMatteGraphV1(named()));
	assert.throws(() => normalizeVideoMaskMatteGraphV1({ ...graph(), name: 'Sky' }));
	assert.throws(() => normalizeVideoMaskMatteGraphV2(graph()));
	assert.throws(() => normalizeVideoMaskMatteGraphV1OrV2({ ...graph(), name: 'Sky' }));
});

test('raw rename trims and normalizes NFC; clearing returns the complete unnamed V1 graph', () => {
	const legacy = normalizeVideoMaskMatteGraphV1(graph());
	const result = renameVideoMaskMatteGraphV2(graph(), ' \tCafe\u0301 \n');
	assert.deepEqual(result, { ...legacy, schemaVersion: 2, name: 'Café' });
	assert.deepEqual(renameVideoMaskMatteGraphV2(result, '  \t\n '), legacy);
	assert.deepEqual(renameVideoMaskMatteGraphV2(result, ''), legacy);
	assert.deepEqual(renameVideoMaskMatteGraphV2(result, 'Second'), { ...legacy, schemaVersion: 2, name: 'Second' });
	assert.deepEqual(renameVideoMaskMatteGraphV2(graph(), ''), legacy);
	for (const name of ['', ' ', ' Sky', 'Sky ', 'Cafe\u0301', null, undefined, 1]) {
		assert.throws(() => normalizeVideoMaskMatteGraphV2({ ...named(), name }));
	}
});

test('name length uses UTF16 units and strict admission preserves legitimate format characters', () => {
	for (const name of ['a'.repeat(256), '😀'.repeat(128), '👩\u200d🎨', 'می\u200cرود', 'Sky\ufe0f', 'A\u200bB']) {
		assert.equal(normalizeVideoMaskMatteGraphV2(named(name)).name, name);
		const result = renameVideoMaskMatteGraphV2(graph(), name);
		assert.equal(result.schemaVersion, 2); if (result.schemaVersion === 2) assert.equal(result.name, name);
	}
	for (const name of ['a'.repeat(257), '😀'.repeat(129)]) {
		assert.throws(() => normalizeVideoMaskMatteGraphV2(named(name)));
		assert.throws(() => renameVideoMaskMatteGraphV2(graph(), name));
	}
});

test('controls and unpaired surrogate code units refuse while genuine surrogate pairs remain valid', () => {
	for (const name of ['A\u0000B', 'A\tB', 'A\nB', 'A\rB', 'A\u001fB', 'A\u007fB', 'A\u0085B',
		'\ud800', '\udfff', 'A\ud800B', '\udc00\ud800', '\ud800\ud800\udc00']) {
		assert.throws(() => normalizeVideoMaskMatteGraphV2(named(name)));
		assert.throws(() => renameVideoMaskMatteGraphV2(graph(), name));
	}
	assert.equal(normalizeVideoMaskMatteGraphV2(named('A\ud83d\ude00B')).name, 'A😀B');
});

test('the computational view strips only name and version and stays detached from persistence metadata', () => {
	const input = named('Sky'), expected = normalizeVideoMaskMatteGraphV1(graph());
	const result = videoMaskMatteGraphComputationV1(input);
	assert.deepEqual(result, expected); assert.equal(Object.hasOwn(result, 'name'), false);
	assert.deepEqual(videoMaskMatteGraphComputationV1(graph()), expected);
	assert.deepEqual(videoMaskMatteGraphComputationV1(renameVideoMaskMatteGraphV2(input, 'Water')), expected);
	assert.equal(input.name, 'Sky'); assert.equal(input.schemaVersion, 2); assert.equal(Object.isFrozen(result), true);
});

test('closed named admission rejects missing, extra, inherited and future-version state without running getters or coercion', () => {
	let calls = 0;
	const accessor = { ...named(), get name() { calls++; return 'Sky'; } };
	const conversion = { toString() { calls++; return 'Sky'; }, normalize() { calls++; return 'Sky'; } };
	const missing = { ...named() }; Reflect.deleteProperty(missing, 'name');
	for (const value of [missing, accessor, { ...named(), body: {} }, { ...named(), schemaVersion: 3 },
		{ ...named(), name: conversion }, { ...named(), name: Object.create(String.prototype) as unknown }, Object.create(named()) as unknown]) {
		assert.throws(() => normalizeVideoMaskMatteGraphV2(value));
		assert.throws(() => normalizeVideoMaskMatteGraphV1OrV2(value));
	}
	assert.throws(() => renameVideoMaskMatteGraphV2(graph(), conversion));
	assert.throws(() => videoMaskMatteGraphComputationV1(accessor));
	assert.equal(calls, 0);
});

test('named graphs retain the actual V1 topology, input and scalar admission rather than accepting a parallel model', () => {
	for (const value of [{ ...named(), outputNodeId: 'missing' }, { ...named(), id: 'bad id' },
		{ ...named(), inputs: [{ name: 'Paint', kind: 'alpha', sourceRef: 'bad source' }] },
		{ ...named(), nodes: [{ id: 'output', kind: 'invert', inputNodeId: 'output' }] },
		{ ...named(), nodes: [{ id: 'output', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }] },
		{ ...named(), nodes: [{ id: 'output', kind: 'future-node' }] }]) {
		assert.throws(() => normalizeVideoMaskMatteGraphV2(value));
		assert.throws(() => videoMaskMatteGraphComputationV1(value));
	}
});

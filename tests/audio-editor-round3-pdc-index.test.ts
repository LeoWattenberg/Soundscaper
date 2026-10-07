/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { indexPdcDependencies, indexPdcOutputs, orderPdcVertices } from '../src/common/editor/engine/project-pdc-work-index-v21.ts';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';

test('dependency preparation reads each destination once instead of once per vertex', () => {
	let reads = 0;
	const dependencies = Array.from({ length: 600 }, (_, index) => ({
		source: `source-${String(index)}`,
		get destination() { reads += 1; return `destination-${String(index)}`; },
	}));
	let matches = 0;
	for (let index = 0; index < 600; index += 1) {
		for (const dependency of dependencies) if (dependency.destination === `destination-${String(index)}`) matches += 1;
	}
	assert.equal(matches, 600);
	assert.equal(reads, 360_000);
	reads = 0;
	const prepared = indexPdcDependencies(dependencies);
	assert.equal(reads, 600);
	for (let index = 0; index < 600; index += 1) {
		assert.strictEqual(prepared.get(`destination-${String(index)}`)?.[0], dependencies[index]);
	}
	assert.equal(reads, 600);
});

test('output indexing visits the edge array once and preserves enabled authored order', () => {
	const graph = createDefaultMixerGraphV21([{ id: 'one' }, { id: 'two' }]);
	const outgoing = graph.edges.at(-1)!;
	const extra = { ...outgoing, id: 'second', destination: { kind: 'output' as const, id: 'other' } };
	const disabled = { ...extra, id: 'disabled', enabled: false };
	const prepared = indexPdcOutputs([...graph.edges, extra, disabled, { ...outgoing, id: 'third' }]);
	assert.deepEqual([...prepared], [['main', [outgoing, { ...outgoing, id: 'third' }]], ['other', [extra]]]);
	assert.equal(prepared.has('disabled'), false);
});

function referenceOrder(keys: readonly string[], dependencies: readonly { source: string; destination: string }[]) {
	const indegree = new Map(keys.map(key => [key, 0]));
	const outgoing = new Map(keys.map(key => [key, [] as string[]]));
	for (const dependency of dependencies) {
		indegree.set(dependency.destination, (indegree.get(dependency.destination) ?? 0) + 1);
		outgoing.get(dependency.source)?.push(dependency.destination);
	}
	const ready = [...indegree].flatMap(([key, degree]) => degree === 0 ? [key] : []).sort();
	const ordered: string[] = [];
	while (ready.length) {
		const current = ready.shift()!;
		ordered.push(current);
		for (const next of outgoing.get(current) ?? []) {
			const degree = indegree.get(next)! - 1;
			indegree.set(next, degree);
			if (degree === 0) { ready.push(next); ready.sort(); }
		}
	}
	return ordered;
}

test('heap frontier preserves the exact previous lexical topology order across sparse and dense DAGs', () => {
	for (let seed = 0; seed < 32; seed += 1) {
		const keys = Array.from({ length: 40 }, (_, index) => `${index % 2 ? 'track' : 'mixer-node'}:${String(index)}`);
		const dependencies = keys.flatMap((source, first) => keys.flatMap((destination, second) => (
			second > first && (first * 7 + second * 13 + seed) % 17 < seed % 5
				? [{ source, destination }] : []
		)));
		assert.deepEqual(orderPdcVertices(keys, dependencies), referenceOrder(keys, dependencies));
	}
	assert.throws(() => orderPdcVertices(['a', 'b'], [
		{ source: 'a', destination: 'b' }, { source: 'b', destination: 'a' },
	]), /PDC routing graph contains a cycle/u);
});

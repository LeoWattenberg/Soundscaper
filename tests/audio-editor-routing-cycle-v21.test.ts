/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertAcyclicRoutingV21 } from '../src/common/editor/routing-cycle-v21.ts';

const MESSAGE = 'routing cycle';

function chain(depth: number, cyclic = false): ReadonlyMap<string, ReadonlySet<string>> {
	const adjacency = new Map<string, ReadonlySet<string>>();
	for (let index = 0; index < depth; index += 1) {
		const next = index + 1 < depth
			? [`n${String(index + 1)}`]
			: cyclic ? ['n0'] : [];
		adjacency.set(`n${String(index)}`, new Set(next));
	}
	return adjacency;
}

test('acyclic and cyclic graphs are decided by their shape', () => {
	assert.equal(assertAcyclicRoutingV21([], new Map(), MESSAGE), true);
	assert.equal(assertAcyclicRoutingV21(['a'], new Map([['a', new Set<string>()]]), MESSAGE), true);
	// A diamond revisits a shared vertex without that being a cycle.
	const diamond = new Map<string, ReadonlySet<string>>([
		['a', new Set(['b', 'c'])],
		['b', new Set(['d'])],
		['c', new Set(['d'])],
		['d', new Set<string>()],
	]);
	assert.equal(assertAcyclicRoutingV21(['a', 'b', 'c', 'd'], diamond, MESSAGE), true);
	assert.throws(
		() => assertAcyclicRoutingV21(['a'], new Map([['a', new Set(['a'])]]), MESSAGE),
		/routing cycle/iu,
	);
	assert.throws(() => assertAcyclicRoutingV21(
		['a', 'b'],
		new Map([['a', new Set(['b'])], ['b', new Set(['a'])]]),
		MESSAGE,
	), /routing cycle/iu);
});

test('a chain far deeper than the recursion limit is still decided by its shape', () => {
	// Recursive descent overflows the call stack between 4k and 8k frames, which is
	// under 2x the admissible mixer edge cap. This traversal carries its own stack so
	// depth cannot turn a decidable graph into a crash.
	const depth = 200_000;
	assert.equal(assertAcyclicRoutingV21([...chain(depth).keys()], chain(depth), MESSAGE), true);
	const cyclic = chain(depth, true);
	assert.throws(() => assertAcyclicRoutingV21([...cyclic.keys()], cyclic, MESSAGE), /routing cycle/iu);
});

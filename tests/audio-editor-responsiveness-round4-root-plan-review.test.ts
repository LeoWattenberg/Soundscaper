/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { orderParallelStackTasks } from '../src/common/editor/engine/parallel-stack-planning-index.ts';
import type { ParallelStackTask } from '../src/common/editor/engine/parallel-stack-types.ts';

/** Frozen predecessor algorithm: numeric task scans repeat until a pass makes no progress. */
function originalOrder(tasks: readonly ParallelStackTask[], workers: number): readonly ParallelStackTask[] {
	const order: number[] = [];
	const seen = new Set<number>();
	while (order.length < tasks.length) {
		let advanced = false;
		for (let index = 0; index < tasks.length; index++) {
			if (seen.has(index) || !tasks[index]!.dependencies.every(dependency => seen.has(dependency))) continue;
			seen.add(index); order.push(index); advanced = true;
		}
		if (!advanced) throw new Error('Parallel stack graph contains a cycle.');
	}
	const indexes = new Map(order.map((old, index) => [old, index]));
	return order.map((old, index) => ({
		...tasks[old]!, worker: index % workers,
		dependencies: tasks[old]!.dependencies.map(dependency => indexes.get(dependency)!),
		edges: tasks[old]!.edges.map(edge => ({ ...edge, sourceTask: indexes.get(edge.sourceTask)! })),
	}));
}

function observe(operation: () => readonly ParallelStackTask[]) {
	try { return operation(); }
	catch (error) { assert.ok(error instanceof Error); return { name: error.name, message: error.message }; }
}

test('independent exhaustive four-node directed graphs preserve task order, worker and edge ownership', context => {
	const arcs = Array.from({ length: 4 }, (_, destination) => (
		Array.from({ length: 4 }, (_, source) => [source, destination] as const)
			.filter(([source]) => source !== destination)
	)).flat();
	let comparisons = 0, plans = 0, refusals = 0;
	for (let mask = 0; mask < 2 ** arcs.length; mask++) {
		const tasks: readonly ParallelStackTask[] = Array.from({ length: 4 }, (_, index) => {
			const dependencies = arcs.filter(([, destination], bit) => destination === index && Boolean(mask >> bit & 1))
				.map(([source]) => source);
			return {
				kind: 'stack', key: String(index), worker: 0, dependencies,
				channels: 2, inputPlanes: [], inputDelayFrames: 0, prePlanes: [], postPlanes: [], effects: [],
				edges: dependencies.map(sourceTask => ({ id: `edge-${String(sourceTask)}`, sourceTask,
					sourcePlanes: [sourceTask], matrix: [[1]], delayFrames: 0, level: 1, sidechainEffectId: null })),
				gain: 1, pan: 0, gate: 1, vca: 1, outputDelayFrames: 0,
			};
		});
		for (const workers of [1, 2, 4]) {
			const expected = observe(() => originalOrder(tasks, workers));
			assert.deepEqual(observe(() => orderParallelStackTasks(tasks, workers)), expected);
			comparisons++;
			if (Array.isArray(expected)) plans++; else refusals++;
		}
	}
	assert.equal(comparisons, 12288); assert.equal(plans, 1629); assert.equal(refusals, 10659);
	context.diagnostic('All 4096 simple directed graphs without self loops × 3 worker counts retain exact plans or cycle errors.');
});

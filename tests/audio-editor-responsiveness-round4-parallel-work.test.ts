/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import {
	createParallelStackControlIndex,
	createParallelStackSidechainResolver,
	orderParallelStackTasks,
} from '../src/common/editor/engine/parallel-stack-planning-index.ts';
import type { ParallelStackTask } from '../src/common/editor/engine/parallel-stack-types.ts';

function task(index: number, dependencies: readonly number[]): ParallelStackTask {
	return {
		kind: 'stack', key: String(index), worker: 0, dependencies,
		channels: 2, inputPlanes: [], inputDelayFrames: 0, prePlanes: [], postPlanes: [],
		effects: [], edges: [], gain: 1, pan: 0, gate: 1, vca: 1, outputDelayFrames: 0,
	};
}

function legacyOrder(tasks: readonly ParallelStackTask[], workers: number): readonly ParallelStackTask[] {
	const order: number[] = [];
	const seen = new Set<number>();
	while (order.length < tasks.length) {
		let advanced = false;
		for (let index = 0; index < tasks.length; index += 1) {
			if (seen.has(index) || !tasks[index]!.dependencies.every(dependency => seen.has(dependency))) continue;
			seen.add(index); order.push(index); advanced = true;
		}
		if (!advanced) throw new Error('Parallel stack graph contains a cycle.');
	}
	const indexes = new Map(order.map((old, index) => [old, index]));
	return order.map((old, index) => ({ ...tasks[old]!, worker: index % workers,
		dependencies: tasks[old]!.dependencies.map(dependency => indexes.get(dependency)!),
		edges: tasks[old]!.edges.map(edge => ({ ...edge, sourceTask: indexes.get(edge.sourceTask)! })),
	}));
}

test('indexed task readiness preserves the original pass order and worker assignment', () => {
	for (let seed = 1; seed <= 200; seed += 1) {
		const size = seed % 37 + 3;
		const permutation = Array.from({ length: size }, (_, index) => index);
		let random = seed;
		const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
		for (let index = size - 1; index > 0; index -= 1) {
			const other = next() % (index + 1);
			[permutation[index], permutation[other]] = [permutation[other]!, permutation[index]!];
		}
		const positions = new Map(permutation.map((value, index) => [value, index]));
		const tasks = Array.from({ length: size }, (_, index) => task(index,
			permutation.slice(0, positions.get(index)!).filter(() => next() % 5 === 0)));
		for (const workers of [1, 2, 8]) assert.deepEqual(orderParallelStackTasks(tasks, workers), legacyOrder(tasks, workers));
	}
});

test('reverse chains read each dependency list a bounded number of times', () => {
	let reads = 0;
	const tasks = Array.from({ length: 120 }, (_, index) => {
		const value = task(index, index === 119 ? [] : [index + 1]);
		return Object.defineProperty(value, 'dependencies', { enumerable: true, get() { reads += 1; return index === 119 ? [] : [index + 1]; } });
	});
	const expected = legacyOrder(tasks, 4);
	const previousReads = reads;
	reads = 0;
	assert.deepEqual(orderParallelStackTasks(tasks, 4), expected);
	assert.ok(reads <= tasks.length * 3);
	assert.ok(previousReads > tasks.length * 50);
});

test('cycles and missing dependencies retain their original refusal', () => {
	for (const tasks of [[task(0, [1]), task(1, [0])], [task(0, [3])], [task(0, [0])]]) {
		assert.throws(() => orderParallelStackTasks(tasks, 2), { message: 'Parallel stack graph contains a cycle.' });
	}
	assert.deepEqual(orderParallelStackTasks([], 2), []);
});

test('control preparation retains exact authored VCA multiplication and group-before-send authority', () => {
	let memberReads = 0;
	const graph = normalizeMixerGraphV21({ schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [], outputs: [], edges: [] });
	const members = Array.from({ length: 30 }, (_, index) => Object.defineProperty({ kind: 'track' as const, id: String(index) }, 'id', {
		enumerable: true, get() { memberReads += 1; return String(index); },
	}));
	const vcas = [
		{ id: 'first', name: 'first', gain: .1, mute: false, members: [...members, members[0]!] },
		{ id: 'second', name: 'second', gain: .3, mute: false, members },
	];
	const index = createParallelStackControlIndex({ ...graph, vcas });
	const preparedReads = memberReads;
	for (let repeat = 0; repeat < 50; repeat += 1) for (let member = 0; member < 30; member += 1) {
		assert.equal(index.vcaGain(`track:${String(member)}`), .1 * .3);
	}
	assert.equal(memberReads, preparedReads);
	assert.equal(index.vcaGain('master'), 1);
	assert.equal(index.scope({ kind: 'master' }), 'master');
	assert.equal(index.scope({ kind: 'track', id: '0' }), 'track');
	const group = { id: 'shared', name: '', color: '', collapsed: false, gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [], channelCount: 2 };
	const scopes = createParallelStackControlIndex({ ...graph, groups: [group], sends: [group] });
	assert.equal(scopes.scope({ kind: 'mixer-node', id: 'shared' }), 'group');
	assert.equal(scopes.scope({ kind: 'mixer-node', id: 'missing' }), 'cue');
});

test('sidechain effect indexes are lazy, first-match and confined to one plan build', () => {
	let reads = 0;
	const first = Object.defineProperty({ id: 'detector', type: 'gate', params: {}, latencyFrames: 0, stateBytes: 1 }, 'id', {
		enumerable: true, get() { reads += 1; return 'detector'; },
	});
	const second = { ...first, type: 'limiter' };
	const value = { ...task(0, []), effects: [first, second] };
	reads = 0;
	const find = createParallelStackSidechainResolver();
	assert.equal(reads, 0);
	assert.equal(find(value, 'detector'), first);
	const preparedReads = reads;
	for (let repeat = 0; repeat < 500; repeat += 1) assert.equal(find(value, 'detector'), first);
	assert.equal(reads, preparedReads);
	assert.equal(find(value, 'absent'), undefined);
	assert.equal(createParallelStackSidechainResolver()({ ...value, effects: [second] }, 'detector'), second);
});

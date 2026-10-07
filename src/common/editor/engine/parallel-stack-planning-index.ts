/* SPDX-License-Identifier: AGPL-3.0-only */

import { mixerEndpointKeyV21, type MixerGraphV21 } from '../mixer-graph-v21.ts';
import type { StripRef } from '../parameter-address.ts';
import type { ParallelStackEffect, ParallelStackTask, ParallelStackTap } from './parallel-stack-types.ts';

/** Detached controls for one normalized, synchronous parallel-plan compilation. */
export function createParallelStackControlIndex(graph: Pick<MixerGraphV21, 'groups' | 'sends' | 'vcas'>): {
	vcaGain(key: string): number;
	scope(ref: StripRef): ParallelStackTap['scope'];
} {
	const gains = new Map<string, number>();
	for (const vca of graph.vcas) {
		const members = new Set<string>();
		for (const member of vca.members) {
			const key = mixerEndpointKeyV21(member);
			if (members.has(key)) continue;
			members.add(key);
			gains.set(key, (gains.get(key) ?? 1) * (vca.mute ? 0 : vca.gain));
		}
	}
	const scopes = new Map<string, 'group' | 'send'>();
	for (const group of graph.groups) if (!scopes.has(group.id)) scopes.set(group.id, 'group');
	for (const send of graph.sends) if (!scopes.has(send.id)) scopes.set(send.id, 'send');
	return {
		vcaGain: key => gains.get(key) ?? 1,
		scope: ref => ref.kind === 'mixer-node' ? scopes.get(ref.id) ?? 'cue' : ref.kind,
	};
}

/** Tasks and their effect arrays are private and complete before their edges are visited. */
export function createParallelStackSidechainResolver(): (
	task: ParallelStackTask,
	effectId: string,
) => ParallelStackEffect | undefined {
	const indexes = new WeakMap<ParallelStackTask, ReadonlyMap<string, ParallelStackEffect>>();
	return (task, effectId) => {
		let index = indexes.get(task);
		if (!index) {
			const prepared = new Map<string, ParallelStackEffect>();
			for (const effect of task.effects) if (!prepared.has(effect.id)) prepared.set(effect.id, effect);
			index = prepared;
			indexes.set(task, index);
		}
		return index.get(effectId);
	};
}

/** Preserve the former repeated numeric scan's pass/index order, including worker placement. */
export function orderParallelStackTasks(tasks: readonly ParallelStackTask[], workers: number): readonly ParallelStackTask[] {
	const size = tasks.length;
	const remaining = new Uint32Array(size);
	const dependents: number[][] = Array.from({ length: size }, () => []);
	for (let index = 0; index < size; index += 1) {
		const dependencies = tasks[index]!.dependencies;
		remaining[index] = dependencies.length;
		for (const dependency of dependencies) dependents[dependency]?.push(index);
	}
	const ready = new NumericFrontier();
	for (let index = 0; index < size; index += 1) if (remaining[index] === 0) ready.push(index);
	const order: number[] = [];
	while (ready.size) {
		const priority = ready.pop();
		const pass = Math.floor(priority / size);
		const index = priority % size;
		order.push(index);
		for (const dependent of dependents[index]!) {
			remaining[dependent] -= 1;
			if (remaining[dependent] === 0) ready.push((pass + (dependent < index ? 1 : 0)) * size + dependent);
		}
	}
	if (order.length !== size) throw new Error('Parallel stack graph contains a cycle.');
	const indexes = new Map(order.map((old, index) => [old, index]));
	return order.map((old, index) => ({ ...tasks[old]!, worker: index % workers,
		dependencies: tasks[old]!.dependencies.map(dependency => indexes.get(dependency)!),
		edges: tasks[old]!.edges.map(edge => ({ ...edge, sourceTask: indexes.get(edge.sourceTask)! })),
	}));
}

class NumericFrontier {
	#values: number[] = [];
	get size(): number { return this.#values.length; }
	push(value: number): void {
		const values = this.#values;
		let index = values.length;
		values.push(value);
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			if (values[parent]! <= value) break;
			values[index] = values[parent]!;
			index = parent;
		}
		values[index] = value;
	}
	pop(): number {
		const values = this.#values;
		const first = values[0]!;
		const last = values.pop()!;
		if (!values.length) return first;
		let index = 0;
		while (index * 2 + 1 < values.length) {
			const left = index * 2 + 1;
			const right = left + 1;
			const child = right < values.length && values[right]! < values[left]! ? right : left;
			if (values[child]! >= last) break;
			values[index] = values[child]!;
			index = child;
		}
		values[index] = last;
		return first;
	}
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerEdgeV21 } from '../mixer-graph-v21.ts';

interface PdcDependency {
	readonly source: string;
	readonly destination: string;
}

export function indexPdcDependencies<T extends PdcDependency>(
	dependencies: readonly T[],
): ReadonlyMap<string, readonly T[]> {
	const incoming = new Map<string, T[]>();
	for (const dependency of dependencies) {
		const destination = dependency.destination;
		let entries = incoming.get(destination);
		if (!entries) { entries = []; incoming.set(destination, entries); }
		entries.push(dependency);
	}
	return incoming;
}

export function indexPdcOutputs(edges: readonly MixerEdgeV21[]): ReadonlyMap<string, readonly MixerEdgeV21[]> {
	const outputs = new Map<string, MixerEdgeV21[]>();
	for (const edge of edges) {
		if (!edge.enabled || edge.kind === 'sidechain') continue;
		const destination = edge.destination;
		if (destination.kind !== 'output') continue;
		let incoming = outputs.get(destination.id);
		if (!incoming) { incoming = []; outputs.set(destination.id, incoming); }
		incoming.push(edge);
	}
	return outputs;
}

/** The heap keeps the original UTF-16 lexical frontier order without repeated whole-array sorts. */
export function orderPdcVertices(
	keys: Iterable<string>, dependencies: readonly PdcDependency[],
): readonly string[] {
	const indegree = new Map<string, number>();
	const outgoing = new Map<string, string[]>();
	for (const key of keys) { indegree.set(key, 0); outgoing.set(key, []); }
	const vertexCount = indegree.size;
	for (const dependency of dependencies) {
		indegree.set(dependency.destination, (indegree.get(dependency.destination) ?? 0) + 1);
		outgoing.get(dependency.source)?.push(dependency.destination);
	}
	const ready = new LexicalFrontier();
	for (const [key, degree] of indegree) if (degree === 0) ready.push(key);
	const result: string[] = [];
	while (ready.size) {
		const current = ready.pop();
		result.push(current);
		for (const next of outgoing.get(current) ?? []) {
			const degree = (indegree.get(next) ?? 0) - 1;
			indegree.set(next, degree);
			if (degree === 0) ready.push(next);
		}
	}
	if (result.length !== vertexCount) throw new TypeError('PDC routing graph contains a cycle');
	return Object.freeze(result);
}

class LexicalFrontier {
	#values: string[] = [];
	get size(): number { return this.#values.length; }
	push(value: string): void {
		let index = this.#values.length;
		this.#values.push(value);
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			const previous = this.#values[parent]!;
			if (previous <= value) break;
			this.#values[index] = previous;
			index = parent;
		}
		this.#values[index] = value;
	}
	pop(): string {
		const result = this.#values[0]!;
		const last = this.#values.pop()!;
		if (!this.#values.length) return result;
		let index = 0;
		while (index * 2 + 1 < this.#values.length) {
			let child = index * 2 + 1;
			if (child + 1 < this.#values.length && this.#values[child + 1]! < this.#values[child]!) child += 1;
			if (last <= this.#values[child]!) break;
			this.#values[index] = this.#values[child]!;
			index = child;
		}
		this.#values[index] = last;
		return result;
	}
}

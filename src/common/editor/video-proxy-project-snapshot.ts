/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_PROJECT_BINARY_HARD_LIMITS } from './scape-project-document.ts';

interface SnapshotBudget {
	readonly active: Set<object>;
	nodes: number;
	payloadCount: number;
	totalPayloadBytes: number;
}

const ARRAY_BUFFER_BYTE_LENGTH = getter(ArrayBuffer.prototype, 'byteLength');
const TYPED_ARRAY_BYTE_LENGTH = getter(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength');

/** @internal Capture one bounded descriptor-only project value without retaining its return graph. */
export function snapshotVideoProxyProject(value: unknown): unknown {
	return snapshotValue(value, 0, { active: new Set(), nodes: 0, payloadCount: 0, totalPayloadBytes: 0 });
}

function snapshotValue(value: unknown, depth: number, budget: SnapshotBudget): unknown {
	admitNode(depth, budget);
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (!value || typeof value !== 'object') return value;
	if (value instanceof Uint8Array) return snapshotUint8Array(value, budget);
	if (value instanceof ArrayBuffer) return snapshotArrayBuffer(value, budget);
	if (ArrayBuffer.isView(value)) return value;
	if (Array.isArray(value)) return snapshotArray(value, depth, budget);
	return snapshotRecord(value, depth, budget);
}

function snapshotArray(value: unknown[], depth: number, budget: SnapshotBudget): unknown[] {
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Array.prototype || Object.getPrototypeOf(value) !== prototype) {
		throw new TypeError('Video proxy project arrays must use the ordinary Array prototype.');
	}
	const length = stableDataValue(value, 'length', false);
	if (!Number.isSafeInteger(length) || Number(length) < 0) throw new TypeError('Video proxy project array length is invalid.');
	const keys = stableKeys(value);
	if (keys.length !== Number(length) + 1 || keys.some((key) => (
		key !== 'length' && (typeof key !== 'string' || !arrayIndex(key, Number(length)))
	))) throw new TypeError('Video proxy project arrays must be dense data arrays.');
	enter(value, Number(length), budget);
	try {
		const result: unknown[] = [];
		for (let index = 0; index < Number(length); index += 1) {
			result.push(snapshotValue(stableDataValue(value, String(index), true), depth + 1, budget));
		}
		return result;
	} finally {
		budget.active.delete(value);
	}
}

function snapshotRecord(value: object, depth: number, budget: SnapshotBudget): Record<string, unknown> {
	const prototype = Object.getPrototypeOf(value);
	if (Object.getPrototypeOf(value) !== prototype) throw new TypeError('The video proxy project prototype is unstable.');
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Video proxy projects must contain only plain objects and supported binary values.');
	}
	const keys = stableKeys(value);
	if (keys.some((key) => typeof key !== 'string')) {
		throw new TypeError('Video proxy project properties must use string keys.');
	}
	enter(value, keys.length, budget);
	try {
		const result: Record<string, unknown> = {};
		for (const key of keys as string[]) {
			Object.defineProperty(result, key, {
				value: snapshotValue(stableDataValue(value, key, true), depth + 1, budget),
				enumerable: true,
				configurable: true,
				writable: true,
			});
		}
		return result;
	} finally {
		budget.active.delete(value);
	}
}

function snapshotUint8Array(value: Uint8Array, budget: SnapshotBudget): Uint8Array {
	const byteLength = intrinsicByteLength(TYPED_ARRAY_BYTE_LENGTH, value);
	admitBinary(byteLength, budget);
	const result = new Uint8Array(byteLength);
	Uint8Array.prototype.set.call(result, value);
	return result;
}

function snapshotArrayBuffer(value: ArrayBuffer, budget: SnapshotBudget): ArrayBuffer {
	const byteLength = intrinsicByteLength(ARRAY_BUFFER_BYTE_LENGTH, value);
	admitBinary(byteLength, budget);
	const result = new Uint8Array(byteLength);
	Uint8Array.prototype.set.call(result, new Uint8Array(value));
	return result.buffer;
}

function stableDataValue(value: object, key: string, enumerable: boolean): unknown {
	const first = Object.getOwnPropertyDescriptor(value, key);
	const second = Object.getOwnPropertyDescriptor(value, key);
	if (!first || !second || !Object.hasOwn(first, 'value') || !Object.hasOwn(second, 'value')
		|| first.enumerable !== enumerable || second.enumerable !== enumerable
		|| first.configurable !== second.configurable || first.writable !== second.writable
		|| !Object.is(first.value, second.value)) {
		throw new TypeError(`Video proxy project property ${key} is missing, unsupported, or unstable.`);
	}
	return first.value;
}

function stableKeys(value: object): readonly PropertyKey[] {
	const first = Reflect.ownKeys(value);
	const second = Reflect.ownKeys(value);
	if (first.length !== second.length || first.some((key, index) => key !== second[index])) {
		throw new TypeError('The video proxy project property set is unstable.');
	}
	return first;
}

function enter(value: object, childCount: number, budget: SnapshotBudget): void {
	if (budget.active.has(value)) throw new TypeError('Cyclic video proxy project values are not supported.');
	if (childCount > SCAPE_PROJECT_BINARY_HARD_LIMITS.maximumTraversalNodes - budget.nodes) {
		throw new RangeError('The video proxy project exceeds its traversal node limit.');
	}
	budget.active.add(value);
}

function admitNode(depth: number, budget: SnapshotBudget): void {
	if (depth > SCAPE_PROJECT_BINARY_HARD_LIMITS.maximumTraversalDepth) {
		throw new RangeError('The video proxy project exceeds its traversal depth limit.');
	}
	budget.nodes += 1;
	if (budget.nodes > SCAPE_PROJECT_BINARY_HARD_LIMITS.maximumTraversalNodes) {
		throw new RangeError('The video proxy project exceeds its traversal node limit.');
	}
}

function admitBinary(byteLength: number, budget: SnapshotBudget): void {
	if (byteLength > SCAPE_PROJECT_BINARY_HARD_LIMITS.maximumPayloadBytes) {
		throw new RangeError('A video proxy project binary payload exceeds its byte limit.');
	}
	budget.payloadCount += 1;
	budget.totalPayloadBytes += byteLength;
	if (budget.payloadCount > SCAPE_PROJECT_BINARY_HARD_LIMITS.maximumPayloadCount
		|| budget.totalPayloadBytes > SCAPE_PROJECT_BINARY_HARD_LIMITS.maximumTotalPayloadBytes) {
		throw new RangeError('The video proxy project exceeds its aggregate binary limits.');
	}
}

function arrayIndex(key: string, length: number): boolean {
	const index = Number(key);
	return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function getter(target: object, key: string): (this: unknown) => unknown {
	const value = Object.getOwnPropertyDescriptor(target, key)?.get;
	if (!value) throw new Error(`Missing intrinsic ${key} getter.`);
	return value;
}

function intrinsicByteLength(getByteLength: (this: unknown) => unknown, value: object): number {
	const result = Reflect.apply(getByteLength, value, []) as unknown;
	if (!Number.isSafeInteger(result) || Number(result) < 0) throw new TypeError('Binary byte length is invalid.');
	return Number(result);
}

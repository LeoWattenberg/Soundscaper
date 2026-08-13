/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS } from '../project-v9-validation-budget.ts';
import type { AudioEditorCommand } from './protocol.ts';

type DataRecord = Record<string, unknown>;
type SnapshotTarget = DataRecord | unknown[] | null;
type SnapshotClone = DataRecord | unknown[] | ArrayBuffer | Uint8Array;

interface VisitWork {
	readonly kind: 'visit';
	readonly source: unknown;
	readonly target: SnapshotTarget;
	readonly key: string | number | null;
	readonly name: string;
	readonly depth: number;
}

interface LeaveWork { readonly kind: 'leave'; readonly source: object }
type SnapshotWork = VisitWork | LeaveWork;

/** Snapshot a complete command graph without invoking caller-owned code. */
export function snapshotInertEditorCommand(
	value: unknown,
	name = 'editor command',
): AudioEditorCommand {
	const snapshot = snapshotInertCommandGraph(value, name);
	assertCommandTree(snapshot, name);
	return snapshot as AudioEditorCommand;
}

function snapshotInertCommandGraph(value: unknown, name: string): unknown {
	const limits = AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS;
	const clones = new WeakMap<object, SnapshotClone>();
	const active = new Set<object>();
	const stack: SnapshotWork[] = [];
	let nodes = 0;
	let result: unknown;
	const schedule = (work: VisitWork): void => {
		if (work.depth > limits.maximumTraversalDepth) {
			throw new RangeError(`${name} exceeds its structural depth limit.`);
		}
		nodes += 1;
		if (nodes > limits.maximumTraversalNodes) {
			throw new RangeError(`${name} exceeds its aggregate inspection budget.`);
		}
		stack.push(work);
	};
	schedule({ kind: 'visit', source: value, target: null, key: null, name, depth: 0 });
	while (stack.length > 0) {
		const work = stack.pop()!;
		if (work.kind === 'leave') {
			active.delete(work.source);
			continue;
		}
		const source = work.source;
		if (source === null || typeof source !== 'object') {
			if (typeof source === 'function' || typeof source === 'symbol') {
				throw new TypeError(`${work.name} contains a non-inert value.`);
			}
			assignSnapshot(work, source, (next) => { result = next; });
			continue;
		}
		const prior = clones.get(source);
		if (prior) {
			if (active.has(source)) throw new TypeError(`${work.name} cannot contain a cycle.`);
			assignSnapshot(work, prior, (next) => { result = next; });
			continue;
		}
		if (Object.getPrototypeOf(source) === ArrayBuffer.prototype) {
			const clone = (source as ArrayBuffer).slice(0);
			clones.set(source, clone);
			assignSnapshot(work, clone, (next) => { result = next; });
			continue;
		}
		if (Object.getPrototypeOf(source) === Uint8Array.prototype) {
			const clone = new Uint8Array(source as Uint8Array);
			clones.set(source, clone);
			assignSnapshot(work, clone, (next) => { result = next; });
			continue;
		}
		if (ArrayBuffer.isView(source)) {
			throw new TypeError(`${work.name} supports only Uint8Array and ArrayBuffer binary values.`);
		}
		if (Array.isArray(source)) {
			if (Object.getPrototypeOf(source) !== Array.prototype) {
				throw new TypeError(`${work.name} must be a plain array.`);
			}
			const items = arrayDataValues(source, work.name);
			if (items.length > limits.maximumTraversalNodes - nodes) {
				throw new RangeError(`${name} exceeds its aggregate inspection budget.`);
			}
			const clone: unknown[] = new Array(items.length);
			clones.set(source, clone);
			active.add(source);
			assignSnapshot(work, clone, (next) => { result = next; });
			stack.push({ kind: 'leave', source });
			for (let index = items.length - 1; index >= 0; index -= 1) {
				schedule({
					kind: 'visit', source: items[index], target: clone, key: index,
					name: `${work.name}[${String(index)}]`, depth: work.depth + 1,
				});
			}
			continue;
		}
		const prototype = Object.getPrototypeOf(source);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError(`${work.name} must be a plain object.`);
		}
		const fields = objectDataValues(source, work.name);
		if (fields.length > limits.maximumTraversalNodes - nodes) {
			throw new RangeError(`${name} exceeds its aggregate inspection budget.`);
		}
		const clone = Object.create(prototype) as DataRecord;
		clones.set(source, clone);
		active.add(source);
		assignSnapshot(work, clone, (next) => { result = next; });
		stack.push({ kind: 'leave', source });
		for (let index = fields.length - 1; index >= 0; index -= 1) {
			const [key, field] = fields[index]!;
			schedule({
				kind: 'visit', source: field, target: clone, key,
				name: `${work.name}.${key}`, depth: work.depth + 1,
			});
		}
	}
	return result;
}

function assignSnapshot(work: VisitWork, value: unknown, setRoot: (value: unknown) => void): void {
	if (work.target === null || work.key === null) {
		setRoot(value);
		return;
	}
	Object.defineProperty(work.target, work.key, {
		value, enumerable: true, configurable: true, writable: true,
	});
}

function arrayDataValues(value: unknown[], name: string): readonly unknown[] {
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	if (!lengthDescriptor || lengthDescriptor.enumerable || !Object.hasOwn(lengthDescriptor, 'value')
		|| !Number.isSafeInteger(lengthDescriptor.value) || Number(lengthDescriptor.value) < 0) {
		throw new TypeError(`${name}.length must be an own data property.`);
	}
	const length = Number(lengthDescriptor.value);
	for (const key of Reflect.ownKeys(value)) {
		if (key === 'length') continue;
		if (typeof key !== 'string' || !arrayIndex(key, length)) {
			throw new TypeError(`${name} contains an unsupported field.`);
		}
	}
	const values: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an own enumerable data property.`);
		}
		values.push(descriptor.value);
	}
	return values;
}

function objectDataValues(value: object, name: string): ReadonlyArray<readonly [string, unknown]> {
	const values: Array<readonly [string, unknown]> = [];
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} contains an unsupported field.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		values.push([key, descriptor.value]);
	}
	return values;
}

function assertCommandTree(value: unknown, name: string): void {
	const seen = new Set<object>();
	const stack: Array<readonly [unknown, string]> = [[value, name]];
	while (stack.length > 0) {
		const [candidate, commandName] = stack.pop()!;
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`${commandName} must be a plain object.`);
		}
		if (seen.has(candidate)) continue;
		seen.add(candidate);
		const command = candidate as DataRecord;
		const type = ownDataValue(command, 'type', commandName);
		if (typeof type !== 'string') throw new TypeError(`${commandName}.type must be a string.`);
		if (type !== 'batch') continue;
		const commands = ownDataValue(command, 'commands', commandName);
		if (!Array.isArray(commands)) throw new TypeError(`${commandName}.commands must be an array.`);
		for (let index = commands.length - 1; index >= 0; index -= 1) {
			stack.push([commands[index], `${commandName}.commands[${String(index)}]`]);
		}
	}
}

function ownDataValue(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function arrayIndex(value: string, length: number): boolean {
	if (!/^(?:0|[1-9]\d*)$/u.test(value)) return false;
	const index = Number(value);
	return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === value;
}

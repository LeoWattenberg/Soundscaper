/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS } from '../project-v9-validation-budget.ts';
import type { AudioEditorCommand } from './protocol.ts';

type DataRecord = Record<string, unknown>;
type SnapshotTarget = DataRecord | unknown[] | null;
type SnapshotClone = DataRecord | unknown[] | ArrayBuffer | Uint8Array;

const INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const INTRINSIC_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const INTRINSIC_OWN_KEYS = Reflect.ownKeys;
const INTRINSIC_APPLY = Reflect.apply;
const INTRINSIC_ARRAY_BUFFER = ArrayBuffer;
const INTRINSIC_UINT8_ARRAY = Uint8Array;
const INTRINSIC_ARRAY_BUFFER_PROTOTYPE = INTRINSIC_ARRAY_BUFFER.prototype;
const INTRINSIC_UINT8_ARRAY_PROTOTYPE = INTRINSIC_UINT8_ARRAY.prototype;
const INTRINSIC_TYPED_ARRAY_PROTOTYPE = INTRINSIC_GET_PROTOTYPE_OF(INTRINSIC_UINT8_ARRAY_PROTOTYPE);
const INTRINSIC_ARRAY_BUFFER_BYTE_LENGTH = requiredGetter(
	INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(INTRINSIC_ARRAY_BUFFER_PROTOTYPE, 'byteLength'),
	'ArrayBuffer byteLength',
);
const INTRINSIC_TYPED_ARRAY_LENGTH = requiredGetter(
	INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(INTRINSIC_TYPED_ARRAY_PROTOTYPE, 'length'),
	'typed-array length',
);
const INTRINSIC_TYPED_ARRAY_SET = requiredValueFunction(
	INTRINSIC_GET_OWN_PROPERTY_DESCRIPTOR(INTRINSIC_TYPED_ARRAY_PROTOTYPE, 'set'),
	'typed-array set',
);

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
		if (intrinsicLength(INTRINSIC_ARRAY_BUFFER_BYTE_LENGTH, source) !== null) {
			if (INTRINSIC_GET_PROTOTYPE_OF(source) !== INTRINSIC_ARRAY_BUFFER_PROTOTYPE) {
				throw new TypeError(`${work.name} must be an exact ArrayBuffer.`);
			}
			const clone = cloneArrayBuffer(source as ArrayBuffer, work.name);
			clones.set(source, clone);
			assignSnapshot(work, clone, (next) => { result = next; });
			continue;
		}
		if (intrinsicLength(INTRINSIC_TYPED_ARRAY_LENGTH, source) !== null) {
			if (INTRINSIC_GET_PROTOTYPE_OF(source) !== INTRINSIC_UINT8_ARRAY_PROTOTYPE) {
				throw new TypeError(`${work.name} supports only exact Uint8Array binary views.`);
			}
			const clone = cloneUint8Array(source as Uint8Array, work.name);
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

function cloneArrayBuffer(source: ArrayBuffer, name: string): ArrayBuffer {
	if (INTRINSIC_OWN_KEYS(source).length !== 0) {
		throw new TypeError(`${name} binary value contains an unsupported own field.`);
	}
	const length = intrinsicLength(INTRINSIC_ARRAY_BUFFER_BYTE_LENGTH, source);
	if (length === null) throw new TypeError(`${name} must be an ArrayBuffer.`);
	const clone = new INTRINSIC_ARRAY_BUFFER(length);
	const sourceBytes = new INTRINSIC_UINT8_ARRAY(source);
	const targetBytes = new INTRINSIC_UINT8_ARRAY(clone);
	INTRINSIC_APPLY(INTRINSIC_TYPED_ARRAY_SET, targetBytes, [sourceBytes]);
	return clone;
}

function cloneUint8Array(source: Uint8Array, name: string): Uint8Array {
	const length = intrinsicLength(INTRINSIC_TYPED_ARRAY_LENGTH, source);
	if (length === null) throw new TypeError(`${name} must be a Uint8Array.`);
	const clone = new INTRINSIC_UINT8_ARRAY(length);
	INTRINSIC_APPLY(INTRINSIC_TYPED_ARRAY_SET, clone, [source]);
	return clone;
}

function intrinsicLength(getter: () => unknown, value: object): number | null {
	try {
		const length = INTRINSIC_APPLY(getter, value, []);
		return Number.isSafeInteger(length) && Number(length) >= 0 ? Number(length) : null;
	} catch (error) {
		if (error instanceof TypeError) return null;
		throw error;
	}
}

function requiredGetter(descriptor: PropertyDescriptor | undefined, name: string): () => unknown {
	if (typeof descriptor?.get !== 'function') throw new Error(`Missing intrinsic ${name} getter.`);
	return descriptor.get;
}

function requiredValueFunction(
	descriptor: PropertyDescriptor | undefined,
	name: string,
): (...args: unknown[]) => unknown {
	if (typeof descriptor?.value !== 'function') throw new Error(`Missing intrinsic ${name} function.`);
	return descriptor.value as (...args: unknown[]) => unknown;
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

/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_PROJECT_BINARY_HARD_LIMITS } from './scape-project-document.ts';

const ARRAY_BUFFER_BYTE_LENGTH_GETTER = requiredGetter<number>(ArrayBuffer.prototype, 'byteLength');
const ARRAY_BUFFER_SLICE = requiredMethod(ArrayBuffer.prototype, 'slice');
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = requiredGetter<object>(TYPED_ARRAY_PROTOTYPE, 'buffer');
const TYPED_ARRAY_BYTE_LENGTH_GETTER = requiredGetter<number>(TYPED_ARRAY_PROTOTYPE, 'byteLength');
const TYPED_ARRAY_SLICE = requiredMethod(TYPED_ARRAY_PROTOTYPE, 'slice');

export interface AudioEditorProjectValidationLimits {
	readonly maximumTraversalNodes: number;
	readonly maximumTraversalDepth: number;
}

export const AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS: Readonly<
	AudioEditorProjectValidationLimits
> = Object.freeze({
	maximumTraversalNodes: SCAPE_PROJECT_BINARY_HARD_LIMITS.maximumTraversalNodes,
	maximumTraversalDepth: SCAPE_PROJECT_BINARY_HARD_LIMITS.maximumTraversalDepth,
});

interface ValidationStructureBudget {
	readonly active: Set<object>;
	readonly limits: Readonly<AudioEditorProjectValidationLimits>;
	nodes: number;
}

interface VisitWork {
	readonly kind: 'visit';
	readonly value: unknown;
	readonly depth: number;
}

interface LeaveWork {
	readonly kind: 'leave';
	readonly value: object;
}

type StructureWork = VisitWork | LeaveWork;

export function resolveAudioEditorProjectValidationLimits(
	overrides: unknown = {},
): Readonly<AudioEditorProjectValidationLimits> {
	if (!isPlainObject(overrides)) {
		throw new TypeError('Audio editor project validation limits must be an object.');
	}
	for (const name of Object.keys(overrides)) {
		if (!Object.hasOwn(AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS, name)) {
			throw new TypeError(`Unsupported audio editor project validation limit: ${name}.`);
		}
	}
	const limits = {
		...AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
		...overrides,
	};
	for (const name of Object.keys(
		AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
	) as (keyof AudioEditorProjectValidationLimits)[]) {
		const value = limits[name];
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError(`Audio editor project validation ${name} must be a positive safe integer.`);
		}
		if (value > AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS[name]) {
			throw new RangeError(`Audio editor project validation ${name} cannot exceed its hard limit.`);
		}
	}
	return Object.freeze(limits);
}

/** Admit a JSON-compatible project shape before any semantic validator walks it. */
export function admitAudioEditorProjectValidationStructure(
	value: unknown,
	limits: Readonly<AudioEditorProjectValidationLimits>,
): void {
	const budget: ValidationStructureBudget = { active: new Set(), limits, nodes: 0 };
	const stack: StructureWork[] = [];
	scheduleVisit(stack, value, 0, budget);
	while (stack.length > 0) {
		const work = stack.pop();
		if (!work) continue;
		if (work.kind === 'leave') {
			budget.active.delete(work.value);
			continue;
		}
		const candidate = work.value;
		if (candidate === null) continue;
		if (typeof candidate !== 'object') {
			admitJsonScalar(candidate);
			continue;
		}
		if (admitSupportedBinary(candidate)) continue;
		if (ArrayBuffer.isView(candidate)) {
			throw new TypeError('Audio editor projects support only Uint8Array and ArrayBuffer binary values.');
		}
		if (Array.isArray(candidate)) {
			admitArray(stack, candidate, work.depth, budget);
			continue;
		}
		if (!isPlainObject(candidate)) {
			throw new TypeError('Audio editor projects must contain only plain objects and supported binary values.');
		}
		admitObject(stack, candidate, work.depth, budget);
	}
}

function admitSupportedBinary(value: object): boolean {
	if (value instanceof Uint8Array) {
		admitUint8Array(value);
		return true;
	}
	if (value instanceof ArrayBuffer) {
		admitArrayBuffer(value);
		return true;
	}
	return false;
}

function admitUint8Array(value: Uint8Array): void {
	if (Object.getPrototypeOf(value) !== Uint8Array.prototype) {
		throw new TypeError('Audio editor project Uint8Array values must use the ordinary binary prototype.');
	}
	const byteLength = intrinsicByteLength(TYPED_ARRAY_BYTE_LENGTH_GETTER, value);
	const buffer = intrinsicObject(TYPED_ARRAY_BUFFER_GETTER, value);
	if (!(buffer instanceof ArrayBuffer) || Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype) {
		throw new TypeError('Audio editor project Uint8Array values require an ordinary ArrayBuffer.');
	}
	intrinsicByteLength(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer);
	if (Reflect.ownKeys(value).length !== byteLength) {
		throw new TypeError('Audio editor project binary values cannot carry extra properties.');
	}
	probeBinarySlice(TYPED_ARRAY_SLICE, value);
}

function admitArrayBuffer(value: ArrayBuffer): void {
	if (Object.getPrototypeOf(value) !== ArrayBuffer.prototype) {
		throw new TypeError('Audio editor project ArrayBuffer values must use the ordinary binary prototype.');
	}
	intrinsicByteLength(ARRAY_BUFFER_BYTE_LENGTH_GETTER, value);
	if (Reflect.ownKeys(value).length !== 0) {
		throw new TypeError('Audio editor project binary values cannot carry extra properties.');
	}
	probeBinarySlice(ARRAY_BUFFER_SLICE, value);
}

function probeBinarySlice(method: (this: object, ...args: unknown[]) => unknown, value: object): void {
	try {
		Reflect.apply(method, value, [0, 0]);
	} catch (error) {
		throw new TypeError('Audio editor project binary value is detached or out of bounds.', { cause: error });
	}
}

function intrinsicByteLength(getter: (this: object) => number, value: object): number {
	try {
		return Reflect.apply(getter, value, []) as number;
	} catch (error) {
		throw new TypeError('Audio editor project binary value has an invalid intrinsic brand.', { cause: error });
	}
}

function intrinsicObject(getter: (this: object) => object, value: object): object {
	try {
		return Reflect.apply(getter, value, []) as object;
	} catch (error) {
		throw new TypeError('Audio editor project binary value has an invalid intrinsic brand.', { cause: error });
	}
}

function requiredGetter<Result>(target: object, key: string): (this: object) => Result {
	const getter = Object.getOwnPropertyDescriptor(target, key)?.get;
	if (!getter) throw new Error(`Missing intrinsic ${key} getter.`);
	return getter as (this: object) => Result;
}

function requiredMethod(target: object, key: string): (this: object, ...args: unknown[]) => unknown {
	const method = Object.getOwnPropertyDescriptor(target, key)?.value as unknown;
	if (typeof method !== 'function') throw new Error(`Missing intrinsic ${key} method.`);
	return method as (this: object, ...args: unknown[]) => unknown;
}

function admitJsonScalar(value: unknown): void {
	if (typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number' && Number.isFinite(value)) return;
	throw new TypeError('Audio editor projects must contain only JSON-serializable scalar values.');
}

function admitArray(
	stack: StructureWork[],
	value: unknown[],
	depth: number,
	budget: ValidationStructureBudget,
): void {
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError('Audio editor project arrays must use the ordinary Array prototype.');
	}
	assertNoToJsonHook(value as unknown as Record<string, unknown>);
	assertChildrenFit(value.length, budget);
	assertCanonicalArrayProperties(value);
	enterContainer(stack, value, budget);
	for (let index = value.length - 1; index >= 0; index -= 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		const child = descriptor ? dataPropertyValue(descriptor, `array index ${String(index)}`) : undefined;
		scheduleVisit(stack, child, depth + 1, budget);
	}
}

function admitObject(
	stack: StructureWork[],
	value: Record<string, unknown>,
	depth: number,
	budget: ValidationStructureBudget,
): void {
	assertNoToJsonHook(value);
	enterContainer(stack, value, budget);
	for (const key in value) {
		if (!Object.hasOwn(value, key)) {
			throw new TypeError('Audio editor projects cannot inherit enumerable data properties.');
		}
	}
	const keys = Reflect.ownKeys(value);
	assertChildrenFit(keys.length, budget);
	for (let index = keys.length - 1; index >= 0; index -= 1) {
		const key = keys[index];
		if (key === undefined) continue;
		if (typeof key !== 'string') {
			throw new TypeError('Audio editor project properties must use string keys.');
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) throw new TypeError(`Audio editor project property ${key} is unavailable.`);
		scheduleVisit(stack, enumerableDataPropertyValue(descriptor), depth + 1, budget);
	}
}

function assertCanonicalArrayProperties(value: unknown[]): void {
	for (const key of Reflect.ownKeys(value)) {
		if (key === 'length') continue;
		if (typeof key !== 'string' || !isCanonicalArrayIndex(key, value.length)) {
			throw new TypeError('Audio editor project arrays cannot carry named or symbol properties.');
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) throw new TypeError(`Audio editor project array index ${key} is unavailable.`);
		enumerableDataPropertyValue(descriptor);
	}
}

function isCanonicalArrayIndex(value: string, length: number): boolean {
	const index = Number(value);
	return Number.isInteger(index) && index >= 0 && index < length && String(index) === value;
}

function enterContainer(
	stack: StructureWork[],
	value: object,
	budget: ValidationStructureBudget,
): void {
	if (budget.active.has(value)) throw new TypeError('Cyclic audio editor project values are not supported.');
	budget.active.add(value);
	stack.push({ kind: 'leave', value });
}

function scheduleVisit(
	stack: StructureWork[],
	value: unknown,
	depth: number,
	budget: ValidationStructureBudget,
): void {
	if (depth > budget.limits.maximumTraversalDepth) {
		throw new RangeError('The audio editor project validation exceeds its structural traversal depth limit.');
	}
	budget.nodes += 1;
	if (budget.nodes > budget.limits.maximumTraversalNodes) {
		throw new RangeError('The audio editor project validation exceeds its structural traversal node limit.');
	}
	stack.push({ kind: 'visit', value, depth });
}

function assertChildrenFit(childCount: number, budget: ValidationStructureBudget): void {
	if (childCount > budget.limits.maximumTraversalNodes - budget.nodes) {
		throw new RangeError('The audio editor project validation exceeds its structural traversal node limit.');
	}
}

function assertNoToJsonHook(value: Record<string, unknown>): void {
	const descriptor = Object.getOwnPropertyDescriptor(value, 'toJSON');
	if (!descriptor) return;
	const candidate = dataPropertyValue(descriptor, 'toJSON');
	if (typeof candidate === 'function') {
		throw new TypeError('Audio editor project toJSON hooks are not supported.');
	}
}

function dataPropertyValue(descriptor: PropertyDescriptor, name: string): unknown {
	if (!Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Audio editor project ${name} accessors are not supported.`);
	}
	return descriptor.value;
}

function enumerableDataPropertyValue(descriptor: PropertyDescriptor): unknown {
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Audio editor project properties must be enumerable data properties.');
	}
	return descriptor.value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

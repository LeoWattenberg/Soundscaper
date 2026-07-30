/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_PROJECT_BINARY_HARD_LIMITS } from './scape-project-document.ts';

export interface AudioEditorProjectV9ValidationLimits {
	readonly maximumTraversalNodes: number;
	readonly maximumTraversalDepth: number;
}

export const AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS: Readonly<
	AudioEditorProjectV9ValidationLimits
> = Object.freeze({
	maximumTraversalNodes: SCAPE_PROJECT_BINARY_HARD_LIMITS.maximumTraversalNodes,
	maximumTraversalDepth: SCAPE_PROJECT_BINARY_HARD_LIMITS.maximumTraversalDepth,
});

interface ValidationStructureBudget {
	readonly active: Set<object>;
	readonly limits: Readonly<AudioEditorProjectV9ValidationLimits>;
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

export function resolveAudioEditorProjectV9ValidationLimits(
	overrides: unknown = {},
): Readonly<AudioEditorProjectV9ValidationLimits> {
	if (!isPlainObject(overrides)) {
		throw new TypeError('Audio editor project V9 validation limits must be an object.');
	}
	for (const name of Object.keys(overrides)) {
		if (!Object.hasOwn(AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS, name)) {
			throw new TypeError(`Unsupported audio editor project V9 validation limit: ${name}.`);
		}
	}
	const limits = {
		...AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
		...overrides,
	};
	for (const name of Object.keys(
		AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
	) as (keyof AudioEditorProjectV9ValidationLimits)[]) {
		const value = limits[name];
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError(`Audio editor project V9 validation ${name} must be a positive safe integer.`);
		}
		if (value > AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS[name]) {
			throw new RangeError(`Audio editor project V9 validation ${name} cannot exceed its hard limit.`);
		}
	}
	return Object.freeze(limits);
}

/** Admit a JSON-compatible project shape before any semantic validator walks it. */
export function admitAudioEditorProjectV9ValidationStructure(
	value: unknown,
	limits: Readonly<AudioEditorProjectV9ValidationLimits>,
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
		if (candidate instanceof Uint8Array || candidate instanceof ArrayBuffer) continue;
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

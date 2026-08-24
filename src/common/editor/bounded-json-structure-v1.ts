/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Iterative structural admission for JSON-like boundary values. This runs
 * before JSON.stringify/canonical expansion so depth, graph size and authored
 * string bytes have hard ceilings independent of the serializer's stack.
 */

export const BOUNDED_MESSAGE_JSON_STRUCTURE_V1 = Object.freeze({
	maximumDepth: 48,
	maximumNodes: 8_192,
	maximumStringBytes: 64 * 1_024,
});

export type BoundedJsonStructureErrorCode = 'malformed' | 'oversized';

export class BoundedJsonStructureError extends Error {
	readonly code: BoundedJsonStructureErrorCode;

	constructor(code: BoundedJsonStructureErrorCode, message: string) {
		super(message);
		this.name = 'BoundedJsonStructureError';
		this.code = code;
	}
}

interface StructureBudgetV1 {
	readonly maximumDepth: number;
	readonly maximumNodes: number;
	readonly maximumStringBytes: number;
}

interface VisitFrame {
	readonly value: unknown;
	readonly depth: number;
	readonly exit?: object;
}

export function assertBoundedJsonStructureV1(
	value: unknown,
	budget: StructureBudgetV1 = BOUNDED_MESSAGE_JSON_STRUCTURE_V1,
): void {
	assertBudget(budget);
	const ancestors = new Set<object>();
	const stack: VisitFrame[] = [{ value, depth: 0 }];
	let nodes = 0;
	let stringBytes = 0;
	while (stack.length > 0) {
		const frame = stack.pop()!;
		if (frame.exit !== undefined) {
			ancestors.delete(frame.exit);
			continue;
		}
		nodes += 1;
		if (nodes > budget.maximumNodes) oversized('The JSON value exceeds its structural node budget.');
		if (frame.depth > budget.maximumDepth) oversized('The JSON value exceeds its structural depth budget.');
		const current = frame.value;
		if (typeof current === 'string') {
			stringBytes = addStringBytes(current, stringBytes, budget.maximumStringBytes);
			continue;
		}
		if (current === null || typeof current === 'boolean') continue;
		if (typeof current === 'number') {
			if (!Number.isFinite(current)) malformed('A bounded JSON value contains a non-finite number.');
			continue;
		}
		if (typeof current !== 'object') malformed('A bounded JSON value contains a non-JSON value.');
		if (ancestors.has(current)) malformed('A bounded JSON value contains a cycle.');
		ancestors.add(current);
		stack.push({ value: null, depth: frame.depth, exit: current });
		if (Array.isArray(current)) {
			const length = current.length;
			if (length > budget.maximumNodes - nodes) {
				overSizedNodes();
			}
			const keys = Reflect.ownKeys(current);
			if (keys.length !== length + 1 || keys.some((key) => typeof key !== 'string')) {
				malformed('A bounded JSON array has unsupported properties.');
			}
			for (let index = length - 1; index >= 0; index -= 1) {
				const field = String(index);
				const descriptor = Object.getOwnPropertyDescriptor(current, field);
				if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
					malformed('A bounded JSON array must be dense own data.');
				}
				stack.push({ value: descriptor.value, depth: frame.depth + 1 });
			}
			continue;
		}
		const prototype = Object.getPrototypeOf(current) as unknown;
		if (prototype !== Object.prototype && prototype !== null) {
			malformed('A bounded JSON value contains a non-plain record.');
		}
		const keys = Reflect.ownKeys(current);
		if (keys.length > budget.maximumNodes - nodes) overSizedNodes();
		for (let index = keys.length - 1; index >= 0; index -= 1) {
			const field = keys[index]!;
			if (typeof field !== 'string') malformed('A bounded JSON record contains a symbol key.');
			stringBytes = addStringBytes(field, stringBytes, budget.maximumStringBytes);
			const descriptor = Object.getOwnPropertyDescriptor(current, field);
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				malformed('A bounded JSON record must contain only enumerable own data.');
			}
			stack.push({ value: descriptor.value, depth: frame.depth + 1 });
		}
	}
}

function addStringBytes(value: string, current: number, maximum: number): number {
	let bytes = current;
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit <= 0x7f) bytes += 1;
		else if (unit <= 0x7ff) bytes += 2;
		else if (unit >= 0xd800 && unit <= 0xdbff
			&& index + 1 < value.length
			&& value.charCodeAt(index + 1) >= 0xdc00
			&& value.charCodeAt(index + 1) <= 0xdfff) {
			bytes += 4;
			index += 1;
		} else bytes += 3;
		if (bytes > maximum) oversized('The JSON value exceeds its structural string-byte budget.');
	}
	return bytes;
}

function assertBudget(value: StructureBudgetV1): void {
	if (!Number.isSafeInteger(value.maximumDepth) || value.maximumDepth < 0
		|| !Number.isSafeInteger(value.maximumNodes) || value.maximumNodes < 1
		|| !Number.isSafeInteger(value.maximumStringBytes) || value.maximumStringBytes < 1) {
		throw new TypeError('A bounded JSON structure requires valid positive budgets.');
	}
}

function overSizedNodes(): never {
	return oversized('The JSON value exceeds its structural node budget.');
}

function malformed(message: string): never {
	throw new BoundedJsonStructureError('malformed', message);
}

function oversized(message: string): never {
	throw new BoundedJsonStructureError('oversized', message);
}

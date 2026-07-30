/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
import {
	preflightScapeProjectJsonStructure,
	type ScapeProjectJsonStructureLimits,
} from './scape-project-json-preflight.ts';

const MIB = 1024 * 1024;
const BINARY_TAG = '$soundscaperOpaqueBinary';
const BINARY_DESCRIPTOR_SCHEMA_VERSION = 1;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BINARY_TAG_JSON_NODE_OVERHEAD = 6;
const BINARY_TAG_JSON_DEPTH_OVERHEAD = 2;
const OMIT = Symbol('omit');
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = requiredGetter(ArrayBuffer.prototype, 'byteLength');
const TYPED_ARRAY_BYTE_LENGTH_GETTER = requiredGetter(
	Object.getPrototypeOf(Uint8Array.prototype) as object,
	'byteLength',
);

export interface ScapeProjectBinaryLimits {
	readonly maximumPayloadCount: number;
	readonly maximumPayloadBytes: number;
	readonly maximumTotalPayloadBytes: number;
	readonly maximumTraversalNodes: number;
	readonly maximumTraversalDepth: number;
}

export interface ScapeProjectDocumentOptions {
	readonly limits?: Partial<ScapeProjectBinaryLimits>;
}

export const SCAPE_PROJECT_BINARY_HARD_LIMITS: Readonly<ScapeProjectBinaryLimits> = Object.freeze({
	maximumPayloadCount: 256,
	maximumPayloadBytes: 4 * MIB,
	maximumTotalPayloadBytes: 8 * MIB,
	maximumTraversalNodes: 100_000,
	maximumTraversalDepth: 128,
});

export const SCAPE_PROJECT_JSON_STRUCTURE_HARD_LIMITS: Readonly<
	ScapeProjectJsonStructureLimits
> = Object.freeze(jsonStructureLimits(SCAPE_PROJECT_BINARY_HARD_LIMITS));

interface BinaryDescriptor {
	readonly schemaVersion: 1;
	readonly id: number;
	readonly type: 'Uint8Array' | 'ArrayBuffer';
	readonly byteLength: number;
	readonly base64: string;
}

interface EncodeBudget {
	readonly limits: Readonly<ScapeProjectBinaryLimits>;
	readonly active: Set<object>;
	nodes: number;
	payloadCount: number;
	totalPayloadBytes: number;
}

interface DecodeBudget {
	readonly limits: Readonly<ScapeProjectBinaryLimits>;
	readonly ids: Set<number>;
	nodes: number;
	payloadCount: number;
	totalPayloadBytes: number;
}

type Container = Record<string, unknown> | unknown[];

interface LocatedBinaryDescriptor {
	readonly parent: Container;
	readonly key: string | number;
	readonly descriptor: BinaryDescriptor;
}

interface DecodeTraversal {
	readonly value: unknown;
	readonly parent: Container | null;
	readonly key: string | number | null;
	readonly depth: number;
}

export function resolveScapeProjectBinaryLimits(
	overrides: Partial<ScapeProjectBinaryLimits> = {},
): Readonly<ScapeProjectBinaryLimits> {
	if (!isPlainObject(overrides)) {
		throw new TypeError('Scape project binary limits must be an object.');
	}
	for (const name of Object.keys(overrides)) {
		if (!Object.hasOwn(SCAPE_PROJECT_BINARY_HARD_LIMITS, name)) {
			throw new TypeError(`Unsupported Scape project binary limit: ${name}.`);
		}
	}
	const limits = { ...SCAPE_PROJECT_BINARY_HARD_LIMITS, ...overrides };
	for (const name of Object.keys(
		SCAPE_PROJECT_BINARY_HARD_LIMITS,
	) as (keyof ScapeProjectBinaryLimits)[]) {
		const value = limits[name];
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError(`Scape project binary ${name} must be a positive safe integer.`);
		}
		if (value > SCAPE_PROJECT_BINARY_HARD_LIMITS[name]) {
			throw new RangeError(`Scape project binary ${name} cannot exceed its hard limit.`);
		}
	}
	return Object.freeze(limits);
}

export function serializeScapeProjectDocument(
	value: unknown,
	options: ScapeProjectDocumentOptions = {},
): string {
	const limits = resolveOptions(options);
	if (!hasCurrentSchemaVersion(value)) return ordinaryJson(value);
	const budget: EncodeBudget = {
		limits,
		active: new Set(),
		nodes: 0,
		payloadCount: 0,
		totalPayloadBytes: 0,
	};
	const encoded = encodeValue(value, 0, budget);
	if (encoded === OMIT) throw new TypeError('The Scape project cannot be serialized.');
	return ordinaryJson(encoded);
}

export function parseScapeProjectDocument(
	text: string,
	options: ScapeProjectDocumentOptions = {},
): unknown {
	if (typeof text !== 'string') throw new TypeError('The Scape project document must be JSON text.');
	const limits = resolveOptions(options);
	preflightScapeProjectJsonStructure(text, jsonStructureLimits(limits));
	const parsed: unknown = JSON.parse(text);
	if (!hasCurrentSchemaVersion(parsed)) return parsed;
	decodeCurrentProject(parsed, limits);
	return parsed;
}

function jsonStructureLimits(
	limits: Readonly<ScapeProjectBinaryLimits>,
): Readonly<ScapeProjectJsonStructureLimits> {
	return {
		maximumTraversalNodes: limits.maximumTraversalNodes
			+ limits.maximumPayloadCount * BINARY_TAG_JSON_NODE_OVERHEAD,
		maximumTraversalDepth: limits.maximumTraversalDepth + BINARY_TAG_JSON_DEPTH_OVERHEAD,
	};
}

function resolveOptions(options: ScapeProjectDocumentOptions): Readonly<ScapeProjectBinaryLimits> {
	if (!isPlainObject(options)) throw new TypeError('Scape project document options must be an object.');
	for (const name of Object.keys(options)) {
		if (name !== 'limits') throw new TypeError(`Unsupported Scape project document option: ${name}.`);
	}
	return resolveScapeProjectBinaryLimits(options.limits ?? {});
}

function ordinaryJson(value: unknown): string {
	const text = JSON.stringify(value);
	if (typeof text !== 'string') throw new TypeError('The Scape project cannot be serialized.');
	return text;
}

function hasCurrentSchemaVersion(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	if (!descriptor) return false;
	if (!Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Scape project schemaVersion accessors are not supported.');
	}
	if (descriptor.value !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) return false;
	if (!isPlainObject(value)) {
		throw new TypeError('A current-schema Scape project must be a plain object.');
	}
	return true;
}

function encodeValue(value: unknown, depth: number, budget: EncodeBudget): unknown | typeof OMIT {
	admitTraversal(depth, budget);
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return OMIT;
	if (typeof value === 'bigint') throw new TypeError('Scape project BigInt values are not JSON-compatible.');
	if (value instanceof Uint8Array) {
		return encodeUint8Array(value, 'Uint8Array', budget);
	}
	if (value instanceof ArrayBuffer) {
		return encodeArrayBuffer(value, budget);
	}
	if (ArrayBuffer.isView(value)) {
		throw new TypeError('Only Uint8Array and ArrayBuffer opaque binary values are supported.');
	}
	if (Array.isArray(value)) return encodeArray(value, depth, budget);
	if (!isPlainObject(value)) {
		throw new TypeError('Scape projects must contain only JSON-compatible objects and supported binary values.');
	}
	return encodeObject(value, depth, budget);
}

function encodeArray(value: unknown[], depth: number, budget: EncodeBudget): unknown[] {
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError('Scape project arrays must use the ordinary Array prototype.');
	}
	assertNoToJSONHook(value as unknown as Record<string, unknown>);
	enterContainer(value, budget);
	try {
		assertChildrenFitTraversal(value.length, budget);
		const encoded: unknown[] = [];
		for (let index = 0; index < value.length; index += 1) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (!descriptor) {
				admitTraversal(depth + 1, budget);
				encoded.push(null);
				continue;
			}
			const child = dataPropertyValue(descriptor, `array index ${String(index)}`);
			const result = encodeValue(child, depth + 1, budget);
			encoded.push(result === OMIT ? null : result);
		}
		return encoded;
	} finally {
		budget.active.delete(value);
	}
}

function encodeObject(
	value: Record<string, unknown>,
	depth: number,
	budget: EncodeBudget,
): Record<string, unknown> {
	if (Object.hasOwn(value, BINARY_TAG)) {
		throw new TypeError(`The reserved ${BINARY_TAG} tag collides with ordinary project data.`);
	}
	assertNoToJSONHook(value);
	enterContainer(value, budget);
	try {
		const encoded = Object.create(null) as Record<string, unknown>;
		const keys = Object.keys(value);
		assertChildrenFitTraversal(keys.length, budget);
		for (const key of keys) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor) throw new TypeError(`Scape project property ${key} is unavailable.`);
			const child = dataPropertyValue(descriptor, `property ${key}`);
			const result = encodeValue(child, depth + 1, budget);
			if (result !== OMIT) Object.defineProperty(encoded, key, enumerableData(result));
		}
		return encoded;
	} finally {
		budget.active.delete(value);
	}
}

function enterContainer(value: object, budget: EncodeBudget): void {
	if (budget.active.has(value)) throw new TypeError('Cyclic Scape project values are not supported.');
	budget.active.add(value);
}

function dataPropertyValue(descriptor: PropertyDescriptor, name: string): unknown {
	if (!Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Scape project ${name} accessors are not supported.`);
	}
	return descriptor.value;
}

function assertNoToJSONHook(value: Record<string, unknown>): void {
	const descriptor = Object.getOwnPropertyDescriptor(value, 'toJSON');
	if (!descriptor) return;
	const candidate = dataPropertyValue(descriptor, 'toJSON');
	if (typeof candidate === 'function') {
		throw new TypeError('Scape project toJSON hooks are not supported.');
	}
}

function enumerableData(value: unknown): PropertyDescriptor {
	return { value, enumerable: true, configurable: true, writable: true };
}

function encodeUint8Array(
	value: Uint8Array,
	type: BinaryDescriptor['type'],
	budget: EncodeBudget,
): Record<string, BinaryDescriptor> {
	const byteLength = intrinsicByteLength(TYPED_ARRAY_BYTE_LENGTH_GETTER, value);
	admitBinary(byteLength, budget);
	const bytes = new Uint8Array(byteLength);
	Uint8Array.prototype.set.call(bytes, value);
	return encodedBinaryTag(bytes, type, budget.payloadCount);
}

function encodeArrayBuffer(
	value: ArrayBuffer,
	budget: EncodeBudget,
): Record<string, BinaryDescriptor> {
	const byteLength = intrinsicByteLength(ARRAY_BUFFER_BYTE_LENGTH_GETTER, value);
	admitBinary(byteLength, budget);
	const bytes = new Uint8Array(byteLength);
	Uint8Array.prototype.set.call(bytes, new Uint8Array(value));
	return encodedBinaryTag(bytes, 'ArrayBuffer', budget.payloadCount);
}

function encodedBinaryTag(
	bytes: Uint8Array,
	type: BinaryDescriptor['type'],
	id: number,
): Record<string, BinaryDescriptor> {
	const descriptor: BinaryDescriptor = {
		schemaVersion: BINARY_DESCRIPTOR_SCHEMA_VERSION,
		id,
		type,
		byteLength: bytes.byteLength,
		base64: encodeBase64(bytes),
	};
	return { [BINARY_TAG]: descriptor };
}

function decodeCurrentProject(
	project: Record<string, unknown>,
	limits: Readonly<ScapeProjectBinaryLimits>,
): void {
	const budget: DecodeBudget = {
		limits,
		ids: new Set(),
		nodes: 0,
		payloadCount: 0,
		totalPayloadBytes: 0,
	};
	const located: LocatedBinaryDescriptor[] = [];
	const stack: DecodeTraversal[] = [];
	scheduleDecode(stack, { value: project, parent: null, key: null, depth: 0 }, budget);
	while (stack.length) {
		const current = stack.pop();
		if (!current) continue;
		if (!current.value || typeof current.value !== 'object') continue;
		if (Array.isArray(current.value)) {
			assertChildrenFitTraversal(current.value.length, budget);
			for (let index = current.value.length - 1; index >= 0; index -= 1) {
				scheduleDecode(stack, {
					value: current.value[index],
					parent: current.value,
					key: index,
					depth: current.depth + 1,
				}, budget);
			}
			continue;
		}
		const object = current.value as Record<string, unknown>;
		if (Object.hasOwn(object, BINARY_TAG)) {
			if (!current.parent || current.key === null) {
				throw new TypeError('The Scape project root cannot be a binary tag.');
			}
			const descriptor = validateBinaryTag(object, budget);
			located.push({ parent: current.parent, key: current.key, descriptor });
			continue;
		}
		const keys = Object.keys(object);
		assertChildrenFitTraversal(keys.length, budget);
		for (let index = keys.length - 1; index >= 0; index -= 1) {
			const key = keys[index];
			if (key === undefined) continue;
			scheduleDecode(stack, {
				value: object[key],
				parent: object,
				key,
				depth: current.depth + 1,
			}, budget);
		}
	}
	for (const item of located) {
		const bytes = decodeBase64(item.descriptor.base64, item.descriptor.byteLength);
		const value = item.descriptor.type === 'ArrayBuffer' ? bytes.buffer : bytes;
		Object.defineProperty(item.parent, item.key, enumerableData(value));
	}
}

function scheduleDecode(
	stack: DecodeTraversal[],
	item: DecodeTraversal,
	budget: DecodeBudget,
): void {
	admitTraversal(item.depth, budget);
	stack.push(item);
}

function assertChildrenFitTraversal(
	childCount: number,
	budget: Pick<EncodeBudget, 'limits' | 'nodes'> | Pick<DecodeBudget, 'limits' | 'nodes'>,
): void {
	if (childCount > budget.limits.maximumTraversalNodes - budget.nodes) {
		throw new RangeError('The Scape project exceeds the binary traversal node limit.');
	}
}

function validateBinaryTag(
	outer: Record<string, unknown>,
	budget: DecodeBudget,
): BinaryDescriptor {
	if (Object.keys(outer).length !== 1) {
		throw new TypeError(`The reserved ${BINARY_TAG} tag cannot have sibling fields.`);
	}
	const candidate = outer[BINARY_TAG];
	if (!isPlainObject(candidate)) throw new TypeError('A Scape opaque binary descriptor must be an object.');
	const expectedKeys = ['schemaVersion', 'id', 'type', 'byteLength', 'base64'];
	const keys = Object.keys(candidate);
	if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
		throw new TypeError('A Scape opaque binary descriptor has unknown or missing fields.');
	}
	if (candidate.schemaVersion !== BINARY_DESCRIPTOR_SCHEMA_VERSION) {
		throw new RangeError('Unsupported Scape opaque binary descriptor schema version.');
	}
	if (!Number.isSafeInteger(candidate.id) || Number(candidate.id) < 1) {
		throw new RangeError('A Scape opaque binary descriptor ID must be a positive safe integer.');
	}
	const id = Number(candidate.id);
	if (budget.ids.has(id)) throw new TypeError(`Duplicate Scape opaque binary descriptor ID: ${String(id)}.`);
	if (candidate.type !== 'Uint8Array' && candidate.type !== 'ArrayBuffer') {
		throw new TypeError('Unsupported Scape opaque binary descriptor type.');
	}
	if (!Number.isSafeInteger(candidate.byteLength) || Number(candidate.byteLength) < 0) {
		throw new RangeError('A Scape opaque binary byte length must be a safe non-negative integer.');
	}
	if (typeof candidate.base64 !== 'string') {
		throw new TypeError('Scape opaque binary base64 must be a string.');
	}
	const byteLength = Number(candidate.byteLength);
	validateCanonicalBase64(candidate.base64, byteLength);
	admitBinary(byteLength, budget);
	budget.ids.add(id);
	return {
		schemaVersion: BINARY_DESCRIPTOR_SCHEMA_VERSION,
		id,
		type: candidate.type,
		byteLength,
		base64: candidate.base64,
	};
}

function admitTraversal(
	depth: number,
	budget: Pick<EncodeBudget, 'limits' | 'nodes'> | Pick<DecodeBudget, 'limits' | 'nodes'>,
): void {
	if (depth > budget.limits.maximumTraversalDepth) {
		throw new RangeError('The Scape project exceeds the binary traversal depth limit.');
	}
	budget.nodes += 1;
	if (budget.nodes > budget.limits.maximumTraversalNodes) {
		throw new RangeError('The Scape project exceeds the binary traversal node limit.');
	}
}

function admitBinary(
	byteLength: number,
	budget: Pick<EncodeBudget, 'limits' | 'payloadCount' | 'totalPayloadBytes'>
		| Pick<DecodeBudget, 'limits' | 'payloadCount' | 'totalPayloadBytes'>,
): void {
	if (byteLength > budget.limits.maximumPayloadBytes) {
		throw new RangeError('A Scape opaque binary payload exceeds its byte limit.');
	}
	const payloadCount = budget.payloadCount + 1;
	if (payloadCount > budget.limits.maximumPayloadCount) {
		throw new RangeError('The Scape project has too many opaque binary payloads.');
	}
	const totalPayloadBytes = budget.totalPayloadBytes + byteLength;
	if (totalPayloadBytes > budget.limits.maximumTotalPayloadBytes) {
		throw new RangeError('The Scape project exceeds its aggregate opaque binary byte limit.');
	}
	budget.payloadCount = payloadCount;
	budget.totalPayloadBytes = totalPayloadBytes;
}

function validateCanonicalBase64(value: string, expectedBytes: number): void {
	if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
		throw new TypeError('Scape opaque binary base64 is malformed.');
	}
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	const byteLength = value.length / 4 * 3 - padding;
	if (byteLength !== expectedBytes) {
		throw new RangeError('Scape opaque binary base64 does not match its declared byte length.');
	}
	if (!value.length) return;
	if (padding === 2) {
		const index = BASE64_ALPHABET.indexOf(value[value.length - 3] ?? '');
		if (index < 0 || (index & 0x0f) !== 0) throw new TypeError('Scape opaque binary base64 is noncanonical.');
	} else if (padding === 1) {
		const index = BASE64_ALPHABET.indexOf(value[value.length - 2] ?? '');
		if (index < 0 || (index & 0x03) !== 0) throw new TypeError('Scape opaque binary base64 is noncanonical.');
	}
}

function encodeBase64(bytes: Uint8Array): string {
	let output = '';
	for (let index = 0; index < bytes.length; index += 3) {
		const first = bytes[index] ?? 0;
		const second = bytes[index + 1];
		const third = bytes[index + 2];
		const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
		output += BASE64_ALPHABET[(combined >>> 18) & 63];
		output += BASE64_ALPHABET[(combined >>> 12) & 63];
		output += second === undefined ? '=' : BASE64_ALPHABET[(combined >>> 6) & 63];
		output += third === undefined ? '=' : BASE64_ALPHABET[combined & 63];
	}
	return output;
}

function decodeBase64(value: string, byteLength: number): Uint8Array {
	const output = new Uint8Array(byteLength);
	let offset = 0;
	for (let index = 0; index < value.length; index += 4) {
		const first = BASE64_ALPHABET.indexOf(value[index] ?? '');
		const second = BASE64_ALPHABET.indexOf(value[index + 1] ?? '');
		const third = value[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 2] ?? '');
		const fourth = value[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 3] ?? '');
		const combined = (first << 18) | (second << 12) | (third << 6) | fourth;
		if (offset < output.length) output[offset++] = combined >>> 16;
		if (offset < output.length) output[offset++] = combined >>> 8;
		if (offset < output.length) output[offset++] = combined;
	}
	return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function requiredGetter(prototype: object, name: string): (this: object) => unknown {
	const getter = Object.getOwnPropertyDescriptor(prototype, name)?.get;
	if (!getter) throw new Error(`Missing intrinsic ${name} getter.`);
	return getter;
}

function intrinsicByteLength(getter: (this: object) => unknown, value: object): number {
	const byteLength = Reflect.apply(getter, value, []) as unknown;
	if (!Number.isSafeInteger(byteLength) || Number(byteLength) < 0) {
		throw new RangeError('An opaque binary value has an invalid byte length.');
	}
	return Number(byteLength);
}

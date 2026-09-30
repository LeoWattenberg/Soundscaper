/* SPDX-License-Identifier: AGPL-3.0-only */

const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
const MAXIMUM_COMPARISON_ARRAY_LENGTH = 8_192;
const PUBLICATION_ID = /^[a-f0-9]{48}$/u;
const ADMISSION_FIELDS = [
	'publicationId', 'maximumChunkBytes', 'bodyCount', 'requiredBodyIndexes',
] as const;

export interface FramescaperDesktopPublicationAdmission {
	readonly publicationId: string;
	readonly maximumChunkBytes: typeof MAXIMUM_CHUNK_BYTES;
	readonly bodyCount: number;
	readonly requiredBodyIndexes: readonly number[];
}

export function createFramescaperDesktopPublicationId(): string {
	const bytes = new Uint8Array(24);
	if (!globalThis.crypto?.getRandomValues) {
		throw new Error('Web Crypto is required for Framescaper publication identities.');
	}
	globalThis.crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateFramescaperDesktopPublicationAdmission(
	value: unknown,
	publicationId: string,
	bodyCount: number,
): Readonly<FramescaperDesktopPublicationAdmission> {
	if (!PUBLICATION_ID.test(publicationId)) {
		throw new TypeError('Framescaper publication identity is invalid.');
	}
	if (!Number.isSafeInteger(bodyCount) || bodyCount < 0 || Object.is(bodyCount, -0)) {
		throw new RangeError('Framescaper publication body count is invalid.');
	}
	const admission = closedRecord(value, ADMISSION_FIELDS, 'publication admission');
	if (admission.publicationId !== publicationId
		|| admission.maximumChunkBytes !== MAXIMUM_CHUNK_BYTES
		|| admission.bodyCount !== bodyCount) {
		throw new Error('Framescaper publication admission changed.');
	}
	const rawRequiredBodyIndexes = denseDataArray(
		admission.requiredBodyIndexes,
		'Framescaper required publication bodies',
		bodyCount,
	);
	const requiredBodyIndexes = rawRequiredBodyIndexes.map((indexValue, position, values) => {
		if (!Number.isSafeInteger(indexValue) || Number(indexValue) < 0 || Object.is(indexValue, -0)
			|| Number(indexValue) >= bodyCount
			|| position > 0 && Number(indexValue) <= Number(values[position - 1])) {
			throw new RangeError('Framescaper required publication body indexes changed.');
		}
		return Number(indexValue);
	});
	return Object.freeze({
		publicationId,
		maximumChunkBytes: MAXIMUM_CHUNK_BYTES,
		bodyCount,
		requiredBodyIndexes: Object.freeze(requiredBodyIndexes),
	});
}

export function assertFramescaperDesktopPublicationBodyInventory(
	admitted: readonly Readonly<{ descriptor: unknown }>[],
	prepared: readonly Readonly<{ descriptor: unknown }>[],
): void {
	if (!samePublicationBodyInventory(admitted, prepared)) {
		throw new Error('Framescaper publication body inventory changed after admission.');
	}
}

function samePublicationBodyInventory(admitted: unknown, prepared: unknown): boolean {
	try {
		const left = denseDataArray(admitted, 'Framescaper admitted publication bodies');
		const right = denseDataArray(prepared, 'Framescaper prepared publication bodies');
		if (left.length !== right.length) return false;
		for (let index = 0; index < left.length; index += 1) {
			const admittedDescriptor = ownDescriptorValue(left[index], index, 'admitted');
			const preparedDescriptor = ownDescriptorValue(right[index], index, 'prepared');
			if (!sameCanonicalData(admittedDescriptor, preparedDescriptor, {
				left: new WeakSet<object>(), right: new WeakSet<object>(), nodes: 0,
			})) return false;
		}
		return true;
	} catch {
		return false;
	}
}

function ownDescriptorValue(value: unknown, index: number, side: string): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`Framescaper ${side} publication body ${String(index)} must be a record.`);
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'descriptor');
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(
			`Framescaper ${side} publication body ${String(index)}.descriptor must be an own data property.`,
		);
	}
	return descriptor.value;
}

interface CanonicalComparisonState {
	readonly left: WeakSet<object>;
	readonly right: WeakSet<object>;
	nodes: number;
}

function sameCanonicalData(left: unknown, right: unknown, state: CanonicalComparisonState): boolean {
	if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
		if (typeof left !== typeof right || typeof left === 'undefined' || typeof left === 'function'
			|| typeof left === 'symbol' || typeof left === 'bigint') return false;
		if (typeof left === 'number' && (!Number.isFinite(left) || !Number.isFinite(right as number)
			|| Object.is(left, -0) || Object.is(right, -0))) return false;
		return Object.is(left, right);
	}
	state.nodes += 1;
	if (state.nodes > 1_024 || state.left.has(left) || state.right.has(right)) return false;
	state.left.add(left);
	state.right.add(right);
	try {
		if (Array.isArray(left) || Array.isArray(right)) {
			if (!Array.isArray(left) || !Array.isArray(right)) return false;
			const leftValues = denseDataArray(left, 'Framescaper admitted descriptor array', 1_024);
			const rightValues = denseDataArray(right, 'Framescaper prepared descriptor array', 1_024);
			return leftValues.length === rightValues.length
				&& leftValues.every((value, index) => sameCanonicalData(value, rightValues[index], state));
		}
		const leftPrototype = Object.getPrototypeOf(left) as object | null;
		const rightPrototype = Object.getPrototypeOf(right) as object | null;
		if ((leftPrototype !== Object.prototype && leftPrototype !== null)
			|| (rightPrototype !== Object.prototype && rightPrototype !== null)) return false;
		const leftKeys = Reflect.ownKeys(left);
		const rightKeys = Reflect.ownKeys(right);
		if (leftKeys.some((key) => typeof key !== 'string')
			|| rightKeys.some((key) => typeof key !== 'string')) return false;
		const leftNames = (leftKeys as string[]).sort();
		const rightNames = (rightKeys as string[]).sort();
		if (leftNames.length !== rightNames.length
			|| leftNames.some((key, index) => key !== rightNames[index])) return false;
		return leftNames.every((key) => {
			const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
			const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
			return Boolean(leftDescriptor?.enumerable && rightDescriptor?.enumerable
				&& Object.hasOwn(leftDescriptor, 'value') && Object.hasOwn(rightDescriptor, 'value')
				&& sameCanonicalData(leftDescriptor.value, rightDescriptor.value, state));
		});
	} finally {
		state.left.delete(left);
		state.right.delete(right);
	}
}

function denseDataArray(
	value: unknown,
	label: string,
	maximumLength = MAXIMUM_COMPARISON_ARRAY_LENGTH,
): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be a bounded dense array.`);
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
		|| !Number.isSafeInteger(lengthDescriptor.value) || Number(lengthDescriptor.value) < 0) {
		throw new TypeError(`${label} must be a bounded dense array.`);
	}
	const length = Number(lengthDescriptor.value);
	if (length > maximumLength || Reflect.ownKeys(value).length !== length + 1) {
		throw new TypeError(`${label} must be a bounded dense array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}[${String(index)}] must be an own data property.`);
		}
		result.push(descriptor.value);
	}
	return result;
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Framescaper ${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`Framescaper ${label} has unsupported fields.`);
	}
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper ${label}.${field} must be an own data property.`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

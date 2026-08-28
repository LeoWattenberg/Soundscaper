/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed renderer-value validation shared by the native-services projections. */

export function recordOrNull(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

export function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	const row = recordOrNull(value);
	if (!row || (Object.getPrototypeOf(row) !== Object.prototype
		&& Object.getPrototypeOf(row) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return row as Readonly<Record<Field, unknown>>;
}

export function boundedArray(value: unknown, maximum: number, label: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`A Framescaper native ${label} value must be a bounded dense array.`);
	}
	return value;
}

export function member<const Value extends string>(
	value: unknown,
	values: readonly Value[],
	label: string,
): Value {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(`A Framescaper native ${label} value is invalid.`);
	}
	return value as Value;
}

export function exactJobId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
		throw new TypeError('A Framescaper native queue request requires an exact job id.');
	}
	return value;
}

export function exactOpaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{16,64}$/u.test(value)) {
		throw new TypeError(`A Framescaper native ${label} is invalid.`);
	}
	return value;
}

export function stableIdentifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new TypeError(`A Framescaper native ${label} is invalid.`);
	}
	return value;
}

export function stableExtension(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9]{0,15}$/u.test(value)) {
		throw new TypeError('A Framescaper native watch extension is invalid.');
	}
	return value;
}

export function optionalDisplayId(value: unknown): string | null {
	return value === null ? null : boundedText(value, 'display id', 128);
}

export function boundedText(value: unknown, label: string, maximum = 4_096): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum
		|| value.includes('\0')) {
		throw new TypeError(`A Framescaper native ${label} value is invalid.`);
	}
	return value;
}

export function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`A Framescaper native ${label} value is invalid.`);
	}
	return value as number;
}

export function positiveInteger(value: unknown, label: string): number {
	const number = nonNegativeInteger(value, label);
	if (number === 0) throw new RangeError(`A Framescaper native ${label} value must be positive.`);
	return number;
}

export function booleanValue(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') {
		throw new TypeError(`A Framescaper native ${label} value is invalid.`);
	}
	return value;
}

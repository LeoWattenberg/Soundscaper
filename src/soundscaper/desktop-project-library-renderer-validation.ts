/* SPDX-License-Identifier: AGPL-3.0-only */

const SIGNAL_FIELDS = ['signal'] as const;

export function isSoundscaperDesktopWriteFenceRefusal(error: unknown): boolean {
	return error instanceof Error
		&& error.message.includes('[soundscaper-v1-project-library-publication-refusal:write-fence]');
}

export function signalOptions(value: unknown): AbortSignal | undefined {
	const raw = allowedRecord(value, [], SIGNAL_FIELDS, 'Soundscaper desktop read options');
	return raw.signal === undefined ? undefined : abortSignal(raw.signal);
}

export function abortSignal(value: unknown): AbortSignal {
	if (!(value instanceof AbortSignal)) throw new TypeError('A Soundscaper desktop AbortSignal is required.');
	return value;
}

export function allowedRecord<const Required extends string, const Optional extends string>(
	value: unknown,
	required: readonly Required[],
	optional: readonly Optional[],
	name: string,
): Record<Required | Optional, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const allowed = new Set<string>([...required, ...optional]);
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) {
		throw new TypeError(`${name} has unsupported fields.`);
	}
	const result = Object.create(null) as Record<Required | Optional, unknown>;
	for (const field of required) result[field] = ownData(value, field, name);
	for (const field of optional) if (Object.hasOwn(value, field)) result[field] = ownData(value, field, name);
	return result;
}

export function ownData(value: object, field: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${field} must be an own data property.`);
	}
	return descriptor.value;
}

export function inheritedData(value: object, field: string): unknown {
	let candidate: object | null = value;
	while (candidate) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
		if (descriptor) return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
		candidate = Object.getPrototypeOf(candidate) as object | null;
	}
	return undefined;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Clone opaque Audacity XML into the JSON-safe editor persistence domain. */
export function cloneAup4OpaqueProjectValue(value: unknown): unknown {
	if (typeof value === 'bigint') return value.toString(10);
	if (value instanceof Uint8Array) return value.slice();
	if (value instanceof ArrayBuffer) return value.slice(0);
	if (Array.isArray(value)) return value.map(cloneAup4OpaqueProjectValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(
			([key, entry]) => [key, cloneAup4OpaqueProjectValue(entry)],
		));
	}
	return value;
}

/** Rehydrate one persistence-safe long-long attribute for exact binary export. */
export function rehydrateAup4OpaqueInt64Attribute(
	value: unknown,
): Readonly<Record<string, unknown>> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const entry = value as Readonly<Record<string, unknown>>;
	if (entry.kind !== 'attribute' || entry.type !== 'long-long'
		|| typeof entry.value !== 'string' || !/^-?(?:0|[1-9]\d{0,18})$/u.test(entry.value)) return null;
	const integer = BigInt(entry.value);
	if (integer.toString(10) !== entry.value
		|| integer < -9_223_372_036_854_775_808n || integer > 9_223_372_036_854_775_807n) return null;
	return { ...entry, value: integer };
}

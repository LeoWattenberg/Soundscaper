/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lossless filesystem identity at the JavaScript/native child boundary. */

const CANONICAL_UNSIGNED = /^(?:0|[1-9]\d{0,19})$/u;
const MAXIMUM_UINT64 = (1n << 64n) - 1n;

export type NativeChildFileIdentityValue = number | string;

export interface NativeChildFileIdentity {
	readonly dev: NativeChildFileIdentityValue;
	readonly ino: NativeChildFileIdentityValue;
}

export interface CanonicalNativeChildFileIdentity {
	readonly dev: string;
	readonly ino: string;
}

export function canonicalNativeChildFileIdentity(value: unknown): CanonicalNativeChildFileIdentity {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['dev', 'ino'])) {
		throw new TypeError('A native isolation file identity is invalid.');
	}
	const record = value as Record<string, unknown>;
	return Object.freeze({
		dev: component(record.dev, 'device'),
		ino: component(record.ino, 'inode'),
	});
}

export function nativeChildFileIdentityFromStat(
	value: Readonly<{ readonly dev: bigint; readonly ino: bigint }>,
): CanonicalNativeChildFileIdentity {
	return Object.freeze({
		dev: BigInt.asUintN(64, value.dev).toString(10),
		ino: BigInt.asUintN(64, value.ino).toString(10),
	});
}

function component(value: unknown, label: string): string {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
	if (typeof value === 'string' && CANONICAL_UNSIGNED.test(value) && BigInt(value) <= MAXIMUM_UINT64) return value;
	throw new TypeError(`A native isolation file ${label} is invalid.`);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Canonical text grammar shared by durable capture-spool identities and metadata. */
export function captureSpoolStableText(
	value: unknown,
	name: string,
	maximumLength: number,
): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > maximumLength
		|| hasControlCharacter(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

export function captureSpoolStableId(value: unknown, name: string): string {
	return captureSpoolStableText(value, name, 256);
}

/** Deliberately loose record admission for existing raw and encoded spool repositories. */
export function captureSpoolDataRecord(
	value: unknown,
	name: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a data record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

export function captureSpoolExactSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

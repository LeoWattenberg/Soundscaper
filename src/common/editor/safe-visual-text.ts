/* SPDX-License-Identifier: AGPL-3.0-only */

const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

/** Shared visual labels retain their existing canonical NFC admission. */
export function readCanonicalSafeVisualText(value: unknown, name: string, maximum: number, multiline: boolean): string {
	return readSafeVisualText(value, name, maximum, multiline, true);
}

/** Original identities retain exact text, using the same length and control rules. */
export function readExactSafeVisualText(value: unknown, name: string, maximum: number, multiline: boolean): string {
	return readSafeVisualText(value, name, maximum, multiline, false);
}

function readSafeVisualText(value: unknown, name: string, maximum: number, multiline: boolean, canonical: boolean): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum
		|| (canonical && value.normalize('NFC') !== value) || UNSAFE_TEXT.test(value)
		|| (!multiline && /[\r\n]/u.test(value)) || /\r/u.test(value)) {
		throw new TypeError(`${name} must be ${canonical ? 'canonical' : 'bounded'} safe text without unsupported control characters.`);
	}
	return value;
}

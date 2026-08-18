/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The value guards the ADM metadata normalizers share.
 *
 * Pulled out when authored objects needed the same checks as authored beds:
 * two copies of "what counts as a bounded non-empty name" is how two ADM
 * documents end up disagreeing about which one is valid.
 */

export const MAX_ADM_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_ADM_NAME_BYTES = 512;
const BASE64_PATTERN = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u;

export function objectValue(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

export function text(value: unknown, name: string, maximumBytes: number, allowXmlWhitespace = false): string {
	if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
	const controls = allowXmlWhitespace
		? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u
		: /[\u0000-\u001f\u007f]/u;
	if (controls.test(value)) throw new RangeError(`${name} cannot contain control characters.`);
	if (new TextEncoder().encode(value).byteLength > maximumBytes) throw new RangeError(`${name} is too large.`);
	return value;
}

export function nonEmptyText(value: unknown, name: string, maximumBytes: number): string {
	const normalized = text(value, name, maximumBytes).trim();
	if (!normalized) throw new TypeError(`${name} must be a non-empty string.`);
	return normalized;
}

export function safeInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be a safe integer between ${minimum} and ${maximum}.`);
	}
	return number;
}

export function finiteNumber(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}

export function enumValue<const Value extends string | number>(value: unknown, allowed: readonly Value[], name: string): Value {
	if (!allowed.includes(value as Value)) throw new RangeError(`${name} is unsupported: ${String(value)}.`);
	return value as Value;
}

export function booleanValue(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
	return value;
}

export function base64(value: unknown, name: string): string {
	if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
	if (!BASE64_PATTERN.test(value)) throw new RangeError(`${name} must use canonical base64.`);
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	const byteLength = value.length / 4 * 3 - padding;
	if (byteLength > MAX_ADM_PAYLOAD_BYTES) throw new RangeError(`${name} exceeds 16 MiB.`);
	return value;
}

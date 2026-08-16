/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The one canonical serialization and fingerprint rule for every export plan a
 * milestone-5B native media consumer may execute. The native tier accelerates
 * the canonical plan; it never reinterprets it, so both the Web consumer and
 * the native consumer must be able to derive the same fingerprint from the same
 * plan without sharing an in-process object identity.
 *
 * The form is deliberately narrow: finite numbers, strings, booleans, null,
 * arrays, and plain records. Accessors, symbols, prototypes, cycles, holes, and
 * non-finite numbers are rejected before any value is read a second time, so a
 * hostile plan cannot execute code or grow without bound during fingerprinting.
 *
 * Record keys are emitted in their authored order rather than sorted. Each
 * canonical plan version already defines its own exact field order — V7's
 * admission refuses a re-ordered document outright — so a document with
 * shuffled keys is a different, non-canonical document, and giving it the same
 * fingerprint would launder it into acceptance.
 */

import { sha256 } from '@noble/hashes/sha2.js';

import { PLATFORM_TRANSFER_HARD_LIMITS } from './platform/bounded-transfer.ts';

/** A canonical plan never exceeds the owned media-chunk transfer ceiling. */
export const NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_BYTES = PLATFORM_TRANSFER_HARD_LIMITS.mediaChunkBytes;

/** Composition nests intervals, layers, clips, and operations; 64 bounds that. */
export const NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_DEPTH = 64;

export type NativeMediaPlanViolationCode =
	| 'malformed'
	| 'oversized'
	| 'unsupported-version';

export class NativeMediaPlanViolationError extends Error {
	readonly code: NativeMediaPlanViolationCode;

	constructor(code: NativeMediaPlanViolationCode, message: string) {
		super(message);
		this.name = 'NativeMediaPlanViolationError';
		this.code = code;
	}
}

export interface NativeMediaPlanFingerprint {
	readonly canonical: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export function nativeMediaPlanViolation(
	code: NativeMediaPlanViolationCode,
	message: string,
): never {
	throw new NativeMediaPlanViolationError(code, message);
}

/**
 * Serialize one plan into its canonical form. The result is byte-stable across
 * processes and engines: records and arrays keep their authored order and no
 * insignificant whitespace is emitted.
 */
export function canonicalizeNativeMediaPlan(value: unknown): string {
	const parts: string[] = [];
	let length = 0;
	const append = (text: string): void => {
		length += text.length;
		// UTF-8 byte length is never smaller than UTF-16 code-unit length, so
		// this refuses an oversized plan before the whole string is materialized.
		if (length > NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_BYTES) {
			nativeMediaPlanViolation('oversized', 'A canonical native media plan exceeds its transfer ceiling.');
		}
		parts.push(text);
	};
	writeCanonicalValue(value, append, 0, new Set<object>());
	return parts.join('');
}

/** Canonicalize, bound, and digest one plan in a single pass. */
export function fingerprintNativeMediaPlan(value: unknown): NativeMediaPlanFingerprint {
	const canonical = canonicalizeNativeMediaPlan(value);
	const bytes = new TextEncoder().encode(canonical);
	if (bytes.byteLength > NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_BYTES) {
		nativeMediaPlanViolation('oversized', 'A canonical native media plan exceeds its transfer ceiling.');
	}
	return Object.freeze({
		canonical,
		byteLength: bytes.byteLength,
		sha256: hex(sha256(bytes)),
	});
}

function writeCanonicalValue(
	value: unknown,
	append: (text: string) => void,
	depth: number,
	ancestors: Set<object>,
): void {
	if (depth > NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_DEPTH) {
		nativeMediaPlanViolation('malformed', 'A native media plan nests deeper than the canonical form allows.');
	}
	if (value === null) return append('null');
	if (typeof value === 'boolean') return append(value ? 'true' : 'false');
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			nativeMediaPlanViolation('malformed', 'A native media plan must carry only finite numbers.');
		}
		return append(Object.is(value, -0) ? '0' : JSON.stringify(value));
	}
	if (typeof value === 'string') return append(JSON.stringify(value));
	if (typeof value !== 'object') {
		nativeMediaPlanViolation('malformed', 'A native media plan must carry only canonical JSON values.');
	}
	const container = value as object;
	if (ancestors.has(container)) {
		nativeMediaPlanViolation('malformed', 'A native media plan must not contain circular references.');
	}
	if (Object.getOwnPropertySymbols(container).length > 0) {
		nativeMediaPlanViolation('malformed', 'A native media plan must not carry symbol-keyed properties.');
	}
	ancestors.add(container);
	if (Array.isArray(container)) {
		writeCanonicalArray(container, append, depth, ancestors);
	} else {
		writeCanonicalRecord(container, append, depth, ancestors);
	}
	ancestors.delete(container);
}

function writeCanonicalArray(
	value: readonly unknown[],
	append: (text: string) => void,
	depth: number,
	ancestors: Set<object>,
): void {
	append('[');
	for (let index = 0; index < value.length; index += 1) {
		if (index > 0) append(',');
		if (!Object.hasOwn(value, index)) {
			nativeMediaPlanViolation('malformed', 'A native media plan must not contain sparse arrays.');
		}
		writeCanonicalValue(dataValue(value, String(index)), append, depth + 1, ancestors);
	}
	append(']');
}

function writeCanonicalRecord(
	value: object,
	append: (text: string) => void,
	depth: number,
	ancestors: Set<object>,
): void {
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		nativeMediaPlanViolation('malformed', 'A native media plan must carry only plain records.');
	}
	const keys = Object.keys(value);
	if (Object.getOwnPropertyNames(value).length !== keys.length) {
		nativeMediaPlanViolation('malformed', 'A native media plan must carry only enumerable own properties.');
	}
	append('{');
	for (let index = 0; index < keys.length; index += 1) {
		const key = keys[index]!;
		if (index > 0) append(',');
		append(JSON.stringify(key));
		append(':');
		writeCanonicalValue(dataValue(value, key), append, depth + 1, ancestors);
	}
	append('}');
}

/** Read one own data property without ever invoking a hostile accessor. */
function dataValue(container: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(container, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		nativeMediaPlanViolation('malformed', 'A native media plan must carry only own data properties.');
	}
	if (descriptor.value === undefined) {
		nativeMediaPlanViolation('malformed', 'A native media plan must not carry undefined values.');
	}
	return descriptor.value;
}

function hex(bytes: Uint8Array): string {
	let text = '';
	for (const byte of bytes) text += byte.toString(16).padStart(2, '0');
	return text;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Digest primitives for the local-model catalog and its licensing evidence. */

import { createHash } from 'node:crypto';

type JsonRecord = Record<string, unknown>;

function plainRecord(value: unknown): value is JsonRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}

/**
 * Deterministic JSON serialization used for evidence and release-review SHA-256
 * pins. Object keys use UTF-16 lexical ordering; arrays retain order and
 * non-JSON values are refused rather than coerced.
 */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain a non-finite number.');
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
	if (!plainRecord(value)) throw new TypeError('Canonical JSON accepts plain JSON values only.');
	return `{${Object.keys(value).sort().map((key) => {
		const member = value[key];
		if (member === undefined) throw new TypeError('Canonical JSON cannot contain undefined.');
		return `${JSON.stringify(key)}:${canonicalJson(member)}`;
	}).join(',')}}`;
}

/** Pins the complete licensing row, not only the model id or current status. */
export function localModelEvidenceSha256(value: unknown): string {
	return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/* SPDX-License-Identifier: AGPL-3.0-only */

// Canonical JSON encoding, digests and the failure shape the Audacity Qt
// translation tooling shares. A translation pack's bytes are compared across
// hosts and reruns, so the encoding is deterministic: records are ordered by
// code unit and every value is frozen once written. Split out of
// audacity-qt-translations.mjs; no behaviour changes here.

import { createHash } from 'node:crypto';

import { compareCodeUnits } from './canonical-json.mjs';
import { TranslationArtifactError } from './verified-zip.mjs';

export function encodeCanonicalJson(value) {
	return Buffer.from(`${JSON.stringify(sortJsonValue(value))}\n`, 'utf8');
}


export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function sortRecord(record) {
	return Object.fromEntries(Object.entries(record).sort(([left], [right]) => compareCodeUnits(left, right)));
}

export function sortJsonValue(value) {
	if (Array.isArray(value)) return value.map(sortJsonValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value)
			.sort(([left], [right]) => compareCodeUnits(left, right))
			.map(([key, child]) => [key, sortJsonValue(child)]));
	}
	if (typeof value === 'number' && !Number.isFinite(value)) fail('JSON_NUMBER', 'Canonical JSON cannot contain non-finite numbers.');
	return value;
}

export function isFlatStringRecord(value) {
	return value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((item) => typeof item === 'string');
}

export function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

export function fail(code, message) { throw new TranslationArtifactError(code, message); }

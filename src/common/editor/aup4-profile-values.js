/* SPDX-License-Identifier: AGPL-3.0-only */

// The Audacity 4 database and document profile constants, the error the AUP4
// surfaces raise, and the scalar guards every AUP4 value is validated through.
// Split out of aup4-profile.js so the profile itself shows the document it
// builds rather than the arithmetic it builds it from; no behaviour changes.

export const AUP4_APPLICATION_ID = 0x41554459;
export const AUP4_USER_VERSION = 0x04000001;
export const AUP4_BINARY_XML_VERSION = '2.0.0';
export const AUP4_AUDACITY_VERSION = '4.0.0';
export const AUP4_SAMPLE_FORMAT_FLOAT32 = 0x0004000f;
export const AUP4_MAX_BLOCK_SAMPLES = 262_144;
export const AUP4_HISTORY_DEPTH = 10;
export const AUP4_UPSTREAM_COMMIT = '4c177d436e48c1d20f231eada44035593cb26292';

export class Aup4Error extends Error {
	constructor(message, code = 'AUP4_ERROR', options) {
		super(message, options);
		this.name = 'Aup4Error';
		this.code = code;
	}
}

export function cloneCompatibilityValue(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

export function colorIndex(value, fallback) {
	const number = Number(value);
	if (Number.isSafeInteger(number) && number >= 0 && number <= 3) return number;
	const colors = new Map([
		['#66a3ff', 0], ['#9996fc', 1], ['#b5b5b5', 2], ['#ffad51', 3],
	]);
	return colors.get(String(value || '').toLowerCase()) ?? fallback;
}

export function compareVersion(left, right) {
	const a = String(left).split('.').map(Number);
	const b = String(right).split('.').map(Number);
	for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
		const difference = (a[index] || 0) - (b[index] || 0);
		if (difference) return difference;
	}
	return 0;
}

export function positiveRate(value) {
	const rate = Number(value);
	if (!Number.isFinite(rate) || rate < 1 || rate > 768_000) throw new Aup4Error('Audacity sample rate is invalid.', 'INVALID_SAMPLE_RATE');
	return Math.round(rate);
}

export function finite(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
export function finiteInRange(value, minimum, maximum, fallback) { const number = Number(value); return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback; }
export function optionalFiniteInRange(value, minimum, maximum) { const number = Number(value); return value != null && value !== '' && Number.isFinite(number) && number >= minimum && number <= maximum ? number : null; }
export function integerInRange(value, minimum, maximum, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback; }
export function nonNegativeInteger(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : fallback; }
export function displayType(value) { return value === 'spectrogram' ? 1 : value === 'multiview' ? 2 : 0; }
export function inverseRatio(value) { const ratio = Number(value); return Number.isFinite(ratio) && ratio > 0 ? 1 / ratio : 1; }

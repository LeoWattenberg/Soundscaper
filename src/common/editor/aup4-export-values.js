/* SPDX-License-Identifier: AGPL-3.0-only */

// Scalar guards, frame arithmetic and the error shape the AUP4 exporter
// validates every snapshot value through. Split out of aup4-export.js to keep
// that module under its maintainability ratchet; no behaviour changes here.

export function scaleBoundary(frame, ratio) {
	return Math.max(0, Math.round(frame * ratio));
}

export function scaledRangeLength(startFrame, endFrame, ratio) {
	return Math.max(0, scaleBoundary(endFrame, ratio) - scaleBoundary(startFrame, ratio));
}

export function positiveRate(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0 || number > 768_000) throw exportError(`${name} is invalid.`, 'INVALID_SAMPLE_RATE');
	return Math.round(number);
}

export function positiveChannelCount(value) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0 || number > 64) throw exportError('AUP4 source channelCount is invalid.', 'INVALID_SOURCE_AUDIO');
	return number;
}

export function finiteNonNegative(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function boundedFrame(value, maximum) {
	const number = Number(value);
	return Number.isSafeInteger(number) ? Math.max(0, Math.min(maximum, number)) : 0;
}

export function nonNegativeFrame(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw exportError(`${name} is invalid.`, 'INVALID_SNAPSHOT');
	return number;
}

export function positiveFrame(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw exportError(`${name} is invalid.`, 'INVALID_SNAPSHOT');
	return number;
}

export function clone(value) {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

export function exportError(message, code) {
	const error = new Error(message);
	error.name = 'Aup4ExportError';
	error.code = code;
	return error;
}

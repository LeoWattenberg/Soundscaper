/* SPDX-License-Identifier: AGPL-3.0-only */

// Scalar guards and native-value mappings every AUP4 import reads through. An
// Audacity document may carry any value at all, so each one is either coerced
// into the browser model's range or refused by name here rather than reaching
// the project. Split out of aup4-conversion.js; no behaviour changes here.

import { audacityXmlAttributes } from './audacity-binary-xml.js';

export function nativeSpectrogramScale(value) { return ['linear', 'log', 'mel', 'bark', 'erb', 'period'][value] || 'mel'; }
export function nativeSpectrogramWindow(value) { return ({ 2: 'hamming', 3: 'hann', 4: 'blackman' })[value] || 'hann'; }
export function audacitySpectrogramGain(node) { const gains = audacityXmlAttributes(node, 'gain'); return gains.length > 1 || gains[0]?.type === 'int' ? gains[0]?.value : undefined; }
export function trackColor(value) { return ['#66a3ff', '#9996fc', '#b5b5b5', '#ffad51'][Number(value)] || '#66a3ff'; }
export function booleanValue(value, fallback) {
	if (value === true || value === 1) return true;
	if (value === false || value === 0) return false;
	const text = String(value).trim().toLowerCase();
	if (text === '1' || text === 'true') return true;
	if (text === '0' || text === 'false') return false;
	return fallback;
}
export function lastAttribute(node, name, fallback) { return audacityXmlAttributes(node, name).at(-1)?.value ?? fallback; }
export function sampleFormatName(value) { return Number(value) === 0x00020001 ? 'int16' : Number(value) === 0x00040001 ? 'int24' : Number(value) === 0x0004000f ? 'float32' : 'unknown'; }
export function displayMode(value) { return Number(value) === 1 ? 'spectrogram' : Number(value) === 2 ? 'multiview' : 'waveform'; }
export function warn(state, message) { if (!state.warnings.includes(message)) state.warnings.push(message); }
export function finite(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
export function positive(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback; }
export function optionalPositive(value) { const number = Number(value); return value != null && value !== '' && Number.isFinite(number) && number > 0 ? number : null; }
export function nonNegative(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
export function finiteInRange(value, minimum, maximum, fallback) { const number = Number(value); return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback; }
export function integerInRange(value, minimum, maximum, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback; }
export function nonNegativeInteger(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : fallback; }
export function positiveInteger(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : fallback; }
export function positiveRate(value) { const rate = Number(value); if (!Number.isFinite(rate) || rate < 1 || rate > 768_000) throw conversionError('The AUP4 project contains an invalid sample rate.', 'INVALID_SAMPLE_RATE'); return Math.round(rate); }
export function powerOfTwo(value, fallback) {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 && Number.isInteger(Math.log2(number)) ? number : fallback;
}
export function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
export function conversionError(message, code) { const error = new Error(message); error.name = 'Aup4ConversionError'; error.code = code; return error; }

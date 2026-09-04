/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity's CommandParameters representation: key normalization, value
 * encodings and the parameter-descriptor plumbing shared by AUP4 realtime
 * effect state and by text macros. Ported from Audacity 3.7.7 commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b,
 * libraries/lib-components/EffectAutomationParameters.h. Audacity is
 * distributed under GPL version 3; this JavaScript adaptation was created for
 * kw.media in 2026.
 */

/**
 * Audacity's CommandParameters::NormalizeName, applied to every key on both
 * read and write. A parameter whose declared name contains a space, slash,
 * backslash, colon or equals sign therefore travels with underscores.
 */
export function normalizeCommandParameterName(name) {
	return String(name).replace(/[ /\\:=]/g, '_');
}

export function stableNumberString(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new RangeError('Audacity effect parameters must be finite.');
	return Object.is(number, -0) ? '0' : String(number);
}

export function finiteNumber(value) {
	const text = String(value).trim();
	if (!text || text.length > 128) return undefined;
	const number = Number(text);
	return Number.isFinite(number) ? number : undefined;
}

export function booleanString(value) {
	return value ? '1' : '0';
}

export function booleanValue(value) {
	if (value === true || value === 1) return true;
	if (value === false || value === 0) return false;
	const text = String(value).trim().toLowerCase();
	if (text === '1' || text === 'true') return true;
	if (text === '0' || text === 'false') return false;
	return undefined;
}

export function boundedIndex(value, length) {
	const text = String(value).trim();
	if (!text || text.length > 32) return undefined;
	const number = Number(text);
	return Number.isInteger(number) && number >= 0 && number < length ? number : undefined;
}

/**
 * Round a value derived from a unit conversion so that decoding an encoded
 * parameter is a fixed point. Audacity stores Amplify as a linear ratio and
 * Change Pitch as a percentage, so the browser's decibel and semitone models
 * only survive a round trip once the float noise below this precision is gone.
 */
export function roundedParameter(value) {
	if (!Number.isFinite(value)) return undefined;
	return Number(value.toFixed(10));
}

export const numberParam = (model, native = model) => ({ model, native, kind: 'number', decode: finiteNumber });
export const booleanParam = (model, native = model) => ({ model, native, kind: 'boolean', encode: booleanString, decode: booleanValue });
export const enumParam = (model, native, values, nativeValues) => ({
	model,
	native,
	kind: 'enum',
	encode: (value) => {
		const index = values.indexOf(value);
		if (index < 0) throw new RangeError(`Unsupported ${native} value: ${value}.`);
		return nativeValues[index];
	},
	decode: (value) => {
		const text = String(value);
		let index = nativeValues.indexOf(text);
		// Browser builds before the pinned-id audit wrote enum indexes, and
		// Audacity's own ObsoleteMap remaps the indexes its older releases
		// wrote. Continue reading those, but always emit the symbolic names.
		if (index < 0) index = boundedIndex(text, values.length);
		return index === undefined ? undefined : values[index];
	},
});
/** A parameter Audacity writes but the browser has no model value for. */
export const constantParam = (native, constant) => ({ native, constant });

export function parameterEntries(value) {
	if (value instanceof Map) return new Map(value);
	if (Array.isArray(value)) return new Map(value);
	if (value && typeof value === 'object') return new Map(Object.entries(value));
	throw new TypeError('Audacity effect parameters must be a map, object, or entry list.');
}

/** Encode browser parameters as ordered Audacity CommandParameters entries. */
export function encodeCommandParameters(profile, params = {}) {
	const output = [];
	for (const descriptor of profile.params) {
		const raw = descriptor.constant ?? params[descriptor.model];
		if (raw === undefined) continue;
		output.push([
			descriptor.native,
			descriptor.encode ? descriptor.encode(raw) : stableNumberString(raw),
		]);
	}
	return output;
}

/**
 * Decode Audacity CommandParameters into browser parameters. Descriptors are
 * visited in Audacity's own declaration order, so when two names describe the
 * same setting the later one wins, matching which of them Audacity's own
 * processing reads.
 */
export function decodeCommandParameters(profile, parameters) {
	const nativeParams = parameterEntries(parameters);
	const params = {};
	for (const descriptor of profile.params) {
		if (!descriptor.model || !nativeParams.has(descriptor.native)) continue;
		const value = descriptor.decode
			? descriptor.decode(nativeParams.get(descriptor.native))
			: nativeParams.get(descriptor.native);
		if (value === undefined) {
			throw new RangeError(`Invalid Audacity effect parameter: ${descriptor.native}.`);
		}
		params[descriptor.model] = value;
	}
	return params;
}

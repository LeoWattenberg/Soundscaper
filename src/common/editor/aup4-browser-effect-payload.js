/* SPDX-License-Identifier: AGPL-3.0-only */

// How a browser rack effect Audacity has no plug-in for survives a round trip
// through an AUP4 project. The effect is written as a native effect node whose
// id carries a base64 payload of its portable parameters, so Audacity keeps it
// as an unrecognised plug-in and Soundscaper reads it back exactly; a payload
// that is malformed, oversized or not portable JSON is refused and the effect
// becomes an explicit missing entry instead. Split out of aup4-effects.js; no
// behaviour changes here.

import { createAudacityXmlNode } from './audacity-binary-xml.js';
import { audioEffectLabel, createEffect, createMissingEffect, normalizeEffect } from './effects.js';
import {
	booleanAttribute,
	cloneEntry,
	cloneNode,
	isPlainObject,
	mergeAttributes,
} from './aup4-effect-xml-values.js';

export const BROWSER_EFFECT_FAMILY = 'kw.media';
export const BROWSER_EFFECT_VENDOR = 'kw.media';
export const BROWSER_EFFECT_PATH_PREFIX = 'kw.media Browser Effect: ';
export const LEGACY_BROWSER_EFFECT_NAME = 'Browser Rack';
export const BROWSER_EFFECT_SCHEMA_VERSION = 1;
const MAX_BROWSER_EFFECT_ID_BYTES = 64 * 1024;
const MAX_BROWSER_EFFECT_JSON_DEPTH = 32;
const MAX_BROWSER_EFFECT_JSON_NODES = 4_096;
const MAX_BROWSER_EFFECT_ID_CODE_UNITS = 1_024;
const UTF8 = new TextEncoder();
export const MAX_BROWSER_EFFECT_PAYLOAD_BYTES = Math.floor(
	(MAX_BROWSER_EFFECT_ID_BYTES - 2_048) / 4 * 3,
);

export function createBrowserEffectNode(effect, opaqueNode = null, rackIndex = 0) {
	// Validate and normalize before embedding the portable browser extension.
	// Audacity preserves an unavailable realtime effect's ID even though it
	// cannot instantiate it; keeping the complete bounded payload in that ID
	// therefore survives a native open/save cycle without pretending the
	// browser processor is an Audacity plug-in.
	if (effect?.context !== undefined) assertPortableJson(effect.context, 'effect.context');
	if (effect?.state !== undefined) assertPortableJson(effect.state, 'effect.state');
	const missingId = effect?.id === undefined || effect?.id === null || effect?.id === '';
	const id = missingId ? legacyBrowserEffectId(effect, rackIndex) : effect.id;
	assertStableEffectId(id);
	const type = String(effect?.type || '').trim();
	if (!type || type.length > 1_024 || !isPlainObject(effect?.params)) {
		throw new TypeError('A browser effect needs a bounded type and parameter object.');
	}
	assertPortableJson(effect.params, 'effect.params');
	let normalized = {
		...effect,
		id,
		type,
		enabled: effect?.enabled !== false,
		params: effect.params,
	};
	try {
		const executable = normalizeEffect(normalized);
		normalized = {
			...executable,
			params: effect.params,
			...(effect.context === undefined ? {} : { context: effect.context }),
			...(effect.state === undefined ? {} : { state: effect.state }),
		};
	} catch {
		// A future bounded Soundscaper type is still a valid interchange
		// placeholder even when this build cannot execute it.
	}
	let canonicalName;
	try { canonicalName = audioEffectLabel(type, 'en'); }
	catch { canonicalName = type; }
	const payload = {
		schemaVersion: BROWSER_EFFECT_SCHEMA_VERSION,
		id,
		type,
		name: canonicalName,
		params: effect.params,
		...(normalized.context === undefined ? {} : { context: normalized.context }),
		...(normalized.state === undefined ? {} : { state: normalized.state }),
	};
	assertPortableJson(payload, 'browser effect payload');
	const payloadBytes = UTF8.encode(JSON.stringify(payload));
	if (payloadBytes.byteLength > MAX_BROWSER_EFFECT_PAYLOAD_BYTES) {
		throw new RangeError('The browser effect state is too large for a portable AUP4 extension.');
	}
	const encoded = encodeBase64(payloadBytes);
	const nativeId = browserNativeEffectId(canonicalName, encoded);
	if (UTF8.encode(nativeId).byteLength > MAX_BROWSER_EFFECT_ID_BYTES) {
		throw new RangeError('The browser effect state is too large for a portable AUP4 extension.');
	}
	const generated = [
		{ kind: 'attribute', name: 'active', type: 'bool', value: normalized.enabled !== false },
		{ kind: 'attribute', name: 'id', type: 'string', value: nativeId },
	];
	const content = (opaqueNode?.content || [])
		.filter((entry) => entry.kind !== 'attribute')
		.map(cloneEntry);
	return createAudacityXmlNode('effect', mergeAttributes(generated, opaqueNode?.content), content);
}

export function readBrowserEffect(nativeId, parsedId, effectNode, idFactory) {
	if (parsedId.family !== BROWSER_EFFECT_FAMILY
		|| parsedId.vendor !== BROWSER_EFFECT_VENDOR
		|| !parsedId.path.startsWith(BROWSER_EFFECT_PATH_PREFIX)) return undefined;
	try {
		if (UTF8.encode(nativeId).byteLength > MAX_BROWSER_EFFECT_ID_BYTES) return null;
		const encoded = parsedId.path.slice(BROWSER_EFFECT_PATH_PREFIX.length);
		if (!encoded || encoded.length > Math.ceil(MAX_BROWSER_EFFECT_PAYLOAD_BYTES / 3) * 4) return null;
		const decoded = decodeBase64(encoded);
		if (decoded.byteLength > MAX_BROWSER_EFFECT_PAYLOAD_BYTES) return null;
		const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
		if (payload?.schemaVersion !== BROWSER_EFFECT_SCHEMA_VERSION) return null;
		if (!isPlainObject(payload) || !isPlainObject(payload.params)) return null;
		if (typeof payload.type !== 'string' || !payload.type || payload.type.length > 1_024) return null;
		if (payload.name !== undefined
			&& (typeof payload.name !== 'string' || !payload.name || payload.name.length > 1_024)) return null;
		assertStableEffectId(payload.id);
		assertPortableJson(payload, 'browser effect payload');
		try {
			const normalized = createEffect(payload.type, {
				id: payload.id,
				enabled: booleanAttribute(effectNode, 'active', true),
				params: payload.params,
				...(Object.hasOwn(payload, 'context') ? { context: payload.context } : {}),
				...(Object.hasOwn(payload, 'state') ? { state: payload.state } : {}),
			});
			return {
				...normalized,
				params: clonePortableValue(payload.params),
				...(Object.hasOwn(payload, 'context') ? { context: clonePortableValue(payload.context) } : {}),
				...(Object.hasOwn(payload, 'state') ? { state: clonePortableValue(payload.state) } : {}),
				opaqueAudacityNode: { kind: 'node', node: cloneNode(effectNode) },
			};
		} catch {
			return missingEffect(effectNode, idFactory, {
				id: payload.id,
				name: payload.name || (parsedId.name === LEGACY_BROWSER_EFFECT_NAME ? payload.type : parsedId.name),
				nativeId,
				reason: supportedBrowserEffectType(payload.type) ? 'unsupported-state' : 'unsupported-browser-effect',
			});
		}
	} catch {
		return null;
	}
}

export function missingEffect(effectNode, idFactory, metadata) {
	try {
		const id = metadata.id || idFactory('effect');
		if (typeof id !== 'string' || !id) return null;
		return createMissingEffect({
			id,
			enabled: booleanAttribute(effectNode, 'active', true),
			missing: {
				name: metadata.name,
				nativeId: metadata.nativeId,
				reason: metadata.reason,
				source: 'aup4',
			},
			opaqueAudacityNode: { kind: 'node', node: cloneNode(effectNode) },
		});
	} catch {
		return null;
	}
}

export function supportedBrowserEffectType(type) {
	try {
		audioEffectLabel(type, 'en');
		return true;
	} catch {
		return false;
	}
}

export function browserNativeEffectId(name, encodedPayload) {
	if (typeof name !== 'string' || !name || name.length > 1_024) {
		throw new TypeError('A browser effect needs a bounded canonical name.');
	}
	return `Effect_${BROWSER_EFFECT_FAMILY}_${BROWSER_EFFECT_VENDOR}_${escapeEffectIdField(name)}_${BROWSER_EFFECT_PATH_PREFIX}${encodedPayload}`;
}

export function parseNativeEffectId(nativeId) {
	if (typeof nativeId !== 'string' || !nativeId.startsWith('Effect_')
		|| UTF8.encode(nativeId).byteLength > MAX_BROWSER_EFFECT_ID_BYTES) return null;
	const fields = [];
	let field = '';
	let escaped = false;
	for (const character of nativeId.slice('Effect_'.length)) {
		if (fields.length >= 3) {
			field += character;
			continue;
		}
		if (escaped) {
			field += character;
			escaped = false;
		} else if (character === '\\') {
			escaped = true;
		} else if (character === '_') {
			fields.push(field);
			field = '';
		} else {
			field += character;
		}
	}
	if (escaped || fields.length !== 3) return null;
	fields.push(field);
	if (fields.some((value) => !value)
		|| fields.slice(0, 3).some((value) => value.length > MAX_BROWSER_EFFECT_ID_CODE_UNITS)) return null;
	return {
		family: fields[0],
		vendor: fields[1],
		name: fields[2],
		path: fields[3],
	};
}

export function escapeEffectIdField(value) {
	return value.replaceAll('\\', '\\\\').replaceAll('_', '\\_');
}

function legacyBrowserEffectId(effect, rackIndex) {
	const identity = {
		type: effect?.type,
		params: effect?.params,
		...(effect?.context === undefined ? {} : { context: effect.context }),
		...(effect?.state === undefined ? {} : { state: effect.state }),
	};
	assertPortableJson(identity, 'legacy browser effect');
	const source = canonicalJson(identity);
	let hash = 0x811c9dc5;
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	const type = String(effect?.type || 'effect').replace(/[^a-z0-9-]+/gi, '-').slice(0, 48) || 'effect';
	return `legacy-${type}-${Math.max(0, Number(rackIndex) || 0)}-${hash.toString(16).padStart(8, '0')}`;
}

function canonicalJson(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function assertStableEffectId(value) {
	if (typeof value !== 'string' || !value || value.length > MAX_BROWSER_EFFECT_ID_CODE_UNITS) {
		throw new TypeError('A portable browser effect needs a bounded stable string ID.');
	}
}

function assertPortableJson(value, name) {
	const stack = [{ value, depth: 0 }];
	let nodes = 0;
	let codeUnits = 0;
	while (stack.length) {
		const current = stack.pop();
		nodes += 1;
		if (nodes > MAX_BROWSER_EFFECT_JSON_NODES || current.depth > MAX_BROWSER_EFFECT_JSON_DEPTH) {
			throw new RangeError(`${name} exceeds the portable AUP4 complexity limit.`);
		}
		const item = current.value;
		if (item === null || typeof item === 'boolean') continue;
		if (typeof item === 'number') {
			if (!Number.isFinite(item)) throw new RangeError(`${name} numbers must be finite.`);
			continue;
		}
		if (typeof item === 'string') {
			codeUnits += item.length;
			if (codeUnits > MAX_BROWSER_EFFECT_PAYLOAD_BYTES) {
				throw new RangeError(`${name} exceeds the portable AUP4 size limit.`);
			}
			continue;
		}
		if (!Array.isArray(item) && !isPlainObject(item)) {
			throw new TypeError(`${name} must contain only JSON-safe values.`);
		}
		for (const [key, child] of Object.entries(item)) {
			codeUnits += key.length;
			if (codeUnits > MAX_BROWSER_EFFECT_PAYLOAD_BYTES) {
				throw new RangeError(`${name} exceeds the portable AUP4 size limit.`);
			}
			stack.push({ value: child, depth: current.depth + 1 });
		}
	}
}

function clonePortableValue(value) {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function encodeBase64(bytes) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	let output = '';
	for (let index = 0; index < bytes.length; index += 3) {
		const first = bytes[index];
		const second = bytes[index + 1];
		const third = bytes[index + 2];
		const value = (first << 16) | ((second || 0) << 8) | (third || 0);
		output += alphabet[(value >>> 18) & 63];
		output += alphabet[(value >>> 12) & 63];
		output += second === undefined ? '=' : alphabet[(value >>> 6) & 63];
		output += third === undefined ? '=' : alphabet[value & 63];
	}
	return output;
}

function decodeBase64(value) {
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4) throw new TypeError('Invalid base64.');
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	const output = new Uint8Array(value.length / 4 * 3 - padding);
	let offset = 0;
	for (let index = 0; index < value.length; index += 4) {
		const a = alphabet.indexOf(value[index]);
		const b = alphabet.indexOf(value[index + 1]);
		const c = value[index + 2] === '=' ? 0 : alphabet.indexOf(value[index + 2]);
		const d = value[index + 3] === '=' ? 0 : alphabet.indexOf(value[index + 3]);
		if (a < 0 || b < 0 || c < 0 || d < 0) throw new TypeError('Invalid base64.');
		const combined = (a << 18) | (b << 12) | (c << 6) | d;
		if (offset < output.length) output[offset++] = combined >>> 16;
		if (offset < output.length) output[offset++] = combined >>> 8;
		if (offset < output.length) output[offset++] = combined;
	}
	return output;
}

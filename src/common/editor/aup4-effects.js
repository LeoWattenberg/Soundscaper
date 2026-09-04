/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
} from './audacity-binary-xml.js';
import { createEffect, normalizeEffect } from './effects.js';
import { booleanValue, finiteNumber } from './audacity-command-parameters.js';
import {
	booleanAttribute,
	cloneEntry,
	cloneNode,
	mergeAttributes,
} from './aup4-effect-xml-values.js';
import {
	AUP4_REALTIME_EFFECT_PROFILES,
	MAX_NATIVE_PARAMETERS,
	MAX_NATIVE_PARAMETER_NAME_CODE_UNITS,
	MAX_NATIVE_PARAMETER_VALUE_CODE_UNITS,
	canEncodeAup4NativeRealtimeEffect,
	decodeAudacityRealtimeEffectParameters,
	encodeAudacityRealtimeEffectParameters,
	nativeEffectId,
	realtimeEffectTypeForNativeId,
} from './aup4-effect-profiles.js';
import {
	createBrowserEffectNode,
	missingEffect,
	parseNativeEffectId,
	readBrowserEffect,
} from './aup4-browser-effect-payload.js';

export {
	AUP4_REALTIME_EFFECT_PROFILES,
	aup4NativeEffectId,
	canEncodeAup4NativeRealtimeEffect,
	decodeAudacityRealtimeEffectParameters,
	encodeAudacityRealtimeEffectParameters,
} from './aup4-effect-profiles.js';

const MAX_EFFECTS_PER_RACK = 256;

export function createAup4EffectsNode(effects = [], opaqueEffectsNode = null, options = {}) {
	const requestedActive = typeof options === 'boolean' ? options : options.effectsActive;
	const active = requestedActive === undefined
		? booleanAttribute(opaqueEffectsNode, 'active', true)
		: requestedActive !== false;
	const generated = (effects || []).map((effect, index) => {
		const opaque = effect?.opaqueAudacityNode?.kind === 'node' ? effect.opaqueAudacityNode.node : null;
		return { kind: 'node', node: createRealtimeEffectNode(effect, opaque, index) };
	});
	const content = mergeRackChildren(generated, opaqueEffectsNode);
	return createAudacityXmlNode('effects', mergeAttributes([
		{ kind: 'attribute', name: 'active', type: 'bool', value: active },
	], opaqueEffectsNode?.content), content);
}

export function readAup4EffectsNode(node, options = {}) {
	if (!node) return [];
	const idFactory = typeof options.idFactory === 'function'
		? options.idFactory
		: (prefix) => `${prefix}-${Math.random().toString(36).slice(2)}`;
	const effects = [];
	const effectsActive = booleanAttribute(node, 'active', true);
	if (typeof options.onRackActive === 'function') options.onRackActive(effectsActive);
	for (const [index, effectNode] of audacityXmlChildren(node, 'effect').entries()) {
		if (index >= MAX_EFFECTS_PER_RACK) {
			options.onOpaqueEffect?.(effectNode, index, 'rack-limit-exceeded');
			continue;
		}
		const decoded = decodeRealtimeEffectNode(effectNode, idFactory);
		if (!decoded) {
			options.onOpaqueEffect?.(effectNode, index, 'malformed-or-over-limit-state');
			continue;
		}
		effects.push(decoded);
		if (decoded.type === 'missing' && typeof options.onMissingEffect === 'function') {
			options.onMissingEffect(decoded, index);
		}
	}
	return effects;
}

function decodeRealtimeEffectNode(effectNode, idFactory) {
	const nativeId = String(audacityXmlAttribute(effectNode, 'id', ''));
	const parsedId = parseNativeEffectId(nativeId);
	if (!parsedId) return null;
	const browserEffect = readBrowserEffect(nativeId, parsedId, effectNode, idFactory);
	if (browserEffect !== undefined) return browserEffect;
	const type = realtimeEffectTypeForNativeId(nativeId);
	const profile = AUP4_REALTIME_EFFECT_PROFILES[type];
	const nativeParams = readNativeParameters(effectNode);
	if (!nativeParams) return null;
	if (!profile) {
		return missingEffect(effectNode, idFactory, {
			name: parsedId.name,
			nativeId,
			reason: 'plugin-unavailable',
		});
	}
	if (hasUnsupportedNativeParameters(profile, nativeParams)) {
		return missingEffect(effectNode, idFactory, {
			name: profile.symbol,
			nativeId,
			reason: 'unsupported-state',
		});
	}
	try {
		const params = decodeAudacityRealtimeEffectParameters(type, nativeParams);
		const id = idFactory('effect');
		if (typeof id !== 'string' || !id) return null;
		const normalized = createEffect(type, {
			id,
			enabled: booleanAttribute(effectNode, 'active', true),
			params,
		});
		return { ...normalized, opaqueAudacityNode: { kind: 'node', node: cloneNode(effectNode) } };
	} catch {
		if (hasMalformedNativeParameterValues(profile, nativeParams)) return null;
		// The bounded record is structurally valid, but this build cannot
		// interpret a future enum/range value. Keep it visible and bypassed.
		return missingEffect(effectNode, idFactory, {
			name: profile.symbol,
			nativeId,
			reason: 'unsupported-state',
		});
	}
}

function hasMalformedNativeParameterValues(profile, nativeParams) {
	for (const descriptor of profile.params) {
		if (!descriptor.model || !nativeParams.has(descriptor.native)) continue;
		const value = nativeParams.get(descriptor.native);
		if (descriptor.kind === 'number' && finiteNumber(value) === undefined) return true;
		if (descriptor.kind === 'boolean' && booleanValue(value) === undefined) return true;
	}
	for (const [name, value] of nativeParams) {
		if (/^[fv](?:0|[1-9][0-9]{0,2})$/.test(name) && finiteNumber(value) === undefined) return true;
	}
	return false;
}

function hasUnsupportedNativeParameters(profile, nativeParams) {
	const known = new Set(profile.params.map((descriptor) => descriptor.native));
	for (const descriptor of profile.params) {
		if (descriptor.constant !== undefined
			&& nativeParams.has(descriptor.native)
			&& nativeParams.get(descriptor.native) !== descriptor.constant) return true;
	}
	for (const name of nativeParams.keys()) {
		if (known.has(name)) continue;
		if ((profile.curve || profile.bands) && /^[fv](?:0|[1-9][0-9]{0,2})$/.test(name)) continue;
		return true;
	}
	return false;
}

function readNativeParameters(effectNode) {
	const output = new Map();
	let count = 0;
	for (const container of audacityXmlChildren(effectNode, 'parameters')) {
		for (const parameter of audacityXmlChildren(container, 'parameter')) {
			count += 1;
			if (count > MAX_NATIVE_PARAMETERS) return null;
			const name = String(audacityXmlAttribute(parameter, 'name', ''));
			const value = String(audacityXmlAttribute(parameter, 'value', ''));
			if (!name || name.length > MAX_NATIVE_PARAMETER_NAME_CODE_UNITS
				|| value.length > MAX_NATIVE_PARAMETER_VALUE_CODE_UNITS) return null;
			if (output.has(name)) return null;
			output.set(name, value);
		}
	}
	return output;
}

function createRealtimeEffectNode(effect, opaqueNode, rackIndex) {
	if (effect?.type === 'missing') return createMissingEffectNode(effect, opaqueNode);
	const profile = AUP4_REALTIME_EFFECT_PROFILES[effect?.type];
	if (!profile || !canEncodeAup4NativeRealtimeEffect(effect)) {
		// Older browser snapshots sometimes materialized an unavailable native
		// effect as an opaque-only rack item. It has no executable browser type,
		// so retaining the native node is the only safe round trip.
		if (!effect?.type && opaqueNode) return cloneNode(opaqueNode);
		return createBrowserEffectNode(effect, opaqueNode, rackIndex);
	}
	const parameters = encodeAudacityRealtimeEffectParameters(effect.type, effect.params || {});
	const opaqueParameters = audacityXmlChildren(opaqueNode, 'parameters')[0];
	const knownNames = new Set(parameters.map(([name]) => name));
	const parameterContent = parameters.map(([name, value]) => ({ kind: 'node', node: createAudacityXmlNode('parameter', [
		{ kind: 'attribute', name: 'name', type: 'string', value: name },
		{ kind: 'attribute', name: 'value', type: 'string', value },
	]) }));
	for (const parameter of audacityXmlChildren(opaqueParameters, 'parameter')) {
		const name = String(audacityXmlAttribute(parameter, 'name', ''));
		if (!knownNames.has(name) && (!(profile.curve || profile.bands) || !/^[fv](?:0|[1-9][0-9]{0,2})$/.test(name))) {
			parameterContent.push({ kind: 'node', node: cloneNode(parameter) });
		}
	}
	const content = [{ kind: 'node', node: createAudacityXmlNode('parameters', [], parameterContent) }];
	for (const entry of opaqueNode?.content || []) {
		if (entry.kind !== 'node' || entry.node?.name === 'parameters') continue;
		content.push(cloneEntry(entry));
	}
	return createAudacityXmlNode('effect', mergeAttributes([
		{ kind: 'attribute', name: 'active', type: 'bool', value: effect.enabled !== false },
		{ kind: 'attribute', name: 'id', type: 'string', value: nativeEffectId(profile.symbol) },
	], opaqueNode?.content), content);
}

function createMissingEffectNode(effect, opaqueNode) {
	const normalized = normalizeEffect(effect);
	const source = opaqueNode?.name === 'effect'
		? opaqueNode
		: normalized.opaqueAudacityNode?.kind === 'node'
			? normalized.opaqueAudacityNode.node
			: null;
	if (!source) {
		if (!parseNativeEffectId(normalized.missing.nativeId)) {
			throw new TypeError('A missing AUP4 effect needs a valid native effect ID.');
		}
		return createAudacityXmlNode('effect', [
			{ kind: 'attribute', name: 'active', type: 'bool', value: normalized.enabled !== false },
			{ kind: 'attribute', name: 'id', type: 'string', value: normalized.missing.nativeId },
		]);
	}
	if (booleanAttribute(source, 'active', true) === (normalized.enabled !== false)) {
		return cloneNode(source);
	}
	// An unavailable plug-in's private state belongs to that plug-in. Preserve
	// every byte and attribute, changing only the activation requested by the
	// user.
	const enabled = normalized.enabled !== false;
	let replaced = false;
	const attributes = source.content
		.filter((entry) => entry.kind === 'attribute')
		.map((entry) => {
			if (entry.name !== 'active') return cloneEntry(entry);
			replaced = true;
			return { ...cloneEntry(entry), value: activationAttributeValue(entry, enabled) };
		});
	if (!replaced) attributes.push({ kind: 'attribute', name: 'active', type: 'bool', value: enabled });
	return createAudacityXmlNode('effect', attributes, source.content
		.filter((entry) => entry.kind !== 'attribute')
		.map(cloneEntry));
}

function mergeRackChildren(generated, opaqueEffectsNode) {
	if (!opaqueEffectsNode) return generated;
	const output = [];
	let generatedIndex = 0;
	let effectIndex = 0;
	for (const entry of opaqueEffectsNode.content || []) {
		if (entry.kind === 'attribute') continue;
		if (entry.kind !== 'node' || entry.node?.name !== 'effect') {
			output.push(cloneEntry(entry));
			continue;
		}
		const materializedSlot = effectIndex < MAX_EFFECTS_PER_RACK
			&& decodeRealtimeEffectNode(entry.node, () => `opaque-effect-${effectIndex}`);
		effectIndex += 1;
		if (materializedSlot) {
			if (generatedIndex < generated.length) output.push(generated[generatedIndex++]);
		} else {
			// Malformed and over-limit records stay inert, byte-preserving, and
			// anchored between the same neighboring materialized rack slots.
			output.push(cloneEntry(entry));
		}
	}
	while (generatedIndex < generated.length) output.push(generated[generatedIndex++]);
	return output;
}

function activationAttributeValue(attribute, enabled) {
	if (attribute.type === 'bool') return enabled;
	if (attribute.type === 'string') return enabled ? '1' : '0';
	return enabled ? 1 : 0;
}

import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
} from './audacity-binary-xml.js';
import {
	audioEffectLabel,
	createEffect,
	createMissingEffect,
	normalizeEffect,
} from './effects.js';

const AUDACITY_EFFECT_ID_PREFIX = 'Effect_Audacity_Audacity_';
const AUDACITY_EFFECT_PATH_PREFIX = 'Built-in Effect: ';
const BROWSER_EFFECT_FAMILY = 'kw.media';
const BROWSER_EFFECT_VENDOR = 'kw.media';
const BROWSER_EFFECT_PATH_PREFIX = 'kw.media Browser Effect: ';
const LEGACY_BROWSER_EFFECT_NAME = 'Browser Rack';
const BROWSER_EFFECT_SCHEMA_VERSION = 1;
const MAX_BROWSER_EFFECT_ID_BYTES = 64 * 1024;
const MAX_BROWSER_EFFECT_JSON_DEPTH = 32;
const MAX_BROWSER_EFFECT_JSON_NODES = 4_096;
const MAX_BROWSER_EFFECT_ID_CODE_UNITS = 1_024;
const MAX_EFFECTS_PER_RACK = 256;
const MAX_NATIVE_PARAMETERS = 512;
const MAX_NATIVE_PARAMETER_NAME_CODE_UNITS = 256;
const MAX_NATIVE_PARAMETER_VALUE_CODE_UNITS = 4_096;
const UTF8 = new TextEncoder();
const MAX_BROWSER_EFFECT_PAYLOAD_BYTES = Math.floor(
	(MAX_BROWSER_EFFECT_ID_BYTES - 2_048) / 4 * 3,
);

const DISTORTION_MODES = Object.freeze([
	'hard-clipping', 'soft-clipping', 'soft-overdrive', 'medium-overdrive',
	'hard-overdrive', 'cubic', 'even-harmonics', 'expand-compress', 'leveller',
	'rectifier', 'hard-limiter',
]);
const DISTORTION_NATIVE_MODES = Object.freeze([
	'Hard Clipping', 'Soft Clipping', 'Soft Overdrive', 'Medium Overdrive',
	'Hard Overdrive', 'Cubic Curve (odd harmonics)', 'Even Harmonics',
	'Expand and Compress', 'Leveller', 'Rectifier Distortion', 'Hard Limiter 1413',
]);
const FILTER_FAMILIES = Object.freeze(['butterworth', 'chebyshev-i', 'chebyshev-ii']);
const FILTER_NATIVE_FAMILIES = Object.freeze(['Butterworth', 'Chebyshev Type I', 'Chebyshev Type II']);
const FILTER_DIRECTIONS = Object.freeze(['lowpass', 'highpass']);
const FILTER_NATIVE_DIRECTIONS = Object.freeze(['Lowpass', 'Highpass']);
const EQ_INTERPOLATIONS = Object.freeze(['bspline', 'cosine', 'cubic']);
const EQ_NATIVE_INTERPOLATIONS = Object.freeze(['B-spline', 'Cosine', 'Cubic']);

const numberParam = (model, native = model) => ({ model, native, kind: 'number', decode: finiteNumber });
const booleanParam = (model, native = model) => ({ model, native, kind: 'boolean', encode: booleanString, decode: booleanValue });
const enumParam = (model, native, values, nativeValues) => ({
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
		// Browser builds before the pinned-id audit wrote enum indexes. Continue
		// reading those files, but always emit Audacity's symbolic identifiers.
		if (index < 0) index = boundedIndex(text, values.length);
		return index === undefined ? undefined : values[index];
	},
});

// These names and symbols are the stable CommandParameters representation
// written by RealtimeEffectState at the pinned Audacity revision. Keeping the
// mapping here prevents browser labels or translated UI strings from becoming
// part of the portable project format.
export const AUP4_REALTIME_EFFECT_PROFILES = deepFreeze({
	'audacity-auto-duck': {
		symbol: 'Auto Duck',
		params: [
			numberParam('duckAmountDb', 'DuckAmountDb'),
			numberParam('innerFadeDown', 'InnerFadeDownLen'),
			numberParam('innerFadeUp', 'InnerFadeUpLen'),
			numberParam('outerFadeDown', 'OuterFadeDownLen'),
			numberParam('outerFadeUp', 'OuterFadeUpLen'),
			numberParam('thresholdDb', 'ThresholdDb'),
			numberParam('maximumPause', 'MaximumPause'),
		],
	},
	'audacity-bass-treble': {
		symbol: 'Bass and Treble',
		params: [
			numberParam('bassDb', 'Bass'),
			numberParam('trebleDb', 'Treble'),
			numberParam('volumeDb', 'Gain'),
			{ native: 'Link Sliders', constant: '0' },
		],
	},
	'audacity-click-removal': {
		symbol: 'Click removal',
		params: [numberParam('threshold', 'Threshold'), numberParam('maximumWidth', 'Width')],
	},
	'audacity-compressor': {
		symbol: 'Compressor',
		params: [
			numberParam('thresholdDb'), numberParam('makeupGainDb'), numberParam('kneeWidthDb'),
			numberParam('ratio', 'compressionRatio'), numberParam('lookaheadMs'),
			numberParam('attackMs'), numberParam('releaseMs'),
		],
	},
	'audacity-distortion': {
		symbol: 'Distortion',
		params: [
			enumParam('mode', 'Type', DISTORTION_MODES, DISTORTION_NATIVE_MODES), booleanParam('dcBlock', 'DC Block'),
			numberParam('thresholdDb', 'Threshold dB'), numberParam('noiseFloorDb', 'Noise Floor'),
			numberParam('parameter1', 'Parameter 1'), numberParam('parameter2', 'Parameter 2'),
			numberParam('repeats', 'Repeats'),
		],
	},
	'audacity-echo': {
		symbol: 'Echo',
		params: [numberParam('delaySeconds', 'Delay'), numberParam('decay', 'Decay')],
	},
	'audacity-filter-curve-eq': {
		symbol: 'Filter Curve',
		params: [
			numberParam('filterLength', 'FilterLength'),
			booleanParam('linearFrequencyScale', 'InterpolateLin'),
			enumParam('interpolation', 'InterpolationMethod', EQ_INTERPOLATIONS, EQ_NATIVE_INTERPOLATIONS),
		],
		curve: true,
	},
	'audacity-graphic-eq': {
		symbol: 'Graphic EQ',
		params: [
			numberParam('filterLength', 'FilterLength'),
			{ native: 'InterpolateLin', constant: '0' },
			enumParam('interpolation', 'InterpolationMethod', EQ_INTERPOLATIONS, EQ_NATIVE_INTERPOLATIONS),
		],
		bands: true,
	},
	'audacity-invert': { symbol: 'Invert', params: [] },
	'audacity-limiter': {
		symbol: 'Limiter',
		params: [
			numberParam('thresholdDb'), numberParam('makeupTargetDb'), numberParam('kneeWidthDb'),
			numberParam('lookaheadMs'), numberParam('releaseMs'),
		],
	},
	'audacity-noise-reduction': {
		symbol: 'Noise reduction',
		params: [
			numberParam('sensitivity', 'Sensitivity'),
			numberParam('frequencySmoothingBands', 'Frequency Smoothing Bands'),
			numberParam('reductionDb', 'Noise Gain'),
			{
				model: 'output', native: 'Noise Reduction Choice',
				encode: (value) => value === 'residue' ? '1' : '0',
				decode: (value) => {
					const index = boundedIndex(value, 2);
					return index === undefined ? undefined : index === 1 ? 'residue' : 'reduce';
				},
			},
		],
	},
	'audacity-phaser': {
		symbol: 'Phaser',
		params: [
			numberParam('stages', 'Stages'), numberParam('dryWet', 'DryWet'),
			numberParam('frequency', 'Freq'), numberParam('phaseDegrees', 'Phase'),
			numberParam('depth', 'Depth'), numberParam('feedbackPercent', 'Feedback'),
			numberParam('outputGainDb', 'Gain'),
		],
	},
	'audacity-classic-filters': {
		symbol: 'Classic Filters',
		params: [
			enumParam('family', 'FilterType', FILTER_FAMILIES, FILTER_NATIVE_FAMILIES),
			enumParam('direction', 'FilterSubtype', FILTER_DIRECTIONS, FILTER_NATIVE_DIRECTIONS),
			numberParam('order', 'Order'), numberParam('cutoffHz', 'Cutoff'),
			numberParam('passbandRippleDb', 'PassbandRipple'),
			numberParam('stopbandAttenuationDb', 'StopbandRipple'),
		],
	},
	'audacity-wahwah': {
		symbol: 'Wahwah',
		params: [
			numberParam('frequency', 'Freq'), numberParam('phaseDegrees', 'Phase'),
			numberParam('depthPercent', 'Depth'), numberParam('resonance', 'Resonance'),
			numberParam('frequencyOffsetPercent', 'Offset'), numberParam('outputGainDb', 'Gain'),
		],
	},
});

const TYPE_BY_NATIVE_ID = new Map(Object.entries(AUP4_REALTIME_EFFECT_PROFILES)
	.map(([type, profile]) => [nativeEffectId(profile.symbol), type]));

export function aup4NativeEffectId(type) {
	const profile = AUP4_REALTIME_EFFECT_PROFILES[type];
	return profile ? nativeEffectId(profile.symbol) : null;
}

export function canEncodeAup4NativeRealtimeEffect(effect) {
	const profile = AUP4_REALTIME_EFFECT_PROFILES[effect?.type];
	if (!profile || effect?.context !== undefined || effect?.state !== undefined || !isPlainObject(effect?.params)) {
		return false;
	}
	const supportedParams = new Set(profile.params
		.filter((descriptor) => descriptor.model)
		.map((descriptor) => descriptor.model));
	if (profile.curve) supportedParams.add('points');
	if (profile.bands) supportedParams.add('gains');
	return Object.keys(effect.params).every((name) => supportedParams.has(name));
}

/**
 * Encode a browser Audacity rack effect's parameters with Audacity's stable
 * CommandParameters names and values. This representation is shared by AUP4
 * realtime effects and text macros.
 */
export function encodeAudacityRealtimeEffectParameters(type, params = {}) {
	const profile = requireRealtimeEffectProfile(type);
	const output = [];
	for (const descriptor of profile.params) {
		const raw = descriptor.constant ?? params[descriptor.model];
		if (raw === undefined) continue;
		output.push([
			descriptor.native,
			descriptor.encode ? descriptor.encode(raw) : stableNumberString(raw),
		]);
	}
	appendEqualizationPoints(profile, params, output);
	return Object.freeze(output.map((entry) => Object.freeze(entry)));
}

/**
 * Decode Audacity CommandParameters into browser rack parameters. Unknown
 * parameters are ignored here because AUP4 must preserve future parameters
 * opaquely; callers parsing a stricter interchange format can reject them
 * before calling this helper.
 */
export function decodeAudacityRealtimeEffectParameters(type, parameters) {
	const profile = requireRealtimeEffectProfile(type);
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
	readEqualizationPoints(profile, nativeParams, params);
	return params;
}

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
	const type = TYPE_BY_NATIVE_ID.get(nativeId);
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
		if (!knownNames.has(String(audacityXmlAttribute(parameter, 'name', '')))) {
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

function createBrowserEffectNode(effect, opaqueNode = null, rackIndex = 0) {
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

function readBrowserEffect(nativeId, parsedId, effectNode, idFactory) {
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

function missingEffect(effectNode, idFactory, metadata) {
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

function supportedBrowserEffectType(type) {
	try {
		audioEffectLabel(type, 'en');
		return true;
	} catch {
		return false;
	}
}

function browserNativeEffectId(name, encodedPayload) {
	if (typeof name !== 'string' || !name || name.length > 1_024) {
		throw new TypeError('A browser effect needs a bounded canonical name.');
	}
	return `Effect_${BROWSER_EFFECT_FAMILY}_${BROWSER_EFFECT_VENDOR}_${escapeEffectIdField(name)}_${BROWSER_EFFECT_PATH_PREFIX}${encodedPayload}`;
}

function parseNativeEffectId(nativeId) {
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

function escapeEffectIdField(value) {
	return value.replaceAll('\\', '\\\\').replaceAll('_', '\\_');
}

function appendEqualizationPoints(profile, params, output) {
	let points = null;
	if (profile.curve && Array.isArray(params.points)) points = params.points;
	if (profile.bands && Array.isArray(params.gains)) {
		const frequencies = params.gains.length === 31
			? [20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]
			: [];
		points = frequencies.map((frequency, index) => ({ frequency, gain: params.gains[index] }));
	}
	for (const [index, point] of (points || []).entries()) {
		output.push([`f${index}`, stableNumberString(point.frequency)]);
		output.push([`v${index}`, stableNumberString(point.gain)]);
	}
}

function readEqualizationPoints(profile, nativeParams, params) {
	if (!profile.curve && !profile.bands) return;
	const points = [];
	for (let index = 0; index < 200; index += 1) {
		if (!nativeParams.has(`f${index}`) || !nativeParams.has(`v${index}`)) break;
		const frequency = finiteNumber(nativeParams.get(`f${index}`));
		const gain = finiteNumber(nativeParams.get(`v${index}`));
		if (frequency == null || gain == null || frequency <= 0) break;
		points.push({ frequency, gain });
	}
	if (profile.curve && points.length) params.points = points;
	if (profile.bands && points.length === 31) params.gains = points.map((point) => point.gain);
}

function requireRealtimeEffectProfile(type) {
	const profile = AUP4_REALTIME_EFFECT_PROFILES[type];
	if (!profile) throw new RangeError(`Unsupported Audacity realtime effect: ${type}.`);
	return profile;
}

function parameterEntries(value) {
	if (value instanceof Map) return new Map(value);
	if (Array.isArray(value)) return new Map(value);
	if (value && typeof value === 'object') return new Map(Object.entries(value));
	throw new TypeError('Audacity effect parameters must be a map, object, or entry list.');
}

function nativeEffectId(symbol) {
	return `${AUDACITY_EFFECT_ID_PREFIX}${symbol}_${AUDACITY_EFFECT_PATH_PREFIX}${symbol}`;
}

function mergeAttributes(generated, opaqueContent) {
	const byName = new Map(generated.map((entry) => [entry.name, entry]));
	const used = new Set();
	const output = [];
	for (const entry of opaqueContent || []) {
		if (entry.kind !== 'attribute') continue;
		const replacement = byName.get(entry.name);
		if (replacement && !used.has(entry.name)) {
			output.push(replacement);
			used.add(entry.name);
		} else if (!replacement) output.push(cloneEntry(entry));
	}
	for (const entry of generated) if (!used.has(entry.name)) output.push(entry);
	return output;
}

function stableNumberString(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new RangeError('AUP4 realtime effect parameters must be finite.');
	return Object.is(number, -0) ? '0' : String(number);
}

function finiteNumber(value) {
	const text = String(value).trim();
	if (!text || text.length > 128) return undefined;
	const number = Number(text);
	return Number.isFinite(number) ? number : undefined;
}

function booleanString(value) {
	return value ? '1' : '0';
}

function booleanValue(value) {
	if (value === true || value === 1) return true;
	if (value === false || value === 0) return false;
	const text = String(value).trim().toLowerCase();
	if (text === '1' || text === 'true') return true;
	if (text === '0' || text === 'false') return false;
	return undefined;
}

function boundedIndex(value, length) {
	const text = String(value).trim();
	if (!text || text.length > 32) return undefined;
	const number = Number(text);
	return Number.isInteger(number) && number >= 0 && number < length ? number : undefined;
}

function booleanAttribute(node, name, fallback) {
	const value = audacityXmlAttribute(node, name, fallback);
	const parsed = booleanValue(value);
	return parsed === undefined ? fallback : parsed;
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

function isPlainObject(value) {
	if (!value || typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function cloneNode(node) {
	return {
		name: node.name,
		content: (node.content || []).map(cloneEntry),
	};
}

function cloneEntry(entry) {
	if (entry.kind === 'node') return { kind: 'node', node: cloneNode(entry.node) };
	if (entry.value instanceof Uint8Array) return { ...entry, value: entry.value.slice() };
	return { ...entry };
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

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

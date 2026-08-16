/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * `OfxEffectBindingV1` — the project's record of one OpenFX effect instance,
 * and what playback does when the plug-in behind it is not available.
 *
 * The binding stores the plug-in fingerprint, the context, the named inputs,
 * typed parameter state, and any bounded custom-parameter encoding. It never
 * stores a path: the same project opened on another machine finds the plug-in
 * by identity or does not find it at all.
 *
 * When a plug-in is missing, changed, crashed, revoked, or quarantined, the
 * authored state is preserved untouched and playback falls back. If a verified
 * frozen render exists for exactly this binding and parameter state, it plays;
 * otherwise the effect is bypassed. What never happens is silent omission — a
 * project that renders without an effect it still contains, and says nothing,
 * is a project whose output quietly stopped matching its own timeline.
 */

import {
	OFX_CONTEXTS,
	OFX_PARAMETER_TYPES,
	type OfxContext,
	type OfxParameterType,
} from './native-ofx-descriptor.ts';

export const OFX_BINDING_MAXIMUM_INPUTS = 16;
export const OFX_BINDING_MAXIMUM_PARAMETERS = 4_096;
export const OFX_BINDING_MAXIMUM_STRING_LENGTH = 4_096;
export const OFX_BINDING_MAXIMUM_CUSTOM_BYTES = 64 * 1024;
export const OFX_BINDING_MAXIMUM_KEYFRAMES = 8_192;

/** Parameter types that carry no value of their own. */
export const OFX_VALUELESS_PARAMETER_TYPES: readonly OfxParameterType[] = Object.freeze([
	'group', 'page', 'pushbutton',
]);

export const OFX_PLUGIN_AVAILABILITIES = Object.freeze([
	'available', 'missing', 'fingerprint-changed', 'crashed', 'revoked', 'quarantined',
] as const);

export type OfxPluginAvailability = (typeof OFX_PLUGIN_AVAILABILITIES)[number];

export type OfxPlaybackMode = 'render' | 'frozen' | 'bypass';

export interface OfxKeyframeV1 {
	readonly frame: number;
	readonly value: number;
}

export interface OfxParameterStateV1 {
	readonly name: string;
	readonly type: OfxParameterType;
	readonly value: unknown;
	readonly keyframes: readonly OfxKeyframeV1[];
}

export interface OfxInputBindingV1 {
	readonly name: string;
	/** A project source id or a resolved timeline output id. Never a path. */
	readonly sourceRef: string;
}

export interface OfxFrozenRenderDescriptorV1 {
	readonly storageKey: string;
	readonly sha256: string;
	readonly parameterStateSha256: string;
	readonly frameCount: number;
}

export interface OfxEffectBindingV1 {
	readonly bindingId: string;
	readonly pluginId: string;
	readonly binarySha256: string;
	readonly context: OfxContext;
	readonly inputs: readonly OfxInputBindingV1[];
	readonly parameters: readonly OfxParameterStateV1[];
	readonly customEncodings: Readonly<Record<string, string>>;
	readonly enabled: boolean;
	readonly frozenRender: OfxFrozenRenderDescriptorV1 | null;
}

export interface OfxPlaybackResolutionV1 {
	readonly mode: OfxPlaybackMode;
	readonly availability: OfxPluginAvailability;
	/** Always true: a fallback never edits what the user authored. */
	readonly authoredStatePreserved: true;
	/** True when the user must be told the timeline is not rendering as authored. */
	readonly reportsDegradation: boolean;
}

export class OfxBindingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OfxBindingError';
	}
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BINDING_KEYS = Object.freeze([
	'bindingId', 'pluginId', 'binarySha256', 'context', 'inputs', 'parameters',
	'customEncodings', 'enabled', 'frozenRender',
]);

export function assertOfxEffectBindingV1(value: unknown): asserts value is OfxEffectBindingV1 {
	const binding = record(value, 'OFX effect binding');
	exactKeys(binding, BINDING_KEYS, 'OFX effect binding');
	pattern(binding.bindingId, ID_PATTERN, 'bindingId');
	pattern(binding.pluginId, ID_PATTERN, 'pluginId');
	pattern(binding.binarySha256, SHA256_PATTERN, 'binarySha256');
	if (typeof binding.context !== 'string'
		|| !(OFX_CONTEXTS as readonly string[]).includes(binding.context)) {
		throw new OfxBindingError('An OFX effect binding must name a known image-effect context.');
	}
	inputs(binding.inputs);
	const names = parameters(binding.parameters);
	customEncodings(binding.customEncodings, names);
	if (typeof binding.enabled !== 'boolean') {
		throw new OfxBindingError('An OFX effect binding must state whether it is enabled.');
	}
	if (binding.frozenRender !== null) frozenRender(binding.frozenRender);
}

/**
 * Decide how one binding plays given what is known about its plug-in.
 *
 * The frozen render is only used when its recorded parameter-state digest still
 * matches the binding's current parameters. A frozen frame produced under
 * different settings is not a stand-in for the effect; it is a wrong picture
 * that happens to be the right size.
 */
export function resolveOfxPlayback(
	binding: OfxEffectBindingV1,
	availability: OfxPluginAvailability,
	currentParameterStateSha256: string,
): OfxPlaybackResolutionV1 {
	if (!(OFX_PLUGIN_AVAILABILITIES as readonly string[]).includes(availability)) {
		throw new OfxBindingError('An OFX playback resolution needs a known availability.');
	}
	if (!binding.enabled) {
		return resolution('bypass', availability, false);
	}
	if (availability === 'available') {
		return resolution('render', availability, false);
	}
	const frozen = binding.frozenRender;
	const usable = frozen !== null
		&& frozen.parameterStateSha256 === pattern(
			currentParameterStateSha256, SHA256_PATTERN, 'parameter state digest',
		);
	return resolution(usable ? 'frozen' : 'bypass', availability, true);
}

/** The digest a frozen render is validated against. */
export function ofxParameterStateDigestInput(binding: OfxEffectBindingV1): string {
	return JSON.stringify({
		pluginId: binding.pluginId,
		binarySha256: binding.binarySha256,
		context: binding.context,
		inputs: binding.inputs.map((input) => [input.name, input.sourceRef]),
		parameters: binding.parameters.map((parameter) => [
			parameter.name,
			parameter.type,
			parameter.value ?? null,
			parameter.keyframes.map((keyframe) => [keyframe.frame, keyframe.value]),
		]),
		customEncodings: Object.entries(binding.customEncodings).sort(),
	});
}

function resolution(
	mode: OfxPlaybackMode,
	availability: OfxPluginAvailability,
	reportsDegradation: boolean,
): OfxPlaybackResolutionV1 {
	return Object.freeze({
		mode,
		availability,
		authoredStatePreserved: true as const,
		reportsDegradation,
	});
}

function inputs(value: unknown): void {
	if (!Array.isArray(value)) throw new OfxBindingError('An OFX effect binding must list its inputs.');
	if (value.length > OFX_BINDING_MAXIMUM_INPUTS) {
		throw new OfxBindingError('An OFX effect binding exceeds its input ceiling.');
	}
	const names = new Set<string>();
	for (const entry of value as readonly unknown[]) {
		const input = record(entry, 'OFX input binding');
		exactKeys(input, ['name', 'sourceRef'], 'OFX input binding');
		const name = pattern(input.name, NAME_PATTERN, 'input name');
		if (names.has(name)) {
			throw new OfxBindingError('An OFX effect binding names the same input twice.');
		}
		names.add(name);
		// The id pattern admits no separator, which is what keeps an input
		// binding a reference to a project object rather than to a path.
		if (typeof input.sourceRef !== 'string' || !ID_PATTERN.test(input.sourceRef)) {
			throw new OfxBindingError(
				'An OFX input binding references a project object by id, never a path.',
			);
		}
	}
}

function parameters(value: unknown): ReadonlySet<string> {
	if (!Array.isArray(value)) {
		throw new OfxBindingError('An OFX effect binding must list its parameter state.');
	}
	if (value.length > OFX_BINDING_MAXIMUM_PARAMETERS) {
		throw new OfxBindingError('An OFX effect binding exceeds its parameter ceiling.');
	}
	const names = new Set<string>();
	for (const entry of value as readonly unknown[]) {
		const parameter = record(entry, 'OFX parameter state');
		exactKeys(parameter, ['name', 'type', 'value', 'keyframes'], 'OFX parameter state');
		const name = pattern(parameter.name, NAME_PATTERN, 'parameter name');
		if (names.has(name)) {
			throw new OfxBindingError('An OFX effect binding names the same parameter twice.');
		}
		names.add(name);
		const type = parameter.type;
		if (typeof type !== 'string' || !(OFX_PARAMETER_TYPES as readonly string[]).includes(type)) {
			throw new OfxBindingError('An OFX parameter state must declare a known OpenFX type.');
		}
		parameterValue(type as OfxParameterType, parameter.value);
		keyframes(parameter.keyframes, type as OfxParameterType);
	}
	return names;
}

function parameterValue(type: OfxParameterType, value: unknown): void {
	if (OFX_VALUELESS_PARAMETER_TYPES.includes(type)) {
		if (value !== null) {
			throw new OfxBindingError(`An OFX ${type} parameter carries no value.`);
		}
		return;
	}
	if (type === 'boolean') {
		if (typeof value !== 'boolean') throw new OfxBindingError('An OFX boolean parameter must be a boolean.');
		return;
	}
	if (type === 'string' || type === 'custom') {
		boundedText(value, type === 'custom' ? OFX_BINDING_MAXIMUM_CUSTOM_BYTES : OFX_BINDING_MAXIMUM_STRING_LENGTH);
		return;
	}
	if (type === 'choice' || type === 'integer') {
		integer(value);
		return;
	}
	if (type === 'parametric') {
		if (!Array.isArray(value) || value.length > OFX_BINDING_MAXIMUM_KEYFRAMES) {
			throw new OfxBindingError('An OFX parametric parameter carries a bounded control-point list.');
		}
		for (const point of value as readonly unknown[]) numbers(point, 2);
		return;
	}
	numbers(value, componentCount(type));
}

function componentCount(type: OfxParameterType): number {
	if (type === 'double') return 1;
	if (type === 'integer2d' || type === 'double2d') return 2;
	if (type === 'integer3d' || type === 'double3d' || type === 'rgb') return 3;
	if (type === 'rgba') return 4;
	throw new OfxBindingError('An OFX parameter type has no defined component count.');
}

function keyframes(value: unknown, type: OfxParameterType): void {
	if (!Array.isArray(value)) {
		throw new OfxBindingError('An OFX parameter state must list its keyframes, even when empty.');
	}
	if (value.length > OFX_BINDING_MAXIMUM_KEYFRAMES) {
		throw new OfxBindingError('An OFX parameter exceeds its keyframe ceiling.');
	}
	if (value.length > 0 && OFX_VALUELESS_PARAMETER_TYPES.includes(type)) {
		throw new OfxBindingError(`An OFX ${type} parameter cannot be keyframed.`);
	}
	let previousFrame = Number.NEGATIVE_INFINITY;
	for (const entry of value as readonly unknown[]) {
		const keyframe = record(entry, 'OFX keyframe');
		exactKeys(keyframe, ['frame', 'value'], 'OFX keyframe');
		if (!Number.isSafeInteger(keyframe.frame) || (keyframe.frame as number) < 0) {
			throw new OfxBindingError('An OFX keyframe frame must be a non-negative safe integer.');
		}
		if ((keyframe.frame as number) <= previousFrame) {
			throw new OfxBindingError('OFX keyframes must be strictly ordered by frame.');
		}
		previousFrame = keyframe.frame as number;
		if (typeof keyframe.value !== 'number' || !Number.isFinite(keyframe.value)) {
			throw new OfxBindingError('An OFX keyframe value must be a finite number.');
		}
	}
}

function customEncodings(value: unknown, parameterNames: ReadonlySet<string>): void {
	const encodings = record(value, 'OFX custom encodings');
	let total = 0;
	for (const [name, encoded] of Object.entries(encodings)) {
		if (!parameterNames.has(pattern(name, NAME_PATTERN, 'custom encoding name'))) {
			throw new OfxBindingError('An OFX custom encoding names a parameter the binding does not carry.');
		}
		total += boundedText(encoded, OFX_BINDING_MAXIMUM_CUSTOM_BYTES).length;
		if (total > OFX_BINDING_MAXIMUM_CUSTOM_BYTES) {
			throw new OfxBindingError('An OFX effect binding exceeds its custom-encoding ceiling.');
		}
	}
}

function frozenRender(value: unknown): void {
	const descriptor = record(value, 'OFX frozen render descriptor');
	exactKeys(
		descriptor,
		['storageKey', 'sha256', 'parameterStateSha256', 'frameCount'],
		'OFX frozen render descriptor',
	);
	pattern(descriptor.storageKey, ID_PATTERN, 'frozenRender.storageKey');
	pattern(descriptor.sha256, SHA256_PATTERN, 'frozenRender.sha256');
	pattern(descriptor.parameterStateSha256, SHA256_PATTERN, 'frozenRender.parameterStateSha256');
	if (!Number.isSafeInteger(descriptor.frameCount) || (descriptor.frameCount as number) <= 0) {
		throw new OfxBindingError('An OFX frozen render must cover at least one frame.');
	}
}

function numbers(value: unknown, count: number): void {
	if (!Array.isArray(value) || value.length !== count
		|| value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
		throw new OfxBindingError(`An OFX parameter value must be ${String(count)} finite numbers.`);
	}
}

function integer(value: unknown): void {
	if (!Number.isSafeInteger(value)) {
		throw new OfxBindingError('An OFX integer parameter must be a safe integer.');
	}
}

function boundedText(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || value.length > maximum) {
		throw new OfxBindingError('An OFX text parameter must be bounded text.');
	}
	return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new OfxBindingError(`An ${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
	label: string,
): void {
	const present = Object.keys(value);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new OfxBindingError(`An ${label} must carry exactly its schema keys.`);
	}
}

function pattern(value: unknown, expression: RegExp, label: string): string {
	if (typeof value !== 'string' || !expression.test(value)) {
		throw new OfxBindingError(`An OFX effect binding ${label} is not in its canonical form.`);
	}
	return value;
}

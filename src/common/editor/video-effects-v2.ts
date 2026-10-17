/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { createStableId } from './stable-id.js';
import { VIDEO_EFFECT_DEFINITIONS, createVideoEffect, normalizeVideoEffect, updateVideoEffect } from './video-effects.js';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1, normalizeCubeLutProfileEffectV1, normalizeCubeLutProfileParamsV1 } from './video-cube-lut-profile-v1.ts';
import type { VideoEffectLeaf } from './project-media-types.ts';
import type { VideoEffectLeafV2 } from './video-effect-leaf-v2.ts';
import type { VideoEffectParameterV2 } from './video-effect-parameter-v2.ts';

export interface VideoEffectParameterDefinitionV2 {
	readonly label: string;
	readonly labelKey: string;
	readonly default: VideoEffectParameterV2;
	readonly control: string;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly integer?: boolean;
	readonly unit?: string;
	readonly options?: readonly Readonly<{ value: number; label: string; labelKey: string }>[];
}
export interface VideoEffectDefinitionV2 {
	readonly type: string;
	readonly label: string;
	readonly labelKey: string;
	readonly shader: string | null;
	readonly ffmpegFilter: string | null;
	readonly resourceDependent?: true;
	readonly params: Readonly<Record<string, VideoEffectParameterDefinitionV2>>;
}
export interface VideoEffectNormalizationOptionsV2 { readonly allowedTypes?: readonly string[]; }

/** Explicit current-consumer opt-in. The original registry and every V1
 * constructor/serializer remain unchanged and refuse this resource family.
 * A null default is a bypass, never an implicit identity LUT or body cache. */
export const VIDEO_EFFECT_DEFINITIONS_V2: Readonly<Record<string, VideoEffectDefinitionV2>> = Object.freeze({
	...legacyDefinitions(),
	[CUBE_LUT_PROFILE_EFFECT_TYPE_V1]: Object.freeze({
		type: CUBE_LUT_PROFILE_EFFECT_TYPE_V1, label: '.cube LUT profile', labelKey: 'videoEffectCubeLutProfile',
		shader: null, ffmpegFilter: null, resourceDependent: true as const,
		params: Object.freeze({ lut: Object.freeze({ label: '.cube LUT', labelKey: 'videoEffectCubeLutProfile', default: null, control: 'cube-lut' }) }),
	}),
});
export const VIDEO_EFFECT_TYPES_V2 = Object.freeze(Object.keys(VIDEO_EFFECT_DEFINITIONS_V2));

export function videoEffectDefinitionV2(type: string): VideoEffectDefinitionV2 {
	if (typeof type !== 'string' || !Object.hasOwn(VIDEO_EFFECT_DEFINITIONS_V2, type)) throw new RangeError('Unsupported video effect type.');
	return VIDEO_EFFECT_DEFINITIONS_V2[type]!;
}
export function videoEffectDefaultsV2(type: string): Readonly<Record<string, VideoEffectParameterV2>> {
	return Object.freeze(Object.fromEntries(Object.entries(videoEffectDefinitionV2(type).params).map(([name, parameter]) => [name, parameter.default])));
}

export function createVideoEffectV2(type: string, options: unknown = {}): Readonly<VideoEffectLeafV2> {
	videoEffectDefinitionV2(type);
	if (type !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) return freezeLegacy(createVideoEffect(type, options as Parameters<typeof createVideoEffect>[1]) as VideoEffectLeaf);
	const input = record(options, 'cube LUT profile creation', ['id', 'type', 'enabled', 'params', 'index'], []);
	const take = (key: string) => Object.hasOwn(input, key) ? field(input, key, 'cube LUT profile creation') : undefined;
	if (Object.hasOwn(input, 'type') && take('type') !== type) throw new RangeError('Cube LUT profile creation requires its exact type.');
	const index = take('index');
	if (index !== undefined && (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > 100_000)) throw new RangeError('Invalid effect insertion index.');
	return cubeLeaf(normalizeCubeLutProfileEffectV1({ id: Object.hasOwn(input, 'id') ? take('id') : createStableId('video-effect'),
		type, enabled: Object.hasOwn(input, 'enabled') ? take('enabled') : true, params: normalizeCubeLutProfileParamsV1(take('params')) }));
}

export function normalizeVideoEffectV2(value: unknown, name = 'videoEffect', options: VideoEffectNormalizationOptionsV2 = {}): Readonly<VideoEffectLeafV2> {
	const type = effectType(value, name);
	if (type !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) return freezeLegacy(normalizeVideoEffect(value, name, options) as VideoEffectLeaf);
	const normalized = normalizeCubeLutProfileEffectV1(value);
	const input = record(options, 'video effect normalization options', ['allowedTypes'], []);
	if (Object.hasOwn(input, 'allowedTypes')) {
		const allowed = readClosedDomainArray(field(input, 'allowedTypes', 'video effect normalization options'), 'allowed video effects', 0, 100_000);
		if (!allowed.includes(type)) throw new RangeError(`${name}.type is not supported by this schema.`);
	}
	return cubeLeaf(normalized);
}

export function normalizeVideoEffectsV2(value: unknown, name = 'videoEffects', options: VideoEffectNormalizationOptionsV2 = {}): readonly Readonly<VideoEffectLeafV2>[] {
	const effects = readClosedDomainArray(value, name, 0, 100_000).map((effect, index) => normalizeVideoEffectV2(effect, `${name}[${String(index)}]`, options));
	const ids = new Set<string>();
	for (const effect of effects) {
		if (ids.has(effect.id)) throw new RangeError(`${name} cannot contain duplicate IDs.`);
		ids.add(effect.id);
	}
	return Object.freeze(effects);
}

export function updateVideoEffectV2(value: unknown, changes: unknown = {}): Readonly<VideoEffectLeafV2> {
	if (effectType(value, 'videoEffect') !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) return freezeLegacy(updateVideoEffect(value, changes as Parameters<typeof updateVideoEffect>[1]) as VideoEffectLeaf);
	const effect = normalizeCubeLutProfileEffectV1(value);
	const input = record(changes, 'cube LUT profile changes', ['enabled', 'params'], []);
	return cubeLeaf(normalizeCubeLutProfileEffectV1({ ...effect,
		enabled: Object.hasOwn(input, 'enabled') ? field(input, 'enabled', 'cube LUT profile changes') : effect.enabled,
		params: Object.hasOwn(input, 'params') ? normalizeCubeLutProfileParamsV1(field(input, 'params', 'cube LUT profile changes')) : effect.params }));
}

function effectType(value: unknown, name: string): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return field(value as Readonly<Record<string, unknown>>, 'type', name);
}
function freezeLegacy(value: VideoEffectLeaf): Readonly<VideoEffectLeafV2> {
	return Object.freeze({ id: value.id, type: value.type, enabled: value.enabled, params: Object.freeze({ ...value.params }) });
}
function cubeLeaf(value: ReturnType<typeof normalizeCubeLutProfileEffectV1>): Readonly<VideoEffectLeafV2> {
	return Object.freeze({ id: value.id, type: value.type, enabled: value.enabled, params: Object.freeze({ lut: value.params.lut }) });
}

function legacyDefinitions(): Readonly<Record<string, VideoEffectDefinitionV2>> {
	// The handwritten JS wheel tuples infer string|number bounds. Verify the
	// inert registry's numeric metadata without changing any legacy definition.
	for (const definition of Object.values(VIDEO_EFFECT_DEFINITIONS)) for (const parameter of Object.values(definition.params)) {
		if (!parameter || typeof parameter !== 'object') throw new TypeError('Registered effect parameter metadata must be an object.');
		if ('min' in parameter && typeof parameter.min !== 'number') throw new TypeError('Registered effect minimum must be numeric.');
		if ('max' in parameter && typeof parameter.max !== 'number') throw new TypeError('Registered effect maximum must be numeric.');
	}
	return VIDEO_EFFECT_DEFINITIONS as Readonly<Record<string, VideoEffectDefinitionV2>>;
}

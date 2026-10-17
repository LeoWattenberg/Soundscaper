/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { normalizeVideoCubeLutReferenceV1, type VideoCubeLutReferenceV1 } from './cube-lut-reference-contract.ts';

export const CUBE_LUT_PROFILE_EFFECT_TYPE_V1 = 'cube-lut-profile-v1';
/** The existing V27 table samples AFTER an identity linear Rec709 grade;
 * source decoding/output encoding remain explicit renderer admission. RGB
 * is processed even at alpha0 under inherited V27 semantics; only straight
 * alpha is unchanged. There is no intensity or implicit encoded-space LUT. */
export const CUBE_LUT_PROFILE_PROCESS_V1 = 'linear-rec709-d65-cube-trilinear-v27';

export interface CubeLutProfileParamsV1 {
	readonly lut: Readonly<VideoCubeLutReferenceV1> | null;
}
export interface CubeLutProfileEffectV1 {
	readonly id: string;
	readonly type: typeof CUBE_LUT_PROFILE_EFFECT_TYPE_V1;
	readonly enabled: boolean;
	readonly params: Readonly<CubeLutProfileParamsV1>;
}
export interface CubeLutProfileResourcePlanV1 {
	readonly type: typeof CUBE_LUT_PROFILE_EFFECT_TYPE_V1;
	readonly process: typeof CUBE_LUT_PROFILE_PROCESS_V1;
	readonly effectId: string;
	readonly enabled: boolean;
	/** Neutral describes null parameters; disabled still retains its reference. */
	readonly neutral: boolean;
	readonly reference: Readonly<VideoCubeLutReferenceV1> | null;
}

const PARAMS = new WeakSet<object>();
const EFFECTS = new WeakSet<object>();
const PLANS = new WeakSet<object>();
const DEFAULT_PARAMS = Object.freeze({ lut: null });
PARAMS.add(DEFAULT_PARAMS);

/** Creation may explicitly request the null default. Supplied persisted
 * parameter records require their one own field; raw bodies/parsed tables
 * and partial records are not a second reference normalization authority. */
export function normalizeCubeLutProfileParamsV1(value: unknown = undefined): Readonly<CubeLutProfileParamsV1> {
	if (value === undefined) return DEFAULT_PARAMS;
	if (value && typeof value === 'object' && PARAMS.has(value)) return value as Readonly<CubeLutProfileParamsV1>;
	const input = record(value, 'cube LUT profile parameters', ['lut']);
	const raw = field(input, 'lut', 'cube LUT profile parameters');
	const lut = raw === null ? null : normalizeVideoCubeLutReferenceV1(raw);
	const result = Object.freeze({ lut });
	PARAMS.add(result);
	return result;
}

export function normalizeCubeLutProfileEffectV1(value: unknown): Readonly<CubeLutProfileEffectV1> {
	if (value && typeof value === 'object' && EFFECTS.has(value)) return value as Readonly<CubeLutProfileEffectV1>;
	const input = record(value, 'cube LUT profile effect', ['id', 'type', 'enabled', 'params']);
	const id = field(input, 'id', 'cube LUT profile effect');
	const type = field(input, 'type', 'cube LUT profile effect');
	const enabled = field(input, 'enabled', 'cube LUT profile effect');
	if (typeof id !== 'string' || id.length < 1 || id.length > 128) throw new TypeError('Cube LUT profile requires a bounded effect ID.');
	if (type !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) throw new RangeError('Unsupported cube LUT profile process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Cube LUT profile enabled must be boolean.');
	const rawParams = field(input, 'params', 'cube LUT profile effect');
	if (rawParams === undefined) throw new TypeError('Cube LUT profile requires explicit persisted parameters.');
	const params = normalizeCubeLutProfileParamsV1(rawParams);
	const result = Object.freeze({ id, type, enabled, params });
	EFFECTS.add(result);
	return result;
}

/** A scalar resource requirement is not a parsed-body or storage proof. All
 * references, including disabled ones, are fully normalized before a host can
 * inspect the plan. Only a future coordinated renderer/custody adapter may
 * load the exact body through the existing scoped V27 resource boundary.
 * No runtime definition, numeric GPU code, FFmpeg expression or body cache
 * is registered here, and current V1 consumer schemas are not widened. */
export function prepareCubeLutProfileResourcePlanV1(value: unknown): Readonly<CubeLutProfileResourcePlanV1> {
	const effect = normalizeCubeLutProfileEffectV1(value);
	const result = Object.freeze({ type: effect.type, process: CUBE_LUT_PROFILE_PROCESS_V1,
		effectId: effect.id, enabled: effect.enabled, neutral: effect.params.lut === null, reference: effect.params.lut });
	PLANS.add(result);
	return result;
}

export function assertCubeLutProfileResourcePlanV1(value: unknown): asserts value is Readonly<CubeLutProfileResourcePlanV1> {
	if (!value || typeof value !== 'object' || !PLANS.has(value)) throw new TypeError('An owning cube LUT profile resource plan is required.');
}

/** Null means no processing resource is required. Custody closure still
 * retains plan.reference for disabled effects; it must never use this render
 * requirement to discard unreachable-from-the-current-render bodies. */
export function cubeLutProfileResourceRequirementV1(value: unknown): Readonly<VideoCubeLutReferenceV1> | null {
	assertCubeLutProfileResourcePlanV1(value);
	return value.enabled && !value.neutral ? value.reference : null;
}

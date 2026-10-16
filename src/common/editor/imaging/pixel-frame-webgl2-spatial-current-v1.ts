/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeDetailSharpenEffectV1, prepareDetailSharpenEffectV1 } from '../video-sharpen-v1.ts';
import { normalizePostCropVignetteEffectV1, preparePostCropVignetteEffectV1 } from '../video-post-crop-vignette-v1.ts';
import { normalizeClarityEffectV1, prepareClarityEffectV1 } from '../video-clarity-v1.ts';
import { normalizeNoiseReductionEffectV1, prepareNoiseReductionEffectV1 } from '../video-noise-reduction-v1.ts';
import { normalizeGrainEffectV1, prepareGrainEffectV1 } from '../video-grain-v1.ts';
import { normalizeTextureEffectV1, prepareTextureEffectV1 } from '../video-texture-v1.ts';
import { normalizeDehazeEffectV1, prepareDehazeEffectV1 } from '../video-dehaze-v1.ts';
import type { PixelFrameDescriptorV1 } from './pixel-frame-contract-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { captureLinearKernelDescriptorV1, type LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import { prepareLinearSpatialEffectV1, writeLinearSpatialEffectV1 } from './pixel-frame-linear-spatial-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';

type Vec4 = readonly [number, number, number, number];
type Effect = ReturnType<typeof normalizeDetailSharpenEffectV1> | ReturnType<typeof normalizePostCropVignetteEffectV1>
	| ReturnType<typeof normalizeClarityEffectV1> | ReturnType<typeof normalizeNoiseReductionEffectV1>
	| ReturnType<typeof normalizeGrainEffectV1> | ReturnType<typeof normalizeTextureEffectV1> | ReturnType<typeof normalizeDehazeEffectV1>;
export type PixelFrameWebGl2SpatialInputPolicyCurrentV1 = 'copy' | 'pointwise-independent' | 'pointwise-coupled' | 'neighborhood';
export interface PreparedPixelFrameWebGl2SpatialCurrentV1 {
	readonly id: string;
	readonly type: Effect['type'];
	readonly kind: 14 | 15 | 16 | 17 | 18 | 19 | 20;
	readonly sourceDescriptor: LinearKernelDescriptorV1;
	readonly descriptor: LinearKernelDescriptorV1;
	/** Raw authored enabled and prepared Q8-neutral remain distinct. */
	readonly enabled: boolean;
	readonly neutral: boolean;
	readonly inputPolicy: PixelFrameWebGl2SpatialInputPolicyCurrentV1;
	readonly params0: Vec4;
	/** x/y carry family payloads, z is reserved0, w is enabled&&!neutral. */
	readonly params1: Vec4;
	readonly supported: boolean;
}
type Plan = ReturnType<typeof prepareLinearSpatialEffectV1>;
type Pass = Readonly<PreparedPixelFrameWebGl2SpatialCurrentV1>;
const PREPARED = new WeakMap<object, Readonly<{ pass: Pass; plan: Plan }>>();
const tuple = (a = 0, b = 0, c = 0, d = 0): Vec4 => Object.freeze([a, b, c, d]);

function normalize(snapshot: Readonly<Record<string, unknown>>): Effect {
	switch (snapshot.type) {
		case 'detail-sharpen-v1': return normalizeDetailSharpenEffectV1(snapshot);
		case 'post-crop-vignette-v1': return normalizePostCropVignetteEffectV1(snapshot);
		case 'clarity-v1': return normalizeClarityEffectV1(snapshot);
		case 'noise-reduction-v1': return normalizeNoiseReductionEffectV1(snapshot);
		case 'grain-v1': return normalizeGrainEffectV1(snapshot);
		case 'texture-v1': return normalizeTextureEffectV1(snapshot);
		case 'dehaze-v1': return normalizeDehazeEffectV1(snapshot);
		default: throw new RangeError('Unsupported native GPU spatial family.');
	}
}

/** Scalar capture only. The caller's closed params are normalized once into
 * detached immutable metadata before any repeated preparation. Neither pixels
 * nor GPU resources enter admission; the CPU plan stays private. */
export function preparePixelFrameWebGl2SpatialCurrentV1(effectValue: unknown, descriptorValue: PixelFrameDescriptorV1): Pass {
	const input = record(effectValue, 'native GPU spatial effect', ['id', 'type', 'enabled', 'params']);
	const snapshot = Object.freeze({ id: field(input, 'id', 'native GPU spatial effect'), type: field(input, 'type', 'native GPU spatial effect'),
		enabled: field(input, 'enabled', 'native GPU spatial effect'), params: field(input, 'params', 'native GPU spatial effect') });
	const descriptor = captureLinearKernelDescriptorV1(descriptorValue), effect = normalize(snapshot);
	const plan = prepareLinearSpatialEffectV1(effect, descriptor);
	const own = (kind: Pass['kind'], params0: Vec4, x = 0, y = 0,
		policy: PixelFrameWebGl2SpatialInputPolicyCurrentV1 = 'neighborhood'): Pass => {
		const active = plan.enabled && !plan.neutral, params1 = tuple(x, y, 0, active ? 1 : 0);
		const supported = [...params0, ...params1].every(value => Number.isFinite(value) && Math.fround(value) === value);
		const pass: Pass = Object.freeze({ id: effect.id, type: effect.type, kind, sourceDescriptor: descriptor, descriptor,
			enabled: plan.enabled, neutral: plan.neutral, inputPolicy: active ? policy : 'copy', params0, params1, supported });
		PREPARED.set(pass, Object.freeze({ pass, plan })); return pass;
	};
	switch (effect.type) {
		case 'detail-sharpen-v1': {
			const p = prepareDetailSharpenEffectV1(effect); return own(14, tuple(p.gainQ8, p.threshold));
		}
		case 'post-crop-vignette-v1': {
			const p = preparePostCropVignetteEffectV1(effect);
			return own(15, tuple(p.amountQ8, p.midpointQ16, p.featherQ16, p.roundnessQ8), p.highlightsQ8, 0,
				p.amountQ8 < 0 && p.highlightsQ8 !== 0 ? 'pointwise-coupled' : 'pointwise-independent');
		}
		case 'clarity-v1': {
			const p = prepareClarityEffectV1(effect); return own(16, tuple(p.gainQ8));
		}
		case 'noise-reduction-v1': {
			const p = prepareNoiseReductionEffectV1(effect);
			return own(17, tuple(p.luminanceQ8, p.luminanceDetailQ8, p.luminanceContrastQ8, p.colorQ8), p.colorDetailQ8, p.colorSmoothnessQ8);
		}
		case 'grain-v1': {
			const p = prepareGrainEffectV1(effect); return own(18, tuple(p.amountQ8, p.sizeQ8, p.roughnessQ8, p.seed), 0, 0, 'pointwise-coupled');
		}
		case 'texture-v1': {
			const p = prepareTextureEffectV1(effect); return own(19, tuple(p.gainQ8));
		}
		case 'dehaze-v1': {
			const p = prepareDehazeEffectV1(effect); return own(20, tuple(p.gainQ8, p.fogQ8), 0, 0,
				p.gainQ8 < 0 ? 'pointwise-independent' : 'neighborhood');
		}
	}
}

/** Identity-only admission does not reflect forged objects or revoked proxies. */
export function isPixelFrameWebGl2SpatialCurrentV1(value: unknown): value is Pass {
	return typeof value === 'object' && value !== null && PREPARED.has(value);
}
export function readPixelFrameWebGl2SpatialCurrentV1(value: unknown): Pass {
	if (!isPixelFrameWebGl2SpatialCurrentV1(value)) throw new TypeError('Native GPU spatial effect requires an owning prepared identity.');
	return PREPARED.get(value)!.pass;
}

/** The unchanged native writer owns all math and Float32 stage stores. This
 * wrapper admits the descriptor binding before reading samples. The outer
 * owner supplies and retires dedicated disjoint planes; scratch has zero bytes. */
export async function writePixelFrameWebGl2SpatialCurrentV1(value: unknown, source: LinearWorkingPixelFrameV1,
	target: Float32Array<ArrayBuffer>, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const pass = readPixelFrameWebGl2SpatialCurrentV1(value), plan = PREPARED.get(pass)!.plan;
	let pixels: unknown;
	try {
		if (typeof source !== 'object' || source === null) throw new TypeError('Native GPU spatial effect requires a source frame.');
		const slot = Object.getOwnPropertyDescriptor(source, 'descriptor');
		if (!slot || !Object.hasOwn(slot, 'value') || slot.enumerable !== true) throw new TypeError('Native GPU spatial source requires an own descriptor.');
		const descriptorValue: unknown = slot.value, descriptor = captureLinearKernelDescriptorV1(descriptorValue);
		if (descriptor.width !== pass.sourceDescriptor.width || descriptor.height !== pass.sourceDescriptor.height
			|| descriptor.primaries !== pass.sourceDescriptor.primaries) throw new RangeError('Native GPU spatial source differs from its prepared descriptor.');
		const input = record(source, 'native GPU spatial source', ['descriptor', 'pixels']);
		pixels = field(input, 'pixels', 'native GPU spatial source');
	} catch (error) { checkRepairSignalV1(signal); throw error; }
	// No pixel coercion: the existing native kernel performs intrinsic dedicated
	// plane admission. The typed input is checked by that same original writer.
	await writeLinearSpatialEffectV1(plan, pixels as Float32Array<ArrayBuffer>, target, new Uint8Array(0), signal);
}

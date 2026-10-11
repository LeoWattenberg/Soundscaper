/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { POST_CROP_VIGNETTE_EFFECT_TYPE_V1 } from '../video-post-crop-vignette-v1.ts';
import { withPostCropVignettePixelFrameV1 } from './pixel-frame-post-crop-vignette-v1.ts';
import { CLARITY_EFFECT_TYPE_V1 } from '../video-clarity-v1.ts';
import { withClarityPixelFrameV1 } from './pixel-frame-clarity-v1.ts';
import { NOISE_REDUCTION_EFFECT_TYPE_V1 } from '../video-noise-reduction-v1.ts';
import { withNoiseReductionPixelFrameV1 } from './pixel-frame-noise-reduction-v1.ts';
import { GRAIN_EFFECT_TYPE_V1 } from '../video-grain-v1.ts';
import { withGrainPixelFrameV1 } from './pixel-frame-grain-v1.ts';
import { TEXTURE_EFFECT_TYPE_V1 } from '../video-texture-v1.ts';
import { withTexturePixelFrameV1 } from './pixel-frame-texture-v1.ts';
import { DEHAZE_EFFECT_TYPE_V1 } from '../video-dehaze-v1.ts';
import { withDehazePixelFrameV1 } from './pixel-frame-dehaze-v1.ts';
import { DETAIL_SHARPEN_EFFECT_TYPE_V1 } from '../video-sharpen-v1.ts';
import { COLOR_WHEELS_EFFECT_TYPE_V1 } from '../video-color-wheels-v1.ts';
import { withDetailSharpenPixelFrameV1 } from './pixel-frame-sharpen-v1.ts';
import { withGlobalDevelopPixelFrameV1 } from './pixel-frame-global-develop-v1.ts';
import { withGeometryPixelFrameV1 } from './pixel-frame-geometry-v1.ts';
import { createPixelFrameHistogramV1, type PixelFrameHistogramV1 } from './pixel-frame-histogram-v1.ts';
import { isCurvesEffectTypeV1 } from '../video-curves-v1.ts';
import { isGlobalDevelopEffectTypeV1 } from '../video-global-develop-v1.ts';
import { CHROMA_DEVELOP_EFFECT_TYPE_V1 } from '../video-chroma-develop-v1.ts';
import { BLACK_WHITE_MIX_EFFECT_TYPE_V1 } from '../video-black-white-mix-v1.ts';
import { HSL_MIXER_EFFECT_TYPE_V1 } from '../video-hsl-mixer-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../video-image-geometry-v1.ts';
import type { ImageGeometryV1 } from './image-geometry-v1.ts';
import { IMAGE_DEVELOP_LIMITS_V1, type ImageDevelopStateV1 } from './image-develop-contract-v1.ts';
import type { ImageDevelopStateV2 } from './image-develop-state-v2.ts';
import type { VideoEffectLeafV2 } from '../video-effect-leaf-v2.ts';
import { normalizeImageDevelopEffectsV1 } from './image-develop-effects-v1.ts';
import { admitImageDevelopMaskAuthorityV1, planImageDevelopMasksV1 } from './image-develop-mask-plan-v1.ts';
import { withVideoMaskMatteRgbaV1 } from '../video-mask-matte-rgba-v13.ts';
import { blendImageDevelopMaskedAdjustmentV1 } from './pixel-frame-masked-adjustment-v1.ts';

export interface ImageDevelopFrameStageInput {
	readonly descriptor: Readonly<PixelFrameDescriptorV1>;
	readonly pixels: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>;
}
export interface ImageDevelopFramePixels extends ImageDevelopFrameStageInput {
	readonly pixels: Uint8Array<ArrayBuffer>;
}
export interface ImageDevelopFrameViewV1 {
	readonly frame: Readonly<ImageDevelopFramePixels>;
	readonly histogram: Readonly<PixelFrameHistogramV1>;
}
const SIGNAL_PROTOTYPE = AbortSignal.prototype;
const CHECK = SIGNAL_PROTOTYPE.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

export interface ImageDevelopFrameProfile { readonly source: PixelFrameLimitsV1; readonly render: PixelFrameLimitsV1 }
export type ImageDevelopFrameStage = (frame: ImageDevelopFramePixels, signal: AbortSignal | undefined, limits: PixelFrameLimitsV1,
	accept: (frame: ImageDevelopFrameStageInput) => void) => Promise<void>;
export interface ImageDevelopFramePolicy {
	readonly normalizeDevelop: (value: unknown) => ImageDevelopStateV1 | ImageDevelopStateV2;
	readonly prepareRequestOptions?: () => void;
	/** Undefined selects the strict legacy kernel; null is a retained neutral resource stage. */
	readonly prepareResourceStage?: (effect: VideoEffectLeafV2) => ImageDevelopFrameStage | null | undefined;
}
export async function withImageDevelopFrameCore<Result>(value: unknown,
	consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, profile: ImageDevelopFrameProfile, policy: ImageDevelopFramePolicy): Promise<Result> {
	const input = record(value, 'photo develop proxy', ['frame', 'develop', 'signal'], ['frame', 'develop']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'photo develop proxy') : undefined;
	if (signal !== undefined) assertImageDevelopSignal(signal);
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Photo develop proxy requires a scoped consumer.');
	if (policy.prepareRequestOptions) {
		try { policy.prepareRequestOptions(); } catch (error) { check(); throw error; }
		check();
	}
	const develop = admitImageDevelopMaskAuthorityV1(policy.normalizeDevelop(field(input, 'develop', 'photo develop proxy')));
	const serialized = JSON.stringify(develop), maximum = IMAGE_DEVELOP_LIMITS_V1.maximumBytes;
	if (serialized.length > maximum || new TextEncoder().encode(serialized).byteLength > maximum) throw new RangeError('Photo proxy settings exceed their byte budget.');
	const prepared = develop.effects.map(candidate => {
		const render = policy.prepareResourceStage?.(candidate);
		if (render !== undefined) return Object.freeze({ kind: 'resource' as const, id: candidate.id, enabled: candidate.enabled, render });
		const effect = normalizeImageDevelopEffectsV1([candidate])[0]!;
		if (effect.enabled && effect.type !== DEHAZE_EFFECT_TYPE_V1 && effect.type !== TEXTURE_EFFECT_TYPE_V1 && effect.type !== GRAIN_EFFECT_TYPE_V1 && effect.type !== NOISE_REDUCTION_EFFECT_TYPE_V1 && effect.type !== POST_CROP_VIGNETTE_EFFECT_TYPE_V1 && effect.type !== CLARITY_EFFECT_TYPE_V1 && effect.type !== DETAIL_SHARPEN_EFFECT_TYPE_V1 && effect.type !== IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 && effect.type !== CHROMA_DEVELOP_EFFECT_TYPE_V1
			&& effect.type !== BLACK_WHITE_MIX_EFFECT_TYPE_V1 && effect.type !== HSL_MIXER_EFFECT_TYPE_V1 && effect.type !== COLOR_WHEELS_EFFECT_TYPE_V1
			&& !isGlobalDevelopEffectTypeV1(effect.type) && !isCurvesEffectTypeV1(effect.type)) {
			throw new RangeError(`Unsupported photo proxy effect: ${effect.type}.`);
		}
		return Object.freeze({ kind: 'legacy' as const, effect });
	});
	const raw = record(field(input, 'frame', 'photo develop proxy'), 'photo proxy source', ['descriptor', 'pixels']);
	const admitted = admitPixelFrameV1(field(raw, 'descriptor', 'photo proxy source'), { limits: profile.source });
	const masks = planImageDevelopMasksV1(develop, admitted.descriptor.width, admitted.descriptor.height, profile.render);
	const source = readPixelFrameV1({ descriptor: admitted.descriptor, pixels: field(raw, 'pixels', 'photo proxy source') }, profile.source);
	let current: ImageDevelopFramePixels = Object.freeze({ descriptor: source.descriptor, pixels: new Uint8Array(source.pixels) });
	let owned = current.pixels.buffer;
	const replace = (next: ImageDevelopFramePixels) => { wipe(owned); current = next; owned = next.pixels.buffer; };
	const adjust = async (effectId: string, render: () => Promise<ImageDevelopFramePixels>) => {
		const next = await render();
		try {
			const binding = masks.bindings.find(candidate => candidate.effectId === effectId);
			if (binding) await withVideoMaskMatteRgbaV1({ graph: binding.graph, width: binding.width, height: binding.height, signal },
				coverage => blendImageDevelopMaskedAdjustmentV1(current, next, coverage, profile.render, signal as AbortSignal | undefined));
			replace(next);
		} catch (error) { wipe(next.pixels.buffer); throw error; }
	};
	try {
		const legacy = develop.geometry;
		if (legacy.crop !== null || legacy.rotationDegrees !== 0 || legacy.flipHorizontal || legacy.flipVertical) {
			replace(await geometry(current, { schemaVersion: 1, ...legacy, perspective: null }, signal as AbortSignal | undefined, profile.render));
		}
		for (const step of prepared) {
			check();
			if (step.kind === 'resource') {
				const render = step.render;
				if (step.enabled && render) await adjust(step.id, () => stage(accept => render(current, signal as AbortSignal | undefined, profile.render, accept)));
				continue;
			}
			const effect = step.effect; if (!effect.enabled) continue;
			if (effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) {
				replace(await geometry(current, imageGeometryForVideoEffectV1(effect, current.descriptor.width, current.descriptor.height), signal as AbortSignal | undefined, profile.render));
			} else if (effect.type === POST_CROP_VIGNETTE_EFFECT_TYPE_V1) {
				await adjust(effect.id, () => stage(accept => withPostCropVignettePixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else if (effect.type === CLARITY_EFFECT_TYPE_V1) {
				await adjust(effect.id, () => stage(accept => withClarityPixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else if (effect.type === NOISE_REDUCTION_EFFECT_TYPE_V1) {
				await adjust(effect.id, () => stage(accept => withNoiseReductionPixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else if (effect.type === GRAIN_EFFECT_TYPE_V1) {
				await adjust(effect.id, () => stage(accept => withGrainPixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else if (effect.type === TEXTURE_EFFECT_TYPE_V1) {
				await adjust(effect.id, () => stage(accept => withTexturePixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else if (effect.type === DEHAZE_EFFECT_TYPE_V1) {
				await adjust(effect.id, () => stage(accept => withDehazePixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else if (effect.type === DETAIL_SHARPEN_EFFECT_TYPE_V1) {
				await adjust(effect.id, () => stage(accept => withDetailSharpenPixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else {
				await adjust(effect.id, () => stage(accept => withGlobalDevelopPixelFrameV1({ frame: current, effects: [effect], signal }, accept,
					{ limits: profile.render, maximumEffects: 1 })));
			}
		}
		check();
		const histogram = await createPixelFrameHistogramV1(current, { limits: profile.render, ...(signal ? { signal } : {}) });
		check(); const result = await consume(Object.freeze({ frame: current, histogram })); check(); return result;
	} finally { wipe(owned); }
}

function geometry(frame: ImageDevelopFramePixels, geometry: Readonly<ImageGeometryV1>, signal: AbortSignal | undefined, limits: PixelFrameLimitsV1): Promise<ImageDevelopFramePixels> {
	return stage(accept => withGeometryPixelFrameV1({ frame, geometry, signal }, accept, { limits }));
}

/** A kernel may cancel after its callback returns. Retain and wipe that staged
 * copy if delivery refuses, rather than abandoning an allocated output. */
async function stage(run: (accept: (frame: ImageDevelopFrameStageInput) => void) => Promise<void>): Promise<ImageDevelopFramePixels> {
	const staged: { frame: ImageDevelopFramePixels | null; buffer: ArrayBuffer | null } = { frame: null, buffer: null };
	try {
		await run(frame => {
			const pixels = new Uint8Array(frame.pixels); staged.buffer = pixels.buffer;
			staged.frame = Object.freeze({ descriptor: frame.descriptor, pixels });
		});
		if (!staged.frame) throw new Error('Photo proxy stage produced no frame.');
		return staged.frame;
	} catch (error) { if (staged.buffer) wipe(staged.buffer); throw error; }
}

function wipe(buffer: ArrayBuffer): void {
	if (Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) new Uint8Array(buffer).fill(0);
}

/** Keep cancellation admission identical to the existing photo recipe owner. */
function assertImageDevelopSignal(value: unknown): asserts value is AbortSignal {
	if (typeof value !== 'object' || value === null) throw new TypeError('Collapsed queries require a native cancellation signal.');
	Reflect.apply(CHECK, value, []);
	if (Object.getPrototypeOf(value) !== SIGNAL_PROTOTYPE
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) {
		throw new TypeError('Collapsed queries require native cancellation behavior without overrides.');
	}
}

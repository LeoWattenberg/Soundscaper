/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { admitPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { POST_CROP_VIGNETTE_EFFECT_TYPE_V1 } from '../../common/editor/video-post-crop-vignette-v1.ts';
import { withPostCropVignettePixelFrameV1 } from '../../common/editor/imaging/pixel-frame-post-crop-vignette-v1.ts';
import { CLARITY_EFFECT_TYPE_V1 } from '../../common/editor/video-clarity-v1.ts';
import { withClarityPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-clarity-v1.ts';
import { NOISE_REDUCTION_EFFECT_TYPE_V1 } from '../../common/editor/video-noise-reduction-v1.ts';
import { withNoiseReductionPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-noise-reduction-v1.ts';
import { GRAIN_EFFECT_TYPE_V1 } from '../../common/editor/video-grain-v1.ts';
import { withGrainPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-grain-v1.ts';
import { TEXTURE_EFFECT_TYPE_V1 } from '../../common/editor/video-texture-v1.ts';
import { withTexturePixelFrameV1 } from '../../common/editor/imaging/pixel-frame-texture-v1.ts';
import { DEHAZE_EFFECT_TYPE_V1 } from '../../common/editor/video-dehaze-v1.ts';
import { withDehazePixelFrameV1 } from '../../common/editor/imaging/pixel-frame-dehaze-v1.ts';
import { DETAIL_SHARPEN_EFFECT_TYPE_V1 } from '../../common/editor/video-sharpen-v1.ts';
import { COLOR_WHEELS_EFFECT_TYPE_V1 } from '../../common/editor/video-color-wheels-v1.ts';
import { withDetailSharpenPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-sharpen-v1.ts';
import { withGlobalDevelopPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-global-develop-v1.ts';
import { withGeometryPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-geometry-v1.ts';
import { createPixelFrameHistogramV1, type PixelFrameHistogramV1 } from '../../common/editor/imaging/pixel-frame-histogram-v1.ts';
import { isCurvesEffectTypeV1 } from '../../common/editor/video-curves-v1.ts';
import { isGlobalDevelopEffectTypeV1 } from '../../common/editor/video-global-develop-v1.ts';
import { CHROMA_DEVELOP_EFFECT_TYPE_V1 } from '../../common/editor/video-chroma-develop-v1.ts';
import { BLACK_WHITE_MIX_EFFECT_TYPE_V1 } from '../../common/editor/video-black-white-mix-v1.ts';
import { HSL_MIXER_EFFECT_TYPE_V1 } from '../../common/editor/video-hsl-mixer-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../../common/editor/video-image-geometry-v1.ts';
import type { ImageGeometryV1 } from '../../common/editor/imaging/image-geometry-v1.ts';
import type { ImageDevelopStateV1 } from '../../common/editor/imaging/image-develop-contract-v1.ts';
import type { ImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import type { VideoEffectLeafV2 } from '../../common/editor/video-effect-leaf-v2.ts';
import { normalizeImageDevelopEffectsV1 } from '../../common/editor/imaging/image-develop-effects-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../catalog/types.ts';

export const PHOTO_DEVELOP_PROXY_LIMITS_V1 = Object.freeze({
	source: Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 }),
	render: Object.freeze({ maximumSidePixels: 4096, maximumPixels: 8_388_608, maximumBytes: 33_554_432 }),
});
export interface PhotoDevelopFrameStageInput {
	readonly descriptor: Readonly<PixelFrameDescriptorV1>;
	readonly pixels: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>;
}
export interface PhotoDevelopFramePixels extends PhotoDevelopFrameStageInput {
	readonly pixels: Uint8Array<ArrayBuffer>;
}
export interface PhotoDevelopFrameViewV1 {
	readonly frame: Readonly<PhotoDevelopFramePixels>;
	readonly histogram: Readonly<PixelFrameHistogramV1>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

export interface PhotoDevelopFrameProfile { readonly source: PixelFrameLimitsV1; readonly render: PixelFrameLimitsV1 }
export type PhotoDevelopFrameStage = (frame: PhotoDevelopFramePixels, signal: AbortSignal | undefined, limits: PixelFrameLimitsV1,
	accept: (frame: PhotoDevelopFrameStageInput) => void) => Promise<void>;
export interface PhotoDevelopFramePolicy {
	readonly normalizeDevelop: (value: unknown) => ImageDevelopStateV1 | ImageDevelopStateV2;
	readonly prepareRequestOptions?: () => void;
	/** Undefined selects the strict legacy kernel; null is a retained neutral resource stage. */
	readonly prepareResourceStage?: (effect: VideoEffectLeafV2) => PhotoDevelopFrameStage | null | undefined;
}
export async function withPhotoDevelopFrameCore<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopFrameViewV1>) => Result | Promise<Result>, profile: PhotoDevelopFrameProfile, policy: PhotoDevelopFramePolicy): Promise<Result> {
	const input = record(value, 'photo develop proxy', ['frame', 'develop', 'signal'], ['frame', 'develop']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'photo develop proxy') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Photo develop proxy requires a scoped consumer.');
	if (policy.prepareRequestOptions) {
		try { policy.prepareRequestOptions(); } catch (error) { check(); throw error; }
		check();
	}
	const develop = policy.normalizeDevelop(field(input, 'develop', 'photo develop proxy'));
	const serialized = JSON.stringify(develop), maximum = LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes;
	if (serialized.length > maximum || new TextEncoder().encode(serialized).byteLength > maximum) throw new RangeError('Photo proxy settings exceed their byte budget.');
	if (develop.maskBindings.length) throw new RangeError('Photo proxy mask-bound adjustments are unsupported.');
	const prepared = develop.effects.map(candidate => {
		const render = policy.prepareResourceStage?.(candidate);
		if (render !== undefined) return Object.freeze({ kind: 'resource' as const, enabled: candidate.enabled, render });
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
	const source = readPixelFrameV1({ descriptor: admitted.descriptor, pixels: field(raw, 'pixels', 'photo proxy source') }, profile.source);
	let current: PhotoDevelopFramePixels = Object.freeze({ descriptor: source.descriptor, pixels: new Uint8Array(source.pixels) });
	let owned = current.pixels.buffer;
	const replace = (next: PhotoDevelopFramePixels) => { wipe(owned); current = next; owned = next.pixels.buffer; };
	try {
		const legacy = develop.geometry;
		if (legacy.crop !== null || legacy.rotationDegrees !== 0 || legacy.flipHorizontal || legacy.flipVertical) {
			replace(await geometry(current, { schemaVersion: 1, ...legacy, perspective: null }, signal as AbortSignal | undefined, profile.render));
		}
		for (const step of prepared) {
			check();
			if (step.kind === 'resource') {
				const render = step.render;
				if (step.enabled && render) replace(await stage(accept => render(current, signal as AbortSignal | undefined, profile.render, accept)));
				continue;
			}
			const effect = step.effect; if (!effect.enabled) continue;
			if (effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) {
				replace(await geometry(current, imageGeometryForVideoEffectV1(effect, current.descriptor.width, current.descriptor.height), signal as AbortSignal | undefined, profile.render));
			} else if (effect.type === POST_CROP_VIGNETTE_EFFECT_TYPE_V1) {
				replace(await stage(accept => withPostCropVignettePixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else if (effect.type === CLARITY_EFFECT_TYPE_V1) {
				replace(await stage(accept => withClarityPixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else if (effect.type === NOISE_REDUCTION_EFFECT_TYPE_V1) {
				replace(await stage(accept => withNoiseReductionPixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else if (effect.type === GRAIN_EFFECT_TYPE_V1) {
				replace(await stage(accept => withGrainPixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else if (effect.type === TEXTURE_EFFECT_TYPE_V1) {
				replace(await stage(accept => withTexturePixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else if (effect.type === DEHAZE_EFFECT_TYPE_V1) {
				replace(await stage(accept => withDehazePixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else if (effect.type === DETAIL_SHARPEN_EFFECT_TYPE_V1) {
				replace(await stage(accept => withDetailSharpenPixelFrameV1({ frame: current, effect, signal }, accept, { limits: profile.render })));
			} else {
				replace(await stage(accept => withGlobalDevelopPixelFrameV1({ frame: current, effects: [effect], signal }, accept,
					{ limits: profile.render, maximumEffects: 1 })));
			}
		}
		check();
		const histogram = await createPixelFrameHistogramV1(current, { limits: profile.render, ...(signal ? { signal } : {}) });
		check(); const result = await consume(Object.freeze({ frame: current, histogram })); check(); return result;
	} finally { wipe(owned); }
}

function geometry(frame: PhotoDevelopFramePixels, geometry: Readonly<ImageGeometryV1>, signal: AbortSignal | undefined, limits: PixelFrameLimitsV1): Promise<PhotoDevelopFramePixels> {
	return stage(accept => withGeometryPixelFrameV1({ frame, geometry, signal }, accept, { limits }));
}

/** A kernel may cancel after its callback returns. Retain and wipe that staged
 * copy if delivery refuses, rather than abandoning an allocated output. */
async function stage(run: (accept: (frame: PhotoDevelopFrameStageInput) => void) => Promise<void>): Promise<PhotoDevelopFramePixels> {
	const staged: { frame: PhotoDevelopFramePixels | null; buffer: ArrayBuffer | null } = { frame: null, buffer: null };
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

/* SPDX-License-Identifier: AGPL-3.0-only */

import { POST_CROP_VIGNETTE_EFFECT_TYPE_V1, normalizePostCropVignetteEffectV1 } from '../common/editor/video-post-crop-vignette-v1.ts';
import { withPostCropVignettePixelFrameV1 } from '../common/editor/imaging/pixel-frame-post-crop-vignette-v1.ts';
import { CLARITY_EFFECT_TYPE_V1, normalizeClarityEffectV1 } from '../common/editor/video-clarity-v1.ts';
import { withClarityPixelFrameV1 } from '../common/editor/imaging/pixel-frame-clarity-v1.ts';
import { NOISE_REDUCTION_EFFECT_TYPE_V1, normalizeNoiseReductionEffectV1 } from '../common/editor/video-noise-reduction-v1.ts';
import { withNoiseReductionPixelFrameV1 } from '../common/editor/imaging/pixel-frame-noise-reduction-v1.ts';
import { GRAIN_EFFECT_TYPE_V1, normalizeGrainEffectV1 } from '../common/editor/video-grain-v1.ts';
import { withGrainPixelFrameV1 } from '../common/editor/imaging/pixel-frame-grain-v1.ts';
import { TEXTURE_EFFECT_TYPE_V1, normalizeTextureEffectV1 } from '../common/editor/video-texture-v1.ts';
import { withTexturePixelFrameV1 } from '../common/editor/imaging/pixel-frame-texture-v1.ts';
import { DEHAZE_EFFECT_TYPE_V1, normalizeDehazeEffectV1 } from '../common/editor/video-dehaze-v1.ts';
import { withDehazePixelFrameV1 } from '../common/editor/imaging/pixel-frame-dehaze-v1.ts';
import { DETAIL_SHARPEN_EFFECT_TYPE_V1, normalizeDetailSharpenEffectV1 } from '../common/editor/video-sharpen-v1.ts';
import { withDetailSharpenPixelFrameV1 } from '../common/editor/imaging/pixel-frame-sharpen-v1.ts';
import type { UnifiedExactRenderRgbaFrameV13 } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import { COLOR_WHEELS_EFFECT_TYPE_V1, normalizeColorWheelsEffectV1 } from '../common/editor/video-color-wheels-v1.ts';
import { withGlobalDevelopPixelFrameV1 } from '../common/editor/imaging/pixel-frame-global-develop-v1.ts';
import { isCurvesEffectTypeV1, normalizeCurvesEffectV1 } from '../common/editor/video-curves-v1.ts';
import { isGlobalDevelopEffectTypeV1, normalizeGlobalDevelopEffectV1 } from '../common/editor/video-global-develop-v1.ts';
import { CHROMA_DEVELOP_EFFECT_TYPE_V1, normalizeChromaDevelopEffectV1 } from '../common/editor/video-chroma-develop-v1.ts';
import { BLACK_WHITE_MIX_EFFECT_TYPE_V1, normalizeBlackWhiteMixEffectV1 } from '../common/editor/video-black-white-mix-v1.ts';
import { HSL_MIXER_EFFECT_TYPE_V1, normalizeHslMixerEffectV1 } from '../common/editor/video-hsl-mixer-v1.ts';
import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1, normalizeImageGeometryVideoEffectV1 } from '../common/editor/video-image-geometry-v1.ts';
import { withGeometryPixelFrameV1 } from '../common/editor/imaging/pixel-frame-geometry-v1.ts';
import { admitPixelFrameV1 } from '../common/editor/imaging/pixel-frame-admission-v1.ts';
import { normalizeVideoEffect, videoEffectDefinition, VIDEO_EFFECT_TYPES } from '../common/editor/video-effects.js';
import { readPixelFrameV1 } from '../common/editor/imaging/pixel-frame-contract-v1.ts';
import { LENS_DISTORTION_EFFECT_TYPE_V1, normalizeLensDistortionEffectV1 } from '../common/editor/video-lens-distortion-v1.ts';
import { withLensDistortionPixelFrameV1 } from '../common/editor/imaging/pixel-frame-lens-distortion-v1.ts';
import { CHROMATIC_ABERRATION_EFFECT_TYPE_V1, normalizeChromaticAberrationEffectV1 } from '../common/editor/video-chromatic-aberration-v1.ts';
import { withChromaticAberrationPixelFrameV1 } from '../common/editor/imaging/pixel-frame-chromatic-aberration-v1.ts';

const CHECK_ABORT = AbortSignal.prototype.throwIfAborted;
const GEOMETRY_LIMITS = Object.freeze({ maximumSidePixels: 65_536, maximumPixels: 33_554_432, maximumBytes: 128 * 1024 * 1024 });

/** Execute maintained browser effects over straight RGBA without changing transfer encoding. */
export async function applyVideoExactBrowserEffectsFinishing(
	frame: UnifiedExactRenderRgbaFrameV13,
	effects: readonly unknown[],
	signal: AbortSignal,
): Promise<UnifiedExactRenderRgbaFrameV13> {
	throwIfAborted(signal);
	// A valid owning project is already bounded by the 100,000-node interchange ceiling.
	const admitted = readClosedDomainArray(effects, 'Frame browser effects', 0, 100_000).map(value => {
		const effect = readClosedDomainRecord(value, 'Frame browser effect', ['id', 'type', 'enabled', 'params']);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === CHROMATIC_ABERRATION_EFFECT_TYPE_V1) return normalizeChromaticAberrationEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === LENS_DISTORTION_EFFECT_TYPE_V1) return normalizeLensDistortionEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === POST_CROP_VIGNETTE_EFFECT_TYPE_V1) return normalizePostCropVignetteEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === CLARITY_EFFECT_TYPE_V1) return normalizeClarityEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === NOISE_REDUCTION_EFFECT_TYPE_V1) return normalizeNoiseReductionEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === GRAIN_EFFECT_TYPE_V1) return normalizeGrainEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === TEXTURE_EFFECT_TYPE_V1) return normalizeTextureEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === DEHAZE_EFFECT_TYPE_V1) return normalizeDehazeEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === COLOR_WHEELS_EFFECT_TYPE_V1) return normalizeColorWheelsEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === DETAIL_SHARPEN_EFFECT_TYPE_V1) return normalizeDetailSharpenEffectV1(value);
		if (isCurvesEffectTypeV1(readClosedDomainField(effect, 'type', 'Frame browser effect'))) return normalizeCurvesEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) return normalizeImageGeometryVideoEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === CHROMA_DEVELOP_EFFECT_TYPE_V1) return normalizeChromaDevelopEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === HSL_MIXER_EFFECT_TYPE_V1) return normalizeHslMixerEffectV1(value);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === BLACK_WHITE_MIX_EFFECT_TYPE_V1) return normalizeBlackWhiteMixEffectV1(value);
		return isGlobalDevelopEffectTypeV1(readClosedDomainField(effect, 'type', 'Frame browser effect'))
			? normalizeGlobalDevelopEffectV1(value) : readLegacyEffect(effect);
	});
	const sourceFrame = readAdmittedFrame(frame, signal);
	if (admitted.some(value => Object.getOwnPropertyDescriptor(value, 'type')?.value === CHROMATIC_ABERRATION_EFFECT_TYPE_V1 || Object.getOwnPropertyDescriptor(value, 'type')?.value === LENS_DISTORTION_EFFECT_TYPE_V1 || Object.getOwnPropertyDescriptor(value, 'type')?.value === DEHAZE_EFFECT_TYPE_V1 || Object.getOwnPropertyDescriptor(value, 'type')?.value === TEXTURE_EFFECT_TYPE_V1 || Object.getOwnPropertyDescriptor(value, 'type')?.value === GRAIN_EFFECT_TYPE_V1 || Object.getOwnPropertyDescriptor(value, 'type')?.value === NOISE_REDUCTION_EFFECT_TYPE_V1 || Object.getOwnPropertyDescriptor(value, 'type')?.value === POST_CROP_VIGNETTE_EFFECT_TYPE_V1 || Object.getOwnPropertyDescriptor(value, 'type')?.value === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 || Object.getOwnPropertyDescriptor(value, 'type')?.value === DETAIL_SHARPEN_EFFECT_TYPE_V1 || Object.getOwnPropertyDescriptor(value, 'type')?.value === CLARITY_EFFECT_TYPE_V1)) {
		let current = clone(sourceFrame);
		try {
			for (const effect of admitted) {
				throwIfAborted(signal);
				const chromatic = Object.getOwnPropertyDescriptor(effect, 'type')?.value === CHROMATIC_ABERRATION_EFFECT_TYPE_V1 ? normalizeChromaticAberrationEffectV1(effect) : null;
				if (chromatic && (!chromatic.enabled || chromatic.params.red === 0 && chromatic.params.blue === 0)) continue;
				const lens = Object.getOwnPropertyDescriptor(effect, 'type')?.value === LENS_DISTORTION_EFFECT_TYPE_V1 ? normalizeLensDistortionEffectV1(effect) : null;
				if (lens && (!lens.enabled || lens.params.amount === 0)) continue;
				const geometry = Object.getOwnPropertyDescriptor(effect, 'type')?.value === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1
					? normalizeImageGeometryVideoEffectV1(effect) : null;
				if (geometry && !geometry.enabled) continue;
				const detail = Object.getOwnPropertyDescriptor(effect, 'type')?.value === DETAIL_SHARPEN_EFFECT_TYPE_V1;
				const clarity = Object.getOwnPropertyDescriptor(effect, 'type')?.value === CLARITY_EFFECT_TYPE_V1;
				const noise = Object.getOwnPropertyDescriptor(effect, 'type')?.value === NOISE_REDUCTION_EFFECT_TYPE_V1;
				const grain = Object.getOwnPropertyDescriptor(effect, 'type')?.value === GRAIN_EFFECT_TYPE_V1;
				const texture = Object.getOwnPropertyDescriptor(effect, 'type')?.value === TEXTURE_EFFECT_TYPE_V1;
				const dehaze = Object.getOwnPropertyDescriptor(effect, 'type')?.value === DEHAZE_EFFECT_TYPE_V1;
				const vignette = Object.getOwnPropertyDescriptor(effect, 'type')?.value === POST_CROP_VIGNETTE_EFFECT_TYPE_V1;
				const next = chromatic ? await cloneScopedOutput(consume => withChromaticAberrationPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: current.width,
					height: current.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: current.pixels }, red: chromatic.params.red, blue: chromatic.params.blue, signal }, consume, { limits: GEOMETRY_LIMITS }))
					: lens ? await cloneScopedOutput(consume => withLensDistortionPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: current.width,
					height: current.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: current.pixels }, amount: lens.params.amount, signal }, consume, { limits: GEOMETRY_LIMITS }))
					: vignette ? await cloneScopedOutput(consume => withPostCropVignettePixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: current.width,
					height: current.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: current.pixels }, effect, signal }, consume, { limits: GEOMETRY_LIMITS })) : detail ? await cloneScopedOutput(consume => withDetailSharpenPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: current.width,
					height: current.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: current.pixels }, effect, signal }, consume, { limits: GEOMETRY_LIMITS }))
					: clarity ? await cloneScopedOutput(consume => withClarityPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: current.width,
						height: current.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: current.pixels }, effect, signal }, consume, { limits: GEOMETRY_LIMITS }))
					: noise ? await cloneScopedOutput(consume => withNoiseReductionPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: current.width,
						height: current.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: current.pixels }, effect, signal }, consume, { limits: GEOMETRY_LIMITS }))
					: grain ? await cloneScopedOutput(consume => withGrainPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: current.width,
						height: current.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: current.pixels }, effect, signal }, consume, { limits: GEOMETRY_LIMITS }))
					: texture ? await cloneScopedOutput(consume => withTexturePixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: current.width,
						height: current.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: current.pixels }, effect, signal }, consume, { limits: GEOMETRY_LIMITS }))
					: dehaze ? await cloneScopedOutput(consume => withDehazePixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: current.width,
						height: current.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: current.pixels }, effect, signal }, consume, { limits: GEOMETRY_LIMITS }))
					: geometry ? await cloneScopedOutput(consume => withGeometryPixelFrameV1({ frame: { descriptor: { schemaVersion: 1,
					width: current.width, height: current.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: current.pixels },
					geometry: imageGeometryForVideoEffectV1(geometry, current.width, current.height), signal },
					consume,
					{ limits: GEOMETRY_LIMITS,
						delivery: { width: current.width, height: current.height } })) : await applyVideoExactBrowserEffectsFinishing(current, [effect], signal);
				current.pixels.fill(0); current = next;
			}
			throwIfAborted(signal);
			return current;
		} catch (error) { current.pixels.fill(0); throw error; }
	}
	if (admitted.length === 0) return clone(sourceFrame);
	if (admitted.every(value => isCpuEffect(Object.getOwnPropertyDescriptor(value, 'type')?.value))) {
		return cloneScopedOutput(consume => withGlobalDevelopPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: sourceFrame.width, height: sourceFrame.height,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: sourceFrame.pixels }, effects: admitted, signal },
			consume,
			{ maximumEffects: 100_000, limits: { maximumSidePixels: 65_536, maximumPixels: 33_554_432, maximumBytes: 128 * 1024 * 1024 } }));
	}
	// Own bytes and settings before loading resources; capture native source
	// geometry once for every route, including empty and disabled recipes.
	const pixels = new Uint8Array(sourceFrame.pixels);
	try {
		const backend = await import('../common/editor/ui/video-preview-straight-rgba.ts');
		throwIfAborted(signal);
		return await backend.renderVideoPreviewStraightRgba({ width: sourceFrame.width, height: sourceFrame.height, pixels }, admitted, signal);
	} finally { pixels.fill(0); }
}

type ScopedFrame = Readonly<{ descriptor: Readonly<{ width: number; height: number }>; pixels: Uint8Array<ArrayBuffer> }>;
async function cloneScopedOutput(borrow: (consume: (frame: ScopedFrame) => UnifiedExactRenderRgbaFrameV13) => Promise<UnifiedExactRenderRgbaFrameV13>): Promise<UnifiedExactRenderRgbaFrameV13> {
	const owner: { pixels: Uint8Array<ArrayBuffer> | null } = { pixels: null };
	try {
		return await borrow(frame => {
			owner.pixels = frame.pixels.slice();
			return Object.freeze({ width: frame.descriptor.width, height: frame.descriptor.height, pixels: owner.pixels });
		});
	} catch (error) { owner.pixels?.fill(0); throw error; }
}

function clone(frame: UnifiedExactRenderRgbaFrameV13): UnifiedExactRenderRgbaFrameV13 {
	return Object.freeze({ width: frame.width, height: frame.height, pixels: frame.pixels.slice() });
}

function readAdmittedFrame(value: unknown, signal: AbortSignal): UnifiedExactRenderRgbaFrameV13 {
	const input = readClosedDomainRecord(value, 'Frame browser source', ['width', 'height', 'pixels']);
	const plan = admitPixelFrameV1({ schemaVersion: 1, width: readClosedDomainField(input, 'width', 'Frame browser source'),
		height: readClosedDomainField(input, 'height', 'Frame browser source'), sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, { limits: GEOMETRY_LIMITS });
	const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: readClosedDomainField(input, 'pixels', 'Frame browser source') }, GEOMETRY_LIMITS);
	throwIfAborted(signal);
	return Object.freeze({ width: plan.descriptor.width, height: plan.descriptor.height,
		pixels: new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, plan.byteLength) });
}

function throwIfAborted(signal: AbortSignal): void {
	Reflect.apply(CHECK_ABORT, signal, []);
}

function isCpuEffect(type: unknown): boolean { return type === COLOR_WHEELS_EFFECT_TYPE_V1 || isCurvesEffectTypeV1(type) || type === HSL_MIXER_EFFECT_TYPE_V1 || type === BLACK_WHITE_MIX_EFFECT_TYPE_V1 || type === CHROMA_DEVELOP_EFFECT_TYPE_V1 || isGlobalDevelopEffectTypeV1(type); }

function readLegacyEffect(effect: Record<string, unknown>) {
	const type = readClosedDomainField(effect, 'type', 'Frame browser effect');
	if (typeof type !== 'string' || !VIDEO_EFFECT_TYPES.includes(type)) throw new RangeError('Unsupported Frame browser effect.');
	const params = readClosedDomainRecord(readClosedDomainField(effect, 'params', 'Frame browser effect'),
		'Frame browser effect parameters', Object.keys(videoEffectDefinition(type).params), []);
	const captured = Object.fromEntries(Object.keys(params).map(key => [key, readClosedDomainField(params, key, 'Frame browser effect parameters')]));
	const normalized = normalizeVideoEffect({ id: readClosedDomainField(effect, 'id', 'Frame browser effect'), type,
		enabled: readClosedDomainField(effect, 'enabled', 'Frame browser effect'), params: captured });
	return Object.freeze({ ...normalized, params: Object.freeze(normalized.params) });
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { POST_CROP_VIGNETTE_EFFECT_TYPE_V1, POST_CROP_VIGNETTE_VIDEO_EFFECT_DEFINITION_V1, normalizePostCropVignetteEffectV1,
	normalizePostCropVignetteParamsV1, createPostCropVignetteEffectV1, serializePostCropVignetteEffectToFfmpegV1 } from './video-post-crop-vignette-v1.ts';
import { CLARITY_EFFECT_TYPE_V1, CLARITY_VIDEO_EFFECT_DEFINITION_V1, normalizeClarityEffectV1, normalizeClarityParamsV1, serializeClarityEffectToFfmpegV1 } from './video-clarity-v1.ts';
import { NOISE_REDUCTION_EFFECT_TYPE_V1, NOISE_REDUCTION_VIDEO_EFFECT_DEFINITION_V1, normalizeNoiseReductionEffectV1, normalizeNoiseReductionParamsV1 } from './video-noise-reduction-v1.ts';
import { serializeNoiseReductionEffectToFfmpegV1 } from './video-noise-reduction-ffmpeg-v1.ts';
import { createClosedVideoEffect } from './video-effect-closed-creation.ts';
import { GRAIN_EFFECT_TYPE_V1, GRAIN_VIDEO_EFFECT_DEFINITION_V1, normalizeGrainEffectV1, normalizeGrainParamsV1, serializeGrainEffectToFfmpegV1 } from './video-grain-v1.ts';
import { DETAIL_SHARPEN_EFFECT_TYPE_V1, DETAIL_SHARPEN_VIDEO_EFFECT_DEFINITION_V1, normalizeDetailSharpenEffectV1,
	normalizeDetailSharpenParamsV1, serializeDetailSharpenEffectToFfmpegV1 } from './video-sharpen-v1.ts';
import { TEXTURE_EFFECT_TYPE_V1, TEXTURE_VIDEO_EFFECT_DEFINITION_V1, normalizeTextureEffectV1, normalizeTextureParamsV1, createTextureEffectV1, serializeTextureEffectToFfmpegV1 } from './video-texture-v1.ts';
import { DEHAZE_EFFECT_TYPE_V1, DEHAZE_VIDEO_EFFECT_DEFINITION_V1, normalizeDehazeEffectV1, normalizeDehazeParamsV1 } from './video-dehaze-v1.ts';
import { serializeDehazeEffectToFfmpegV1 } from './video-dehaze-ffmpeg-v1.ts';
import { createStableId } from './stable-id.js';
import { COLOR_WHEELS_EFFECT_TYPE_V1, COLOR_WHEELS_VIDEO_EFFECT_DEFINITION_V1, normalizeColorWheelsEffectV1,
	normalizeColorWheelsParamsV1, serializeColorWheelsEffectToFfmpegV1 } from './video-color-wheels-v1.ts';
import { CURVES_VIDEO_EFFECT_DEFINITIONS_V1, normalizeCurvesEffectV1,
	normalizePointCurvesParamsV1, normalizeParametricCurvesParamsV1, serializeCurvesEffectToFfmpegV1 } from './video-curves-v1.ts';
import { GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1,
	normalizeGlobalDevelopEffectV1, normalizeGlobalDevelopParamsV1, serializeGlobalDevelopEffectToFfmpegV1 } from './video-global-develop-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, IMAGE_GEOMETRY_VIDEO_EFFECT_DEFINITION_V1,
	normalizeImageGeometryVideoEffectV1, normalizeImageGeometryVideoParamsV1 } from './video-image-geometry-v1.ts';
import { CHROMA_DEVELOP_EFFECT_TYPE_V1, CHROMA_DEVELOP_VIDEO_EFFECT_DEFINITION_V1,
	normalizeChromaDevelopEffectV1, normalizeChromaDevelopParamsV1, serializeChromaDevelopEffectToFfmpegV1 } from './video-chroma-develop-v1.ts';
import { HSL_MIXER_EFFECT_TYPE_V1, HSL_MIXER_VIDEO_EFFECT_DEFINITION_V1,
	normalizeHslMixerEffectV1, normalizeHslMixerParamsV1, serializeHslMixerEffectToFfmpegV1 } from './video-hsl-mixer-v1.ts';
import { BLACK_WHITE_MIX_EFFECT_TYPE_V1, BLACK_WHITE_MIX_VIDEO_EFFECT_DEFINITION_V1,
	normalizeBlackWhiteMixEffectV1, normalizeBlackWhiteMixParamsV1, serializeBlackWhiteMixEffectToFfmpegV1 } from './video-black-white-mix-v1.ts';
import { LENS_DISTORTION_EFFECT_TYPE_V1, LENS_DISTORTION_VIDEO_EFFECT_DEFINITION_V1, normalizeLensDistortionEffectV1,
	normalizeLensDistortionParamsV1, serializeLensDistortionEffectToFfmpegV1 } from './video-lens-distortion-v1.ts';
import { CHROMATIC_ABERRATION_EFFECT_TYPE_V1, CHROMATIC_ABERRATION_VIDEO_EFFECT_DEFINITION_V1, normalizeChromaticAberrationEffectV1,
	normalizeChromaticAberrationParamsV1, serializeChromaticAberrationEffectToFfmpegV1 } from './video-chromatic-aberration-v1.ts';
import { DEFRINGE_EFFECT_TYPE_V1, DEFRINGE_VIDEO_EFFECT_DEFINITION_V1, normalizeDefringeEffectV1,
	normalizeDefringeParamsV1, serializeDefringeEffectToFfmpegV1 } from './video-defringe-v1.ts';

import type { VideoEffectParameterV1 } from './video-curve-types-v1.ts';

interface Effect { readonly id:string; readonly type:string; readonly enabled:boolean; readonly params:Readonly<Record<string,VideoEffectParameterV1>> }
type Operation = Readonly<{expression:string;preserveAlpha:true;kind?:string}> | Readonly<{kind:'image-geometry-v1';effect:ReturnType<typeof normalizeImageGeometryVideoEffectV1>}>
	| NonNullable<ReturnType<typeof serializeLensDistortionEffectToFfmpegV1>> | NonNullable<ReturnType<typeof serializeChromaticAberrationEffectToFfmpegV1>>
	| NonNullable<ReturnType<typeof serializeDefringeEffectToFfmpegV1>>;
interface Family { readonly params:(value:unknown)=>Effect['params']; readonly effect:(value:unknown)=>Effect;
	readonly serialize:(value:unknown)=>Operation|null; readonly create?: (value:unknown)=>Effect }

/** Fixed ownership only: persistence versions and legacy envelope order stay in
 * video-effects. No caller registry/profile or render-time lookup is retained. */
export const CLOSED_VIDEO_EFFECT_DEFINITIONS_V1 = Object.freeze({
	...GLOBAL_DEVELOP_VIDEO_EFFECT_DEFINITIONS_V1,
	[IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1]:IMAGE_GEOMETRY_VIDEO_EFFECT_DEFINITION_V1,
	[CHROMA_DEVELOP_EFFECT_TYPE_V1]:CHROMA_DEVELOP_VIDEO_EFFECT_DEFINITION_V1,
	[BLACK_WHITE_MIX_EFFECT_TYPE_V1]:BLACK_WHITE_MIX_VIDEO_EFFECT_DEFINITION_V1,
	[HSL_MIXER_EFFECT_TYPE_V1]:HSL_MIXER_VIDEO_EFFECT_DEFINITION_V1,
	...CURVES_VIDEO_EFFECT_DEFINITIONS_V1,
	[COLOR_WHEELS_EFFECT_TYPE_V1]:COLOR_WHEELS_VIDEO_EFFECT_DEFINITION_V1,
	[DETAIL_SHARPEN_EFFECT_TYPE_V1]:DETAIL_SHARPEN_VIDEO_EFFECT_DEFINITION_V1,
	[POST_CROP_VIGNETTE_EFFECT_TYPE_V1]:POST_CROP_VIGNETTE_VIDEO_EFFECT_DEFINITION_V1,
	[CLARITY_EFFECT_TYPE_V1]:CLARITY_VIDEO_EFFECT_DEFINITION_V1,
	[NOISE_REDUCTION_EFFECT_TYPE_V1]:NOISE_REDUCTION_VIDEO_EFFECT_DEFINITION_V1,
	[GRAIN_EFFECT_TYPE_V1]:GRAIN_VIDEO_EFFECT_DEFINITION_V1,
	[TEXTURE_EFFECT_TYPE_V1]:TEXTURE_VIDEO_EFFECT_DEFINITION_V1,
	[DEHAZE_EFFECT_TYPE_V1]:DEHAZE_VIDEO_EFFECT_DEFINITION_V1,
	[LENS_DISTORTION_EFFECT_TYPE_V1]:LENS_DISTORTION_VIDEO_EFFECT_DEFINITION_V1,
	[CHROMATIC_ABERRATION_EFFECT_TYPE_V1]:CHROMATIC_ABERRATION_VIDEO_EFFECT_DEFINITION_V1,
	[DEFRINGE_EFFECT_TYPE_V1]:DEFRINGE_VIDEO_EFFECT_DEFINITION_V1,
});

const FAMILIES = Object.freeze({
	[DEFRINGE_EFFECT_TYPE_V1]:{params:normalizeDefringeParamsV1,effect:normalizeDefringeEffectV1,serialize:serializeDefringeEffectToFfmpegV1,
		create:(value:unknown)=>createClosedVideoEffect(DEFRINGE_EFFECT_TYPE_V1,value,{name:'defringe creation',typeError:'Defringe creation requires its exact effect type.',normalizeParams:normalizeDefringeParamsV1,normalizeEffect:normalizeDefringeEffectV1})},
	[CHROMATIC_ABERRATION_EFFECT_TYPE_V1]:{params:normalizeChromaticAberrationParamsV1,effect:normalizeChromaticAberrationEffectV1,serialize:serializeChromaticAberrationEffectToFfmpegV1,
		create:(value:unknown)=>createClosedVideoEffect(CHROMATIC_ABERRATION_EFFECT_TYPE_V1,value,{name:'chromatic aberration creation',typeError:'Chromatic aberration creation requires its exact effect type.',normalizeParams:normalizeChromaticAberrationParamsV1,normalizeEffect:normalizeChromaticAberrationEffectV1})},
	[LENS_DISTORTION_EFFECT_TYPE_V1]:{params:normalizeLensDistortionParamsV1,effect:normalizeLensDistortionEffectV1,serialize:serializeLensDistortionEffectToFfmpegV1,
		create:(value:unknown)=>createClosedVideoEffect(LENS_DISTORTION_EFFECT_TYPE_V1,value,{name:'lens distortion creation',typeError:'Lens distortion creation requires its exact effect type.',normalizeParams:normalizeLensDistortionParamsV1,normalizeEffect:normalizeLensDistortionEffectV1})},
	'white-balance-v1':{params:(value:unknown)=>normalizeGlobalDevelopParamsV1('white-balance-v1',value),effect:normalizeGlobalDevelopEffectV1,serialize:serializeGlobalDevelopEffectToFfmpegV1},
	'tone-ladder-v1':{params:(value:unknown)=>normalizeGlobalDevelopParamsV1('tone-ladder-v1',value),effect:normalizeGlobalDevelopEffectV1,serialize:serializeGlobalDevelopEffectToFfmpegV1},
	[IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1]:{params:normalizeImageGeometryVideoParamsV1,effect:normalizeImageGeometryVideoEffectV1,
		serialize:(value:unknown)=>({kind:'image-geometry-v1' as const,effect:normalizeImageGeometryVideoEffectV1(value)})},
	[CHROMA_DEVELOP_EFFECT_TYPE_V1]:{params:normalizeChromaDevelopParamsV1,effect:normalizeChromaDevelopEffectV1,serialize:serializeChromaDevelopEffectToFfmpegV1},
	[BLACK_WHITE_MIX_EFFECT_TYPE_V1]:{params:normalizeBlackWhiteMixParamsV1,effect:normalizeBlackWhiteMixEffectV1,serialize:serializeBlackWhiteMixEffectToFfmpegV1},
	[HSL_MIXER_EFFECT_TYPE_V1]:{params:normalizeHslMixerParamsV1,effect:normalizeHslMixerEffectV1,serialize:serializeHslMixerEffectToFfmpegV1},
	'point-curves-v1':{params:normalizePointCurvesParamsV1,effect:normalizeCurvesEffectV1,serialize:serializeCurvesEffectToFfmpegV1},
	'parametric-curves-v1':{params:normalizeParametricCurvesParamsV1,effect:normalizeCurvesEffectV1,serialize:serializeCurvesEffectToFfmpegV1},
	[COLOR_WHEELS_EFFECT_TYPE_V1]:{params:normalizeColorWheelsParamsV1,effect:normalizeColorWheelsEffectV1,serialize:serializeColorWheelsEffectToFfmpegV1,
		create:(value:unknown)=>createClosedVideoEffect(COLOR_WHEELS_EFFECT_TYPE_V1,value,{name:'color wheel creation',typeError:'Color wheel creation requires its exact effect type.',normalizeParams:normalizeColorWheelsParamsV1,normalizeEffect:normalizeColorWheelsEffectV1})},
	[DETAIL_SHARPEN_EFFECT_TYPE_V1]:{params:normalizeDetailSharpenParamsV1,effect:normalizeDetailSharpenEffectV1,serialize:serializeDetailSharpenEffectToFfmpegV1,
		create:(value:unknown)=>createClosedVideoEffect(DETAIL_SHARPEN_EFFECT_TYPE_V1,value,{name:'detail sharpening creation',typeError:'Detail sharpening creation requires its exact effect type.',normalizeParams:normalizeDetailSharpenParamsV1,normalizeEffect:normalizeDetailSharpenEffectV1})},
	[POST_CROP_VIGNETTE_EFFECT_TYPE_V1]:{params:normalizePostCropVignetteParamsV1,effect:normalizePostCropVignetteEffectV1,serialize:serializePostCropVignetteEffectToFfmpegV1,
		create:(value:unknown)=>createPostCropVignetteEffectV1(value,()=>createStableId('video-effect'))},
	[CLARITY_EFFECT_TYPE_V1]:{params:normalizeClarityParamsV1,effect:normalizeClarityEffectV1,serialize:serializeClarityEffectToFfmpegV1,
		create:(value:unknown)=>createClosedVideoEffect(CLARITY_EFFECT_TYPE_V1,value,{name:'clarity creation',typeError:'Clarity creation requires its exact effect type.',normalizeParams:normalizeClarityParamsV1,normalizeEffect:normalizeClarityEffectV1})},
	[NOISE_REDUCTION_EFFECT_TYPE_V1]:{params:normalizeNoiseReductionParamsV1,effect:normalizeNoiseReductionEffectV1,serialize:serializeNoiseReductionEffectToFfmpegV1,
		create:(value:unknown)=>createClosedVideoEffect(NOISE_REDUCTION_EFFECT_TYPE_V1,value,{name:'noise reduction creation',typeError:'Noise reduction creation requires its exact effect type.',normalizeParams:normalizeNoiseReductionParamsV1,normalizeEffect:normalizeNoiseReductionEffectV1})},
	[GRAIN_EFFECT_TYPE_V1]:{params:normalizeGrainParamsV1,effect:normalizeGrainEffectV1,serialize:serializeGrainEffectToFfmpegV1,
		create:(value:unknown)=>createClosedVideoEffect(GRAIN_EFFECT_TYPE_V1,value,{name:'grain creation',typeError:'Grain creation requires its exact effect type.',normalizeParams:normalizeGrainParamsV1,normalizeEffect:normalizeGrainEffectV1})},
	[TEXTURE_EFFECT_TYPE_V1]:{params:normalizeTextureParamsV1,effect:normalizeTextureEffectV1,serialize:serializeTextureEffectToFfmpegV1,
		create:(value:unknown)=>createTextureEffectV1(value,()=>createStableId('video-effect'))},
	[DEHAZE_EFFECT_TYPE_V1]:{params:normalizeDehazeParamsV1,effect:normalizeDehazeEffectV1,serialize:serializeDehazeEffectToFfmpegV1,
		create:(value:unknown)=>createClosedVideoEffect(DEHAZE_EFFECT_TYPE_V1,value,{name:'dehaze creation',typeError:'Dehaze creation requires its exact effect type.',normalizeParams:normalizeDehazeParamsV1,normalizeEffect:normalizeDehazeEffectV1})},
} satisfies Record<string,Family>);

export function isClosedVideoEffectTypeV1(value:unknown):value is keyof typeof FAMILIES { return typeof value==='string' && Object.hasOwn(FAMILIES,value); }
function family(type:string):Family {
	if(!isClosedVideoEffectTypeV1(type))throw new RangeError('Unsupported closed video effect family.');
	return FAMILIES[type];
}
/** Complete closed envelopes bypass legacy prechecks; older families retain them. */
export function hasClosedVideoEffectEnvelopeV1(value:unknown):value is string { return isClosedVideoEffectTypeV1(value) && Boolean(family(value).create); }
export function normalizeClosedVideoEffectParamsV1(type:string,value:unknown) { return {...family(type).params(value)}; }
export function normalizeClosedVideoEffectV1(type:string,value:unknown) {
	const normalized=family(type).effect(value); return {...normalized,params:{...normalized.params}};
}
/** Older families and legacy effects retain wrapper-owned creation ordering. */
export function createClosedVideoEffectFamilyV1(type:string,value:unknown) {
	if(!isClosedVideoEffectTypeV1(type))return null;
	const create=family(type).create;if(!create)return null;
	const normalized=create(value);return {...normalized,params:{...normalized.params}};
}
export function serializeClosedVideoEffectV1(type:string,value:unknown) {
	const operation=family(type).serialize(value);return operation?[operation]:[];
}

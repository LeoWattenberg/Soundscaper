/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeImageDevelopStateCurrentV1 } from './image-develop-state-current-v1.ts';
import { normalizeImageDevelopStateV2 } from './image-develop-state-v2.ts';
import { captureImageDevelopFrameProfileV3 } from './image-develop-frame-owned-pixels-v1.ts';
import type { ImageDevelopFrameProfile } from './image-develop-frame-core.ts';
import type { ImageDevelopFrameOptionsV3 } from './image-develop-frame-v3.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { planPixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { captureLinearKernelDescriptorV1, type LinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import { prepareImageDevelopBrushMasksCurrentV1 } from './image-develop-mask-plan-current-v1.ts';
import { prepareImageDevelopMaskOverlaySelectionV1 } from './image-develop-mask-overlay-v1.ts';
import { captureMaskRasterSourceV1 } from './mask-raster-source-scope-v1.ts';
import { captureCubeLutSourceV1 } from './cube-lut-source-scope-v1.ts';
import { prepareCubeLutProfileResourcePlanV1, cubeLutProfileResourceRequirementV1 } from '../video-cube-lut-profile-v1.ts';
import { imageGeometryForVideoEffectV1 } from '../video-image-geometry-v1.ts';
import { planImageGeometryV1 } from './image-geometry-plan-v1.ts';
import { normalizeImageGeometryV1, type ImageGeometryV1 } from './image-geometry-v1.ts';
import { planImageDevelopRepairSpotsV1 } from './image-develop-repair-plan-v1.ts';
import { prepareDetailSharpenEffectV1 } from '../video-sharpen-v1.ts';
import { prepareClarityEffectV1 } from '../video-clarity-v1.ts';
import { prepareNoiseReductionEffectV1 } from '../video-noise-reduction-v1.ts';
import { prepareGrainEffectV1 } from '../video-grain-v1.ts';
import { prepareTextureEffectV1 } from '../video-texture-v1.ts';
import { prepareDehazeEffectV1 } from '../video-dehaze-v1.ts';
import { preparePostCropVignetteEffectV1 } from '../video-post-crop-vignette-v1.ts';
import { LENS_DISTORTION_EFFECT_TYPE_V1, prepareLensDistortionEffectV1 } from '../video-lens-distortion-v1.ts';
import { CHROMATIC_ABERRATION_EFFECT_TYPE_V1, prepareChromaticAberrationEffectV1 } from '../video-chromatic-aberration-v1.ts';
import { DEFRINGE_EFFECT_TYPE_V1, prepareDefringeEffectV1 } from '../video-defringe-v1.ts';

export const CURRENT_LINEAR_WORKING_BYTES_V1 = 768 * 1024 * 1024;
const PROFILES = ['unorm16', 'float32'].flatMap(sampleFormat => ['srgb', 'bt709'].map(primaries => ({ sampleFormat, primaries, transfer: 'linear' })));
const PROXY_PROFILES = [...PROFILES, { sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }];
const COLORS = new Set(['white-balance-v1', 'tone-ladder-v1', 'chroma-v1', 'black-white-mix-v1', 'hsl-mixer-v1', 'point-curves-v1', 'parametric-curves-v1', 'color-wheels-v1']);
type Effect = ReturnType<typeof normalizeImageDevelopStateCurrentV1>['effects'][number];
type Reference = NonNullable<ReturnType<typeof cubeLutProfileResourceRequirementV1>>;
export type LinearDevelopMetadataStageCurrentV1 = Readonly<{ kind: 'geometry'; geometry: Readonly<ImageGeometryV1>; descriptor: LinearKernelDescriptorV1 }>
	| Readonly<{ kind: 'lens-distortion'; amount: number }>
	| Readonly<{ kind: 'chromatic-aberration'; id: string; red: number; blue: number }>
	| Readonly<{ kind: 'defringe'; effect: Effect; active: boolean }>
	| Readonly<{ kind: 'spatial'; effect: Effect; active: boolean }>
	| Readonly<{ kind: 'color'; effect: Effect }>
	| Readonly<{ kind: 'lut'; id: string; reference: Reference }>
	| Readonly<{ kind: 'noop'; id: string }>;

/** The single scalar phase plan serves eager Frame admission and lazy native
 * execution. It imports no native writer or executable prepared identity and
 * never reads source pixels or resource bodies. */
export function prepareLinearDevelopMetadataCurrentV1(value: unknown, profileValue: ImageDevelopFrameProfile, optionsValue: ImageDevelopFrameOptionsV3) {
	return prepareDevelopMetadata(value, profileValue, optionsValue, false);
}

/** Proxy admission shares the complete recipe/resource plan. Encoded byte
 * execution is conservatively charged as Float32 without converting pixels. */
export function prepareDevelopProxyMetadataCurrentV1(value: unknown, profileValue: ImageDevelopFrameProfile, optionsValue: ImageDevelopFrameOptionsV3) {
	return prepareDevelopMetadata(value, profileValue, optionsValue, true);
}

function prepareDevelopMetadata(value: unknown, profileValue: ImageDevelopFrameProfile, optionsValue: ImageDevelopFrameOptionsV3, proxy: boolean) {
	const input = record(value, 'Current linear Develop', ['frame', 'develop', 'signal', 'maskOverlay'], ['frame', 'develop']);
	const develop = normalizeImageDevelopStateCurrentV1(field(input, 'develop', 'Current linear Develop'));
	const profile = captureImageDevelopFrameProfileV3(profileValue);
	const options = record(optionsValue, 'Current linear resource options', ['source', 'maskSource'], []);
	const raw = field(input, 'frame', 'Current linear Develop');
	if (typeof raw !== 'object' || raw === null) throw new TypeError('Current linear Develop requires a source frame.');
	const sourcePlan = admitPixelFrameV1(field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'Current linear source'), { profiles: proxy ? PROXY_PROFILES : PROFILES, limits: profile.source });
	const descriptor = captureLinearKernelDescriptorV1({ ...sourcePlan.descriptor, sampleFormat: 'float32', transfer: 'linear' });
	planPixelFrameV1(descriptor, profile.render);
	const selection = Object.hasOwn(input, 'maskOverlay') ? prepareImageDevelopMaskOverlaySelectionV1(field(input, 'maskOverlay', 'Current linear Develop')) : undefined;
	const projection = normalizeImageDevelopStateV2({ processVersion: 2, effects: develop.effects, geometry: develop.geometry, masks: develop.masks, maskBindings: develop.maskBindings });
	const masks = prepareImageDevelopBrushMasksCurrentV1(projection, descriptor.width, descriptor.height, profile.render, selection);
	const maskSource = Object.hasOwn(options, 'maskSource') ? captureMaskRasterSourceV1(field(options, 'maskSource', 'Current linear resource options')) : undefined;
	if (masks.references.length && !maskSource) throw new RangeError('Native brush masks require authenticated source authority.');
	const selectedBinding = selection && masks.plan.bindings.find(binding => binding.maskId === selection.maskId && binding.effectId === selection.effectId);
	const repairPlan = develop.processVersion === 3 ? planImageDevelopRepairSpotsV1(develop.repairs, descriptor.width, descriptor.height) : undefined;
	const repairs = develop.processVersion === 3 && develop.repairs.spots.some(spot => spot.enabled && spot.opacity > 0) ? repairPlan : undefined;
	const stages: LinearDevelopMetadataStageCurrentV1[] = [];
	let current = descriptor, peak = sourcePlan.byteLength + descriptor.width * descriptor.height * 16 + masks.peakWorkingBytes;
	const charge = (nextBytes: number, scratch = 0) => {
		peak = Math.max(peak, sourcePlan.byteLength + current.width * current.height * 16 + nextBytes + scratch + masks.peakWorkingBytes);
	};
	if (repairs) charge(descriptor.width * descriptor.height * 16, repairs.maximumScratchBytes);
	const geometry = (value: unknown) => {
		const input = record(value, 'linear image geometry', ['schemaVersion', 'crop', 'rotationDegrees', 'flipHorizontal', 'flipVertical', 'perspective'], ['crop', 'rotationDegrees', 'flipHorizontal', 'flipVertical']);
		const geometry = Object.hasOwn(input, 'schemaVersion') ? normalizeImageGeometryV1(input) : normalizeImageGeometryV1({ schemaVersion: 1,
			crop: field(input, 'crop', 'linear image geometry'), rotationDegrees: field(input, 'rotationDegrees', 'linear image geometry'),
			flipHorizontal: field(input, 'flipHorizontal', 'linear image geometry'), flipVertical: field(input, 'flipVertical', 'linear image geometry'), perspective: null });
		const mapping = planImageGeometryV1(geometry, current.width, current.height);
		const output = captureLinearKernelDescriptorV1({ ...current, width: mapping.width, height: mapping.height });
		const allocation = planPixelFrameV1(output, profile.render); charge(allocation.byteLength);
		stages.push(Object.freeze({ kind: 'geometry', geometry, descriptor: output })); current = output;
	};
	const legacy = develop.geometry;
	if (legacy.crop !== null || legacy.rotationDegrees !== 0 || legacy.flipHorizontal || legacy.flipVertical) geometry(legacy);
	let source: ReturnType<typeof captureCubeLutSourceV1> | undefined;
	for (const effect of develop.effects) {
		if (effect.type === DEFRINGE_EFFECT_TYPE_V1) {
			const defringe = prepareDefringeEffectV1(effect), active = defringe.enabled && !defringe.neutral;
			if (active) charge(current.width * current.height * 16);
			stages.push(Object.freeze({ kind: 'defringe', effect, active }));
		} else if (effect.type === CHROMATIC_ABERRATION_EFFECT_TYPE_V1) {
			const correction = prepareChromaticAberrationEffectV1(effect);
			if (correction.enabled && !correction.neutral) {
				charge(current.width * current.height * 16);
				stages.push(Object.freeze({ kind: 'chromatic-aberration', id: correction.id, red: correction.red, blue: correction.blue }));
			} else stages.push(Object.freeze({ kind: 'noop', id: correction.id }));
		} else if (effect.type === LENS_DISTORTION_EFFECT_TYPE_V1) {
			const lens = prepareLensDistortionEffectV1(effect);
			if (lens.enabled && !lens.neutral) { charge(current.width * current.height * 16); stages.push(Object.freeze({ kind: 'lens-distortion', amount: lens.amount })); }
			else stages.push(Object.freeze({ kind: 'noop', id: lens.id }));
		} else if (effect.type === 'develop-geometry-v1') {
			if (effect.enabled) geometry(imageGeometryForVideoEffectV1(effect, current.width, current.height));
		} else if (effect.type === 'cube-lut-profile-v1') {
			const reference = cubeLutProfileResourceRequirementV1(prepareCubeLutProfileResourcePlanV1(effect));
			if (reference) {
				source ??= captureCubeLutSourceV1(field(options, 'source', 'Current linear LUT source'));
				charge(current.width * current.height * 16, 128 * 1024 * 1024 + reference.byteLength * 2);
				stages.push(Object.freeze({ kind: 'lut', id: effect.id, reference }));
			} else stages.push(Object.freeze({ kind: 'noop', id: effect.id }));
		} else {
			const spatial = prepareSpatialMetadata(effect);
			if (spatial) {
				const active = spatial.enabled && !spatial.neutral; if (active) charge(current.width * current.height * 16);
				stages.push(Object.freeze({ kind: 'spatial', effect, active }));
			} else {
				if (!COLORS.has(effect.type)) {
					if (sourcePlan.descriptor.sampleFormat !== 'unorm8' || effect.enabled) throw new RangeError('Unsupported linear color develop family.');
					stages.push(Object.freeze({ kind: 'noop', id: effect.id })); continue;
				}
				if (masks.plan.bindings.some(binding => binding.effectId === effect.id)) charge(current.width * current.height * 16);
				stages.push(Object.freeze({ kind: 'color', effect }));
			}
		}
	}
	charge(current.width * current.height * 4 + Math.min(current.width * current.height, 4_194_304) * 4);
	if (peak > CURRENT_LINEAR_WORKING_BYTES_V1) throw new RangeError('Current linear Develop exceeds its 768 MiB working byte budget.');
	return Object.freeze({ raw, develop, profile, sourcePlan, descriptor, repairs, stages: Object.freeze(stages), finalDescriptor: current,
		masks, maskSource, selectedBinding, source, peakWorkingBytes: peak });
}
function prepareSpatialMetadata(effect: Effect) {
	switch (effect.type) {
		case 'detail-sharpen-v1': return prepareDetailSharpenEffectV1(effect);
		case 'clarity-v1': return prepareClarityEffectV1(effect);
		case 'noise-reduction-v1': return prepareNoiseReductionEffectV1(effect);
		case 'grain-v1': return prepareGrainEffectV1(effect);
		case 'texture-v1': return prepareTextureEffectV1(effect);
		case 'dehaze-v1': return prepareDehazeEffectV1(effect);
		case 'post-crop-vignette-v1': return preparePostCropVignetteEffectV1(effect);
		default: return undefined;
	}
}

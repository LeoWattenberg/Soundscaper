/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeImageDevelopStateCurrentV1 } from './image-develop-state-current-v1.ts';
import { normalizeImageDevelopStateV2 } from './image-develop-state-v2.ts';
import { captureImageDevelopFrameProfileV3 } from './image-develop-frame-owned-pixels-v1.ts';
import type { ImageDevelopFrameProfile } from './image-develop-frame-core.ts';
import type { ImageDevelopFrameOptionsV3 } from './image-develop-frame-v3.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { planPixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { prepareLinearColorEffectsV1 } from './pixel-frame-linear-color-v1.ts';
import { prepareLinearGeometryV1 } from './pixel-frame-linear-geometry-v1.ts';
import { prepareLinearSpatialEffectV1 } from './pixel-frame-linear-spatial-v1.ts';
import { prepareLinearRepairsV1 } from './pixel-frame-linear-repair-v1.ts';
import { captureLinearKernelDescriptorV1 } from './linear-kernel-planes-v1.ts';
import { prepareImageDevelopBrushMasksV1 } from './image-develop-brush-mask-v1.ts';
import { prepareImageDevelopMaskOverlaySelectionV1 } from './image-develop-mask-overlay-v1.ts';
import { captureMaskRasterSourceV1 } from './mask-raster-source-scope-v1.ts';
import { captureCubeLutSourceV1 } from './cube-lut-source-scope-v1.ts';
import { prepareCubeLutProfileResourcePlanV1, cubeLutProfileResourceRequirementV1 } from '../video-cube-lut-profile-v1.ts';
import { normalizeVideoColorGradeV1 } from '../video-color-management-v27.ts';
import { imageGeometryForVideoEffectV1 } from '../video-image-geometry-v1.ts';

export const CURRENT_LINEAR_WORKING_BYTES_V1 = 768 * 1024 * 1024;
const SPATIAL = new Set(['post-crop-vignette-v1', 'clarity-v1', 'noise-reduction-v1', 'grain-v1', 'texture-v1', 'dehaze-v1', 'detail-sharpen-v1']);
const PROFILES = ['unorm16', 'float32'].flatMap(sampleFormat => ['srgb', 'bt709'].map(primaries => ({ sampleFormat, primaries, transfer: 'linear' })));
type Geometry = ReturnType<typeof prepareLinearGeometryV1>;
type Spatial = ReturnType<typeof prepareLinearSpatialEffectV1>;
type Color = ReturnType<typeof prepareLinearColorEffectsV1>;
type Reference = NonNullable<ReturnType<typeof cubeLutProfileResourceRequirementV1>>;
export type LinearDevelopStageV1 = Readonly<{ kind: 'geometry'; plan: Geometry }>
	| Readonly<{ kind: 'spatial'; id: string; plan: Spatial }>
	| Readonly<{ kind: 'color'; id: string; effects: Color }>
	| Readonly<{ kind: 'lut'; id: string; reference: Reference; grade: ReturnType<typeof normalizeVideoColorGradeV1> }>
	| Readonly<{ kind: 'noop'; id: string }>;

/** Complete closed recipe, resources and simultaneous native plane budget are
 * planned before the frame's pixels property is admitted. The original single
 * plane foundation keeps its separate 512 MiB contract. */
export function prepareLinearDevelopCurrentV1(value: unknown, profileValue: ImageDevelopFrameProfile, optionsValue: ImageDevelopFrameOptionsV3) {
	const input = record(value, 'Current linear Develop', ['frame', 'develop', 'signal', 'maskOverlay'], ['frame', 'develop']);
	const develop = normalizeImageDevelopStateCurrentV1(field(input, 'develop', 'Current linear Develop'));
	const profile = captureImageDevelopFrameProfileV3(profileValue);
	const options = record(optionsValue, 'Current linear resource options', ['source', 'maskSource'], []);
	const raw = field(input, 'frame', 'Current linear Develop');
	if (typeof raw !== 'object' || raw === null) throw new TypeError('Current linear Develop requires a source frame.');
	const sourcePlan = admitPixelFrameV1(field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'Current linear source'), { profiles: PROFILES, limits: profile.source });
	const descriptor = captureLinearKernelDescriptorV1({ ...sourcePlan.descriptor, sampleFormat: 'float32' });
	planPixelFrameV1(descriptor, profile.render);
	const selection = Object.hasOwn(input, 'maskOverlay') ? prepareImageDevelopMaskOverlaySelectionV1(field(input, 'maskOverlay', 'Current linear Develop')) : undefined;
	const projection = normalizeImageDevelopStateV2({ processVersion: 2, effects: develop.effects, geometry: develop.geometry, masks: develop.masks, maskBindings: develop.maskBindings });
	const masks = prepareImageDevelopBrushMasksV1(projection, descriptor.width, descriptor.height, profile.render, selection);
	const maskSource = Object.hasOwn(options, 'maskSource') ? captureMaskRasterSourceV1(field(options, 'maskSource', 'Current linear resource options')) : undefined;
	if (masks.references.length && !maskSource) throw new RangeError('Native brush masks require authenticated source authority.');
	const selectedBinding = selection && masks.plan.bindings.find(binding => binding.maskId === selection.maskId && binding.effectId === selection.effectId);
	const repairPlan = develop.processVersion === 3 ? prepareLinearRepairsV1(develop.repairs, descriptor, profile.render) : undefined;
	const repairs = develop.processVersion === 3 && develop.repairs.spots.some(spot => spot.enabled && spot.opacity > 0) ? repairPlan : undefined;
	const stages: LinearDevelopStageV1[] = [];
	let current = descriptor, peak = sourcePlan.byteLength + descriptor.width * descriptor.height * 16 + masks.peakWorkingBytes;
	const charge = (nextBytes: number, scratch = 0) => {
		peak = Math.max(peak, sourcePlan.byteLength + current.width * current.height * 16 + nextBytes + scratch + masks.peakWorkingBytes);
	};
	if (repairs) charge(repairs.frameBytes, repairs.scratchBytes);
	const geometry = (value: unknown) => {
		const plan = prepareLinearGeometryV1(value, current, profile.render); charge(plan.byteLength);
		stages.push(Object.freeze({ kind: 'geometry', plan })); current = plan.descriptor;
	};
	const legacy = develop.geometry;
	if (legacy.crop !== null || legacy.rotationDegrees !== 0 || legacy.flipHorizontal || legacy.flipVertical) geometry(legacy);
	let source: ReturnType<typeof captureCubeLutSourceV1> | undefined;
	for (const effect of develop.effects) {
		if (effect.type === 'develop-geometry-v1') {
			if (effect.enabled) geometry(imageGeometryForVideoEffectV1(effect, current.width, current.height));
		} else if (SPATIAL.has(effect.type)) {
			const plan = prepareLinearSpatialEffectV1(effect, current);
			if (plan.enabled && !plan.neutral) { charge(current.width * current.height * 16, plan.scratchBytes); stages.push(Object.freeze({ kind: 'spatial', id: effect.id, plan })); }
			else stages.push(Object.freeze({ kind: 'noop', id: effect.id }));
		} else if (effect.type === 'cube-lut-profile-v1') {
			const reference = cubeLutProfileResourceRequirementV1(prepareCubeLutProfileResourcePlanV1(effect));
			if (reference) {
				source ??= captureCubeLutSourceV1(field(options, 'source', 'Current linear LUT source'));
				// Parser text/array residency is an explicit conservative reserve,
				// not an exact bound on engine-specific JavaScript object overhead.
				charge(current.width * current.height * 16, 128 * 1024 * 1024 + reference.byteLength * 2);
				stages.push(Object.freeze({ kind: 'lut', id: effect.id, reference, grade: normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), lut: reference }) }));
			} else stages.push(Object.freeze({ kind: 'noop', id: effect.id }));
		} else {
			const effects = prepareLinearColorEffectsV1([effect]);
			if (masks.plan.bindings.some(binding => binding.effectId === effect.id)) charge(current.width * current.height * 16);
			stages.push(Object.freeze({ kind: 'color', id: effect.id, effects }));
		}
	}
	// Display histogram is retired before downstream presentation begins.
	charge(current.width * current.height * 4 + Math.min(current.width * current.height, 4_194_304) * 4);
	if (peak > CURRENT_LINEAR_WORKING_BYTES_V1) throw new RangeError('Current linear Develop exceeds its 768 MiB working byte budget.');
	return { raw, profile, sourcePlan, descriptor, repairs, stages: Object.freeze(stages), masks, maskSource, selectedBinding, source, peakWorkingBytes: peak };
}

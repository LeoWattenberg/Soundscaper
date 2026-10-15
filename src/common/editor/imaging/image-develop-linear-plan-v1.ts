/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopFrameProfile } from './image-develop-frame-core.ts';
import type { ImageDevelopFrameOptionsV3 } from './image-develop-frame-v3.ts';
import { prepareLinearColorEffectsV1 } from './pixel-frame-linear-color-v1.ts';
import { prepareLinearGeometryV1 } from './pixel-frame-linear-geometry-v1.ts';
import { prepareLinearSpatialEffectV1 } from './pixel-frame-linear-spatial-v1.ts';
import { prepareLinearRepairsV1 } from './pixel-frame-linear-repair-v1.ts';
import { prepareLinearLensDistortionV1 } from './pixel-frame-linear-lens-distortion-v1.ts';
import type { cubeLutProfileResourceRequirementV1 } from '../video-cube-lut-profile-v1.ts';
import { normalizeVideoColorGradeV1 } from '../video-color-management-v27.ts';
import { prepareLinearDevelopMetadataCurrentV1 } from './image-develop-linear-metadata-current-v1.ts';

export { CURRENT_LINEAR_WORKING_BYTES_V1 } from './image-develop-linear-metadata-current-v1.ts';
type Geometry = ReturnType<typeof prepareLinearGeometryV1>;
type Spatial = ReturnType<typeof prepareLinearSpatialEffectV1>;
type Color = ReturnType<typeof prepareLinearColorEffectsV1>;
type Reference = NonNullable<ReturnType<typeof cubeLutProfileResourceRequirementV1>>;
export type LinearDevelopStageV1 = Readonly<{ kind: 'geometry'; plan: Geometry }>
	| Readonly<{ kind: 'lens-distortion'; plan: ReturnType<typeof prepareLinearLensDistortionV1> }>
	| Readonly<{ kind: 'spatial'; id: string; plan: Spatial }>
	| Readonly<{ kind: 'color'; id: string; effects: Color }>
	| Readonly<{ kind: 'lut'; id: string; reference: Reference; grade: ReturnType<typeof normalizeVideoColorGradeV1> }>
	| Readonly<{ kind: 'noop'; id: string }>;

/** Complete closed recipe, resources and simultaneous native plane budget are
 * planned before the frame's pixels property is admitted. The original single
 * plane foundation keeps its separate 512 MiB contract. */
export function prepareLinearDevelopCurrentV1(value: unknown, profileValue: ImageDevelopFrameProfile, optionsValue: ImageDevelopFrameOptionsV3) {
	const metadata = prepareLinearDevelopMetadataCurrentV1(value, profileValue, optionsValue);
	const { develop, profile, descriptor } = metadata;
	// Metadata alone cannot authorize a pixel write. Only the actual native
	// preparers create the private identities consumed by their stage writers.
	const repairPlan = develop.processVersion === 3 ? prepareLinearRepairsV1(develop.repairs, descriptor, profile.render) : undefined;
	const repairs = metadata.repairs ? repairPlan : undefined;
	const stages: LinearDevelopStageV1[] = [];
	let current = descriptor;
	for (const stage of metadata.stages) {
		switch (stage.kind) {
			case 'lens-distortion': stages.push(Object.freeze({ kind: 'lens-distortion', plan: prepareLinearLensDistortionV1(stage.amount, current, profile.render) })); break;
			case 'geometry': {
				const plan = prepareLinearGeometryV1(stage.geometry, current, profile.render);
				stages.push(Object.freeze({ kind: 'geometry', plan })); current = plan.descriptor; break;
			}
			case 'spatial': {
				const plan = prepareLinearSpatialEffectV1(stage.effect, current);
				stages.push(stage.active ? Object.freeze({ kind: 'spatial', id: stage.effect.id, plan }) : Object.freeze({ kind: 'noop', id: stage.effect.id })); break;
			}
			case 'lut': stages.push(Object.freeze({ kind: 'lut', id: stage.id, reference: stage.reference,
				grade: normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), lut: stage.reference }) })); break;
			case 'color': stages.push(Object.freeze({ kind: 'color', id: stage.effect.id, effects: prepareLinearColorEffectsV1([stage.effect]) })); break;
			case 'noop': stages.push(stage); break;
		}
	}
	return { ...metadata, repairs, stages: Object.freeze(stages) };
}

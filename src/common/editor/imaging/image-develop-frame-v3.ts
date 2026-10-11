/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import type { ImageDevelopStateV3 } from './image-develop-state-v3.ts';
import { normalizeImageDevelopStateCurrentV1 } from './image-develop-state-current-v1.ts';
import { normalizeImageDevelopStateV2 } from './image-develop-state-v2.ts';
import { planImageDevelopRepairSpotsV1 } from './image-develop-repair-plan-v1.ts';
import { withRepairSpotsPixelFrameV1 } from './pixel-frame-repair-spots-v1.ts';
import { withCubeLutProfilePixelFrameV1 } from './pixel-frame-cube-lut-profile-v1.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1, prepareCubeLutProfileResourcePlanV1, cubeLutProfileResourceRequirementV1 } from '../video-cube-lut-profile-v1.ts';
import type { CubeLutSourcePortV1 } from './cube-lut-source-port-v1.ts';
import { captureMaskRasterSourceV1 } from './mask-raster-source-scope-v1.ts';
import { admitImageDevelopBrushMaskAuthorityV1 } from './image-develop-brush-mask-v1.ts';
import { withImageDevelopFrameCore, type ImageDevelopFrameProfile, type ImageDevelopFrameViewV1 } from './image-develop-frame-core.ts';
import { captureImageDevelopCubeLutSourceV2, type ImageDevelopFrameOptionsV2 } from './image-develop-frame-v2.ts';

export type ImageDevelopFrameOptionsV3 = ImageDevelopFrameOptionsV2;

/** Process3 explicitly owns an original-space repair prepass. The full recipe
 * is admitted first; its process2 execution projection is private and never a
 * persisted downgrade. Kernel snapshot, scratch and output retirement join
 * before the one staged copy becomes current or any brush body is borrowed. */
export function withImageDevelopFrameV3<Result>(value: unknown,
	consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>,
	profile: ImageDevelopFrameProfile, optionsValue: ImageDevelopFrameOptionsV3 = {}): Promise<Result> {
	let develop: Readonly<ImageDevelopStateV3> | undefined;
	let rawSource: unknown, rawMaskSource: unknown;
	let captured: Readonly<CubeLutSourcePortV1> | undefined;
	return withImageDevelopFrameCore(value, consume, profile, {
		normalizeDevelop(value) {
			const current = normalizeImageDevelopStateCurrentV1(value);
			if (current.processVersion !== 3) return current;
			develop = current;
			return normalizeImageDevelopStateV2({ processVersion: 2, effects: develop.effects, geometry: develop.geometry,
				masks: develop.masks, maskBindings: develop.maskBindings });
		},
		hasOriginalStage: () => develop !== undefined,
		prepareRequestOptions() {
			const options = record(optionsValue, 'repair develop resource options', ['source', 'maskSource'], []);
			rawSource = Object.hasOwn(options, 'source') ? field(options, 'source', 'repair develop LUT source') : undefined;
			rawMaskSource = Object.hasOwn(options, 'maskSource') ? field(options, 'maskSource', 'repair develop brush source') : undefined;
		},
		prepareMaskSource(value) {
			if (rawMaskSource === undefined) return undefined;
			admitImageDevelopBrushMaskAuthorityV1(value);
			return captureMaskRasterSourceV1(rawMaskSource);
		},
		prepareResourceStage(effect) {
			if (effect.type !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) return undefined;
			const reference = cubeLutProfileResourceRequirementV1(prepareCubeLutProfileResourcePlanV1(effect));
			if (reference === null) return null;
			captured ??= captureImageDevelopCubeLutSourceV2(rawSource);
			const source = captured;
			return (frame, signal, limits, accept) => withCubeLutProfilePixelFrameV1({ frame, effect, signal }, accept, { limits, source });
		},
		prepareOriginalStage(descriptor, limits) {
			if (!develop) throw new Error('Repair prepass requires an admitted process3 recipe.');
			const repairs = develop.repairs;
			// Complete source/work quotas precede even the raw pixels descriptor.
			planImageDevelopRepairSpotsV1(repairs, descriptor.width, descriptor.height);
			return (frame, signal, accept) => withRepairSpotsPixelFrameV1({ frame, repairs, signal }, repaired => {
				if (!(repaired.pixels instanceof Uint8Array || repaired.pixels instanceof Uint8ClampedArray)) {
					throw new TypeError('Repair prepass must produce native UNORM8 pixels.');
				}
				accept({ descriptor: repaired.descriptor, pixels: repaired.pixels });
			}, { limits });
		},
	});
}

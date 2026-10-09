/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { withCubeLutProfilePixelFrameV1 } from '../../common/editor/imaging/pixel-frame-cube-lut-profile-v1.ts';
import type { CubeLutSourcePortV1 } from '../../common/editor/imaging/cube-lut-source-port-v1.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1, prepareCubeLutProfileResourcePlanV1, cubeLutProfileResourceRequirementV1 } from '../../common/editor/video-cube-lut-profile-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../../common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { capturePhotoCubeLutSource } from './photo-cube-lut-source-binding.ts';
import { withPhotoDevelopFrameCore, PHOTO_DEVELOP_PROXY_LIMITS_V1, type PhotoDevelopFrameProfile, type PhotoDevelopFrameViewV1 } from './photo-develop-frame-core.ts';

export interface PhotoDevelopFrameOptionsV2 { readonly source?: CubeLutSourcePortV1 }

/** Current process1/2 proxy admission; the source capability is runtime-only. */
export function withPhotoDevelopProxyFrameV2<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopFrameViewV1>) => Result | Promise<Result>, options: PhotoDevelopFrameOptionsV2 = {}): Promise<Result> {
	return render(value, consume, PHOTO_DEVELOP_PROXY_LIMITS_V1, options);
}

export function withPhotoDevelopFullResolutionFrameV2<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopFrameViewV1>) => Result | Promise<Result>, options: PhotoDevelopFrameOptionsV2 = {}): Promise<Result> {
	return render(value, consume, PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1, options);
}

async function render<Result>(value: unknown, consume: (view: Readonly<PhotoDevelopFrameViewV1>) => Result | Promise<Result>,
	profile: PhotoDevelopFrameProfile, optionsValue: PhotoDevelopFrameOptionsV2): Promise<Result> {
	let rawSource: unknown;
	let captured: Readonly<CubeLutSourcePortV1> | undefined;
	return withPhotoDevelopFrameCore(value, consume, profile, {
		normalizeDevelop: normalizeImageDevelopStateV1OrV2,
		prepareRequestOptions() {
			const options = record(optionsValue, 'Photo develop resource options', ['source'], []);
			rawSource = Object.hasOwn(options, 'source') ? field(options, 'source', 'Photo develop resource source') : undefined;
		},
		prepareResourceStage(effect) {
			if (effect.type !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) return undefined;
			const reference = cubeLutProfileResourceRequirementV1(prepareCubeLutProfileResourcePlanV1(effect));
			if (reference === null) return null;
			// Capture before any pixel stage awaits, including stages earlier in the stack.
			captured ??= capturePhotoCubeLutSource(rawSource);
			const source = captured;
			return (frame, signal, limits, accept) => withCubeLutProfilePixelFrameV1({ frame, effect, signal }, accept, { limits, source });
		},
	});
}

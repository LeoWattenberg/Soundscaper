/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeImageDevelopStateV1OrV2 } from './image-develop-state-v2.ts';
import { withCubeLutProfilePixelFrameV1 } from './pixel-frame-cube-lut-profile-v1.ts';
import type { CubeLutSourcePortV1 } from './cube-lut-source-port-v1.ts';
import type { MaskRasterSourcePortV1 } from './mask-raster-source-port-v1.ts';
import { captureMaskRasterSourceV1 } from './mask-raster-source-scope-v1.ts';
import { admitImageDevelopBrushMaskAuthorityV1 } from './image-develop-brush-mask-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../cube-lut-reference-contract.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1, prepareCubeLutProfileResourcePlanV1, cubeLutProfileResourceRequirementV1 } from '../video-cube-lut-profile-v1.ts';
import { withImageDevelopFrameCore, type ImageDevelopFrameProfile, type ImageDevelopFrameViewV1 } from './image-develop-frame-core.ts';

export interface ImageDevelopFrameOptionsV2 {
	readonly source?: CubeLutSourcePortV1;
	readonly maskSource?: MaskRasterSourcePortV1;
}

/** Preserve the caller's actual source receiver while pinning its own method before awaits. */
export function captureImageDevelopCubeLutSourceV2(value: unknown): Readonly<CubeLutSourcePortV1> {
	if (!value || typeof value !== 'object') throw new TypeError('An active Photo LUT requires a resource source.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'withBytes');
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Photo LUT source requires an own withBytes method.');
	const method = descriptor.value as CubeLutSourcePortV1['withBytes'];
	return Object.freeze({ withBytes<Result>(reference: Readonly<VideoCubeLutReferenceV1>,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
		return Reflect.apply(method, value, [reference, consume, options]) as Promise<Result>;
	} });
}

/** Shared natural-size process1/2 owner; hosts supply their existing fixed capacity profile. */
export async function withImageDevelopFrameV2<Result>(value: unknown, consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>,
	profile: ImageDevelopFrameProfile, optionsValue: ImageDevelopFrameOptionsV2 = {}): Promise<Result> {
	let rawSource: unknown;
	let rawMaskSource: unknown;
	let captured: Readonly<CubeLutSourcePortV1> | undefined;
	return withImageDevelopFrameCore(value, consume, profile, {
		normalizeDevelop: normalizeImageDevelopStateV1OrV2,
		prepareRequestOptions() {
			const options = record(optionsValue, 'Photo develop resource options', ['source', 'maskSource'], []);
			rawSource = Object.hasOwn(options, 'source') ? field(options, 'source', 'Photo develop resource source') : undefined;
			rawMaskSource = Object.hasOwn(options, 'maskSource') ? field(options, 'maskSource', 'Photo develop brush source') : undefined;
		},
		prepareMaskSource(develop) {
			if (rawMaskSource === undefined) return undefined;
			admitImageDevelopBrushMaskAuthorityV1(develop);
			return captureMaskRasterSourceV1(rawMaskSource);
		},
		prepareResourceStage(effect) {
			if (effect.type !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) return undefined;
			const reference = cubeLutProfileResourceRequirementV1(prepareCubeLutProfileResourcePlanV1(effect));
			if (reference === null) return null;
			// Capture before any pixel stage awaits, including stages earlier in the stack.
			captured ??= captureImageDevelopCubeLutSourceV2(rawSource);
			const source = captured;
			return (frame, signal, limits, accept) => withCubeLutProfilePixelFrameV1({ frame, effect, signal }, accept, { limits, source });
		},
	});
}

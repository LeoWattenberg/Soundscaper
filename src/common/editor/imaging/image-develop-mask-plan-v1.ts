/* SPDX-License-Identifier: AGPL-3.0-only */

import { IMAGE_DEVELOP_LIMITS_V1 } from './image-develop-contract-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from './image-develop-state-v2.ts';
import { planPixelFrameV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { planImageGeometryV1 } from './image-geometry-plan-v1.ts';
import type { ImageGeometryV1 } from './image-geometry-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../video-image-geometry-v1.ts';
import { videoMaskMatteWorkingBytesV1, VIDEO_MASK_MATTE_WORKING_LIMIT_V1, type VideoMaskMatteGraphV1 } from '../video-mask-matte-v24.ts';

export const IMAGE_DEVELOP_MASK_WORKING_LIMIT_V1 = VIDEO_MASK_MATTE_WORKING_LIMIT_V1;
export interface ImageDevelopMaskBindingPlanV1 {
	readonly effectId: string;
	readonly maskId: string;
	readonly width: number;
	readonly height: number;
	readonly graph: Readonly<VideoMaskMatteGraphV1>;
	readonly workingBytes: number;
	readonly suffixGeometry: readonly Readonly<ImageGeometryV1>[];
}
export interface ImageDevelopMaskPlanV1 {
	readonly width: number;
	readonly height: number;
	readonly maximumWorkingBytes: number;
	readonly bindings: readonly Readonly<ImageDevelopMaskBindingPlanV1>[];
}

/** Refuse unsupported authority without inspecting any source frame. */
export function admitImageDevelopMaskAuthorityV1(developValue: unknown) {
	const develop = normalizeImageDevelopStateV1OrV2(developValue);
	if (develop.masks.some(graph => graph.inputs.length)) throw new RangeError('External mask inputs require authenticated media authority.');
	const bound = new Set(develop.maskBindings.map(binding => binding.effectId));
	if (develop.effects.some(effect => effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 && bound.has(effect.id))) {
		throw new RangeError('Geometry effects cannot bind a local adjustment mask.');
	}
	return develop;
}

/** Admit complete recipe authority and every stage before any mask/frame allocation.
 * Graphs execute serially. Each reachable byte plane and the largest feather
 * scratch span must fit this separate fixed budget; graph count is not heap proof. */
export function planImageDevelopMasksV1(developValue: unknown, sourceWidth: number, sourceHeight: number,
	renderLimits: PixelFrameLimitsV1): Readonly<ImageDevelopMaskPlanV1> {
	const develop = admitImageDevelopMaskAuthorityV1(developValue);
	return planAdmittedImageDevelopMasksV1(develop, sourceWidth, sourceHeight, renderLimits);
}

/** Scalar stage planning creates no external-input or resource-body authority.
 * Explicit resource hosts perform their own complete admission before using it. */
export function planAdmittedImageDevelopMasksV1(developValue: unknown, sourceWidth: number, sourceHeight: number,
	renderLimits: PixelFrameLimitsV1): Readonly<ImageDevelopMaskPlanV1> {
	const develop = normalizeImageDevelopStateV1OrV2(developValue);
	const serialized = JSON.stringify(develop);
	if (serialized.length > IMAGE_DEVELOP_LIMITS_V1.maximumBytes || new TextEncoder().encode(serialized).byteLength > IMAGE_DEVELOP_LIMITS_V1.maximumBytes) {
		throw new RangeError('Develop mask settings exceed their byte budget.');
	}
	const bound = new Map(develop.maskBindings.map(binding => [binding.effectId, binding.maskId]));
	let width = sourceWidth, height = sourceHeight;
	const admit = () => planPixelFrameV1({ schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, renderLimits);
	admit();
	const geometries: Readonly<ImageGeometryV1>[] = [];
	const pending: { effectId: string; maskId: string; width: number; height: number; graph: VideoMaskMatteGraphV1; workingBytes: number; suffixStart: number }[] = [];
	const apply = (geometry: Readonly<ImageGeometryV1>) => {
		const plan = planImageGeometryV1(geometry, width, height); width = plan.width; height = plan.height; admit(); geometries.push(geometry);
	};
	const legacy = develop.geometry;
	if (legacy.crop !== null || legacy.rotationDegrees !== 0 || legacy.flipHorizontal || legacy.flipVertical) apply({ schemaVersion: 1, ...legacy, perspective: null });
	for (const effect of develop.effects) {
		const maskId = bound.get(effect.id);
		if (maskId !== undefined) {
			const graph = develop.masks.find(candidate => candidate.id === maskId)!;
			pending.push({ effectId: effect.id, maskId, width, height, graph, workingBytes: videoMaskMatteWorkingBytesV1(graph, width, height), suffixStart: geometries.length });
		}
		if (effect.enabled && effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) apply(imageGeometryForVideoEffectV1(effect, width, height));
	}
	const bindings = pending.map(({ suffixStart, ...binding }) => Object.freeze({ ...binding, suffixGeometry: Object.freeze(geometries.slice(suffixStart)) }));
	return Object.freeze({ width, height, maximumWorkingBytes: Math.max(0, ...bindings.map(binding => binding.workingBytes)), bindings: Object.freeze(bindings) });
}

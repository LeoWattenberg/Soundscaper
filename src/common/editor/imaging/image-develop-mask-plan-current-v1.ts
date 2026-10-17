/* SPDX-License-Identifier: AGPL-3.0-only */

import { LENS_DISTORTION_EFFECT_TYPE_V1, prepareLensDistortionEffectV1 } from '../video-lens-distortion-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../video-image-geometry-v1.ts';
import { prepareImageDevelopBrushMasksV1, admitImageDevelopBrushMaskAuthorityV1, type PreparedImageDevelopBrushMasksV1 } from './image-develop-brush-mask-v1.ts';
import { admitImageDevelopMaskAuthorityV1, IMAGE_DEVELOP_MASK_WORKING_LIMIT_V1, type ImageDevelopMaskBindingPlanV1 } from './image-develop-mask-plan-v1.ts';
import { prepareImageDevelopMaskOverlaySelectionV1, type ImageDevelopMaskOverlaySelectionV1 } from './image-develop-mask-overlay-v1.ts';
import { planImageGeometryV1 } from './image-geometry-plan-v1.ts';
import type { ImageGeometryV1 } from './image-geometry-v1.ts';
import { planImageLensDistortionV1 } from './image-lens-distortion-plan-v1.ts';
import type { PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export type ImageDevelopMaskTransformCurrentV1 = Readonly<{ kind: 'geometry'; geometry: Readonly<ImageGeometryV1> }>
	| Readonly<{ kind: 'lens-distortion'; amount: number }>;
const TRANSFORMS = new WeakMap<Readonly<ImageDevelopMaskBindingPlanV1>, readonly ImageDevelopMaskTransformCurrentV1[]>();

/** The permanent binding/geometry wire stays unchanged. Only bindings produced
 * by this fixed Current planner own the additional ordered warp transport. */
export function imageDevelopMaskTransformsCurrentV1(binding: Readonly<ImageDevelopMaskBindingPlanV1>): readonly ImageDevelopMaskTransformCurrentV1[] {
	const transforms = TRANSFORMS.get(binding);
	if (!transforms) throw new TypeError('Current mask projection requires its admitted binding.');
	return transforms;
}

export function admitImageDevelopMaskAuthorityCurrentV1(value: unknown, brush: boolean) {
	const develop = brush ? admitImageDevelopBrushMaskAuthorityV1(value) : admitImageDevelopMaskAuthorityV1(value);
	const bound = new Set(develop.maskBindings.map(binding => binding.effectId));
	if (develop.effects.some(effect => effect.type === LENS_DISTORTION_EFFECT_TYPE_V1 && bound.has(effect.id))) {
		throw new RangeError('Lens distortion effects cannot bind a local adjustment mask.');
	}
	return develop;
}

/** Reuse the complete legacy brush declaration/body quota authority. A radial
 * warp preserves extent, so all existing effect-input extents remain exact. */
export function prepareImageDevelopBrushMasksCurrentV1(value: unknown, width: number, height: number,
	limits: PixelFrameLimitsV1, selectionValue?: Readonly<ImageDevelopMaskOverlaySelectionV1>): Readonly<PreparedImageDevelopBrushMasksV1> {
	const develop = admitImageDevelopMaskAuthorityCurrentV1(value, true);
	const base = prepareImageDevelopBrushMasksV1(develop, width, height, limits);
	const transforms: ImageDevelopMaskTransformCurrentV1[] = [], starts = new Map<string, number>();
	let currentWidth = width, currentHeight = height;
	const geometry = (value: Readonly<ImageGeometryV1>) => {
		const next = planImageGeometryV1(value, currentWidth, currentHeight); currentWidth = next.width; currentHeight = next.height;
		transforms.push(Object.freeze({ kind: 'geometry', geometry: value }));
	};
	const legacy = develop.geometry;
	if (legacy.crop !== null || legacy.rotationDegrees !== 0 || legacy.flipHorizontal || legacy.flipVertical) geometry({ schemaVersion: 1, ...legacy, perspective: null });
	for (const effect of develop.effects) {
		starts.set(effect.id, transforms.length);
		if (effect.type === LENS_DISTORTION_EFFECT_TYPE_V1) {
			const lens = prepareLensDistortionEffectV1(effect);
			planImageLensDistortionV1(lens.amount, currentWidth, currentHeight);
			if (lens.enabled && !lens.neutral) transforms.push(Object.freeze({ kind: 'lens-distortion', amount: lens.amount }));
		} else if (effect.enabled && effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) geometry(imageGeometryForVideoEffectV1(effect, currentWidth, currentHeight));
	}
	const bindings = base.plan.bindings.map(binding => {
		const current = Object.freeze({ ...binding });
		TRANSFORMS.set(current, Object.freeze(transforms.slice(starts.get(binding.effectId)!))); return current;
	});
	const plan = Object.freeze({ ...base.plan, bindings: Object.freeze(bindings) });
	const selection = selectionValue === undefined ? undefined : prepareImageDevelopMaskOverlaySelectionV1(selectionValue);
	const selected = selection && bindings.find(binding => binding.maskId === selection.maskId && binding.effectId === selection.effectId);
	if (selection && !selected) throw new RangeError('Mask overlay requires one retained mask/effect binding.');
	// Without an overlay the old peak is exactly resources + graph residency.
	// Preserve that authenticated-resource charge, then add the actual Current
	// projection peak instead of double-counting the old geometry scratch.
	const resources = BigInt(base.peakWorkingBytes - base.plan.maximumWorkingBytes);
	let graph = BigInt(plan.maximumWorkingBytes), presentation = 0n;
	if (selected) {
		const retained = BigInt(plan.width) * BigInt(plan.height);
		graph += projectionScratch(selected) + retained; presentation = retained * 5n;
		assertImageDevelopMaskOverlayBudgetCurrentV1(selected, Number(retained));
	}
	const peak = resources + (graph > presentation ? graph : presentation);
	if (peak > BigInt(IMAGE_DEVELOP_MASK_WORKING_LIMIT_V1)) throw new RangeError('Current brush mask coverage exceeds its 64 MiB working budget.');
	return Object.freeze({ ...base, plan, peakWorkingBytes: Number(peak) });
}

export function assertImageDevelopMaskOverlayBudgetCurrentV1(binding: Readonly<ImageDevelopMaskBindingPlanV1>, retainedBytes = 0): void {
	if (!Number.isSafeInteger(retainedBytes) || retainedBytes < 0) throw new RangeError('Current mask projection requires a bounded retained-byte charge.');
	if (BigInt(binding.workingBytes) + projectionScratch(binding) + BigInt(retainedBytes) > BigInt(IMAGE_DEVELOP_MASK_WORKING_LIMIT_V1)) {
		throw new RangeError('Current mask overlay projection exceeds its 64 MiB working byte budget.');
	}
}
function projectionScratch(binding: Readonly<ImageDevelopMaskBindingPlanV1>): bigint {
	const transforms = imageDevelopMaskTransformsCurrentV1(binding);
	let width = binding.width, height = binding.height, largest = BigInt(width) * BigInt(height);
	for (const transform of transforms) {
		if (transform.kind === 'geometry') { const next = planImageGeometryV1(transform.geometry, width, height); width = next.width; height = next.height; }
		else planImageLensDistortionV1(transform.amount, width, height);
		const pixels = BigInt(width) * BigInt(height); if (pixels > largest) largest = pixels;
	}
	return transforms.length ? largest * 13n : 0n;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { IMAGE_DEVELOP_REPAIR_LIMITS_V1 as LIMITS, normalizeImageDevelopRepairSpotsV1,
	type ImageDevelopRepairPointV1, type ImageDevelopRepairSpotV1, type ImageDevelopRepairSpotsV1 } from './image-develop-repair-spots-v1.ts';

export interface ImageDevelopRepairRectangleV1 {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}
export interface ImageDevelopRepairSpotPlanV1 {
	readonly spot: Readonly<ImageDevelopRepairSpotV1>;
	readonly target: Readonly<ImageDevelopRepairPointV1>;
	readonly sourceDelta: Readonly<ImageDevelopRepairPointV1>;
	readonly radius: number;
	readonly rectangle: Readonly<ImageDevelopRepairRectangleV1>;
	readonly halo: Readonly<ImageDevelopRepairRectangleV1> | null;
}
export interface ImageDevelopRepairPlanV1 {
	readonly repairs: Readonly<ImageDevelopRepairSpotsV1>;
	readonly width: number;
	readonly height: number;
	readonly spots: readonly Readonly<ImageDevelopRepairSpotPlanV1>[];
	readonly cloneVisits: number;
	readonly healRelaxations: number;
	readonly maximumScratchBytes: number;
	readonly kernelWorkingBytes: number;
	readonly stageWorkingBytes: number;
}

/** Bounded scalar metadata only; pixels and native decoder storage belong to
 * the caller. Public kernels additionally admit their owning frame profile. */
export function planImageDevelopRepairSpotsV1(value: unknown, width: number, height: number): Readonly<ImageDevelopRepairPlanV1> {
	const repairs = normalizeImageDevelopRepairSpotsV1(value);
	dimension(width, 'width'); dimension(height, 'height');
	const maximumPixels = LIMITS.maximumSourceBytes / 4;
	if (width > maximumPixels || height > maximumPixels || width > Math.floor(maximumPixels / height)) {
		throw new RangeError('Image repair source exceeds its 64 MiB pixel budget.');
	}
	const frameBytes = width * height * 4;
	const spots = Object.freeze(repairs.spots.map(spot => planSpot(spot, width, height)));
	let cloneVisits = 0, healRelaxations = 0, maximumScratchBytes = 0;
	for (const candidate of spots) {
		if (!candidate.spot.enabled || candidate.spot.opacity === 0 || !candidate.rectangle.width || !candidate.rectangle.height) continue;
		if (candidate.spot.mode === 'clone') {
			cloneVisits += candidate.rectangle.width * candidate.rectangle.height;
			if (cloneVisits > LIMITS.maximumCloneVisits) throw new RangeError('Image repair Clone work exceeds its pixel visit budget.');
		} else {
			const halo = candidate.halo!;
			if (halo.width > LIMITS.maximumHealHaloSide || halo.height > LIMITS.maximumHealHaloSide) {
				throw new RangeError('Image repair Heal halo exceeds its 512-pixel side budget.');
			}
			const pixels = halo.width * halo.height;
			healRelaxations += pixels * LIMITS.healIterations;
			if (healRelaxations > LIMITS.maximumHealRelaxations) throw new RangeError('Image repair Heal work exceeds its relaxation budget.');
			maximumScratchBytes = Math.max(maximumScratchBytes, pixels * LIMITS.scratchBytesPerPixel + LIMITS.scratchControlBytes);
		}
	}
	const kernelWorkingBytes = frameBytes * 2 + maximumScratchBytes, stageWorkingBytes = frameBytes * 4 + maximumScratchBytes;
	if (maximumScratchBytes > LIMITS.maximumScratchBytes || stageWorkingBytes > LIMITS.maximumStageWorkingBytes) {
		throw new RangeError('Image repair exceeds its working byte budget.');
	}
	return Object.freeze({ repairs, width, height, spots, cloneVisits, healRelaxations, maximumScratchBytes, kernelWorkingBytes, stageWorkingBytes });
}

function dimension(value: number, name: string): void {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new RangeError(`Image repair ${name} requires a positive safe integer.`);
}

function planSpot(spot: Readonly<ImageDevelopRepairSpotV1>, width: number, height: number): Readonly<ImageDevelopRepairSpotPlanV1> {
	const target = Object.freeze({ x: spot.target.x * width, y: spot.target.y * height });
	const sourceDelta = Object.freeze({ x: spot.source.x * width - target.x, y: spot.source.y * height - target.y });
	const radius = spot.radius * Math.min(width, height);
	const left = clip(Math.ceil(target.x - radius - 0.5), width), right = clip(Math.floor(target.x + radius - 0.5) + 1, width);
	const top = clip(Math.ceil(target.y - radius - 0.5), height), bottom = clip(Math.floor(target.y + radius - 0.5) + 1, height);
	const rectangle = Object.freeze({ x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) });
	const halo = spot.mode === 'heal' && rectangle.width && rectangle.height ? expanded(rectangle, width, height) : null;
	return Object.freeze({ spot, target, sourceDelta, radius, rectangle, halo });
}

function expanded(value: Readonly<ImageDevelopRepairRectangleV1>, width: number, height: number): Readonly<ImageDevelopRepairRectangleV1> {
	const x = Math.max(0, value.x - 1), y = Math.max(0, value.y - 1);
	return Object.freeze({ x, y, width: Math.min(width, value.x + value.width + 1) - x, height: Math.min(height, value.y + value.height + 1) - y });
}
function clip(value: number, maximum: number): number { return Math.max(0, Math.min(maximum, value)); }

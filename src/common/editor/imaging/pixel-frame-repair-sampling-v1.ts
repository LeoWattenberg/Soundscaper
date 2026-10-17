/* SPDX-License-Identifier: AGPL-3.0-only */

import { createManagedSdrLinearByteEncoderV1 } from '../video-color-byte-encoding.ts';
import type { ImageDevelopRepairSpotPlanV1 } from './image-develop-repair-plan-v1.ts';

export interface RepairLinearSampleV1 { red: number; green: number; blue: number; alpha: number; }
export const encodeRepairLinearByteV1 = createManagedSdrLinearByteEncoderV1('srgb');

/** The admitted source is encoded sRGB; no RGB lookup/whole-frame plane is kept. */
export function decodeRepairByteV1(byte: number): number {
	const value = byte / 255;
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Transparent missing taps, linear RGB premultiplied by donor alpha while filtering. */
export function sampleRepairDonorV1(original: Uint8Array<ArrayBuffer>, width: number, height: number,
	x: number, y: number, sample: RepairLinearSampleV1): void {
	const left = Math.floor(x - 0.5), top = Math.floor(y - 0.5);
	const fx = x - 0.5 - left, fy = y - 0.5 - top;
	let alpha = 0, red = 0, green = 0, blue = 0;
	for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
		const sx = left + dx, sy = top + dy;
		if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
		const offset = (sy * width + sx) * 4;
		const weight = (dx === 0 ? 1 - fx : fx) * (dy === 0 ? 1 - fy : fy) * original[offset + 3]! / 255;
		if (weight === 0) continue;
		alpha += weight; red += decodeRepairByteV1(original[offset]!) * weight;
		green += decodeRepairByteV1(original[offset + 1]!) * weight; blue += decodeRepairByteV1(original[offset + 2]!) * weight;
	}
	sample.alpha = alpha;
	sample.red = alpha === 0 ? 0 : red / alpha;
	sample.green = alpha === 0 ? 0 : green / alpha;
	sample.blue = alpha === 0 ? 0 : blue / alpha;
}

export function repairCoverageV1(plan: ImageDevelopRepairSpotPlanV1, x: number, y: number): number {
	const distance = Math.hypot(x - plan.target.x, y - plan.target.y);
	if (distance > plan.radius) return 0;
	if (plan.spot.feather === 0) return 1;
	const core = (1 - plan.spot.feather) * plan.radius;
	return distance <= core ? 1 : Math.max(0, (plan.radius - distance) / (plan.radius - core));
}

/** Only destination RGB is ordered. Original target alpha/hidden RGB are retained. */
export function blendRepairSampleV1(output: Uint8Array<ArrayBuffer>, offset: number,
	sample: RepairLinearSampleV1, amount: number): void {
	if (output[offset + 3] === 0 || sample.alpha === 0 || amount === 0) return;
	const weight = Math.max(0, Math.min(1, amount * sample.alpha));
	if (weight === 0) return;
	const beforeRed = decodeRepairByteV1(output[offset]!);
	const beforeGreen = decodeRepairByteV1(output[offset + 1]!);
	const beforeBlue = decodeRepairByteV1(output[offset + 2]!);
	output[offset] = encodeRepairLinearByteV1(clamp(beforeRed + weight * (clamp(sample.red) - beforeRed)));
	output[offset + 1] = encodeRepairLinearByteV1(clamp(beforeGreen + weight * (clamp(sample.green) - beforeGreen)));
	output[offset + 2] = encodeRepairLinearByteV1(clamp(beforeBlue + weight * (clamp(sample.blue) - beforeBlue)));
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }

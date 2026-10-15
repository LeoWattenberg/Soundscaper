/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { planImageLensDistortionV1, writeImageLensDistortionPointV1, type ImageLensDistortionPlanV1 } from './image-lens-distortion-plan-v1.ts';
import { captureLinearKernelDescriptorV1, captureLinearKernelPlanesV1, writeLinearKernelPixelV1, type LinearKernelDescriptorV1 } from './linear-kernel-planes-v1.ts';
import { planPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface PreparedLinearLensDistortionV1 {
	readonly descriptor: LinearKernelDescriptorV1;
	readonly sampleCount: number;
	readonly byteLength: number;
	readonly scratchBytes: 0;
	readonly neutral: boolean;
}
const PLANS = new WeakMap<PreparedLinearLensDistortionV1, Readonly<{ descriptor: LinearKernelDescriptorV1; mapping: Readonly<ImageLensDistortionPlanV1> }>>();

/** No sample access or allocation: caller owns both admitted native planes. */
export function prepareLinearLensDistortionV1(amountValue: unknown, descriptorValue: PixelFrameDescriptorV1,
	limits: PixelFrameLimitsV1): Readonly<PreparedLinearLensDistortionV1> {
	const descriptor = captureLinearKernelDescriptorV1(descriptorValue), output = planPixelFrameV1(descriptor, limits);
	const mapping = planImageLensDistortionV1(amountValue, descriptor.width, descriptor.height);
	const plan = Object.freeze({ descriptor, sampleCount: output.sampleCount, byteLength: output.byteLength, scratchBytes: 0 as const, neutral: mapping.neutral });
	PLANS.set(plan, Object.freeze({ descriptor, mapping })); return plan;
}

/** Dedicated disjoint Float32 input/output, premultiplied linear interpolation,
 * straight output alpha, and transparent outside taps. No frame scratch, byte
 * conversion or owned allocation exists; outer owners join and retire planes. */
export async function writeLinearLensDistortionV1(plan: PreparedLinearLensDistortionV1, sourceValue: unknown,
	target: Float32Array<ArrayBuffer>, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue);
	let state: NonNullable<ReturnType<typeof PLANS.get>>, planes: ReturnType<typeof captureLinearKernelPlanesV1>;
	try {
		const admitted = PLANS.get(plan);
		if (!admitted) throw new TypeError('Linear lens distortion requires its original prepared plan.');
		state = admitted;
		const source = record(sourceValue, 'linear lens source', ['descriptor', 'pixels']);
		const descriptor = captureLinearKernelDescriptorV1(field(source, 'descriptor', 'linear lens source'));
		if (descriptor.width !== state.descriptor.width || descriptor.height !== state.descriptor.height || descriptor.primaries !== state.descriptor.primaries) {
			throw new RangeError('Linear lens source differs from its prepared descriptor.');
		}
		planes = captureLinearKernelPlanesV1(state.descriptor, field(source, 'pixels', 'linear lens source'), target);
	} catch (error) { checkRepairSignalV1(signal); throw error; }
	const check = () => { checkRepairSignalV1(signal); planes.check(); }; check();
	if (plan.neutral) { Float32Array.prototype.set.call(planes.target, planes.source); check(); return; }
	const { width, height } = state.mapping, point = { x: 0, y: 0 }, budget = new RepairTaskBudgetV1(check);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const offset = (y * width + x) * 4;
		if (writeImageLensDistortionPointV1(state.mapping, x + .5, y + .5, point)) sample(planes.source, planes.target, offset, width, height, point.x - .5, point.y - .5);
		else writeLinearKernelPixelV1(planes.target, offset, 0, 0, 0, 0);
		if (budget.visit()) await budget.yield();
	}
	check();
}

function sample(source: Float32Array<ArrayBuffer>, target: Float32Array<ArrayBuffer>, offset: number,
	width: number, height: number, x: number, y: number): void {
	const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
	let red = 0, green = 0, blue = 0, alpha = 0;
	for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
		const sx = ix + dx, sy = iy + dy;
		if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
		const from = (sy * width + sx) * 4, weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy), a = source[from + 3]! * weight;
		alpha += a; red += source[from]! * a; green += source[from + 1]! * a; blue += source[from + 2]! * a;
	}
	const a = Math.fround(Math.max(0, Math.min(1, alpha)));
	if (a === 0) { writeLinearKernelPixelV1(target, offset, 0, 0, 0, 0); return; }
	writeLinearKernelPixelV1(target, offset, red / alpha, green / alpha, blue / alpha, a);
}

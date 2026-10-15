/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { prepareOpticalVignetteEffectV1 } from '../video-optical-vignette-v1.ts';
import { prepareImageOpticalVignetteKernelV1, imageOpticalVignetteGainV1 } from './image-optical-vignette-kernel-v1.ts';
import { captureLinearKernelDescriptorV1, captureLinearKernelPlanesV1, writeLinearKernelPixelV1, type LinearKernelDescriptorV1 } from './linear-kernel-planes-v1.ts';
import { planPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface PreparedLinearOpticalVignetteV1 {
	readonly descriptor: LinearKernelDescriptorV1;
	readonly sampleCount: number; readonly byteLength: number;
	readonly scratchBytes: 0; readonly neutral: boolean;
}
const PLANS = new WeakMap<PreparedLinearOpticalVignetteV1, Readonly<{ descriptor: LinearKernelDescriptorV1; kernel: ReturnType<typeof prepareImageOpticalVignetteKernelV1> }>>();

export function prepareLinearOpticalVignetteV1(effectValue: unknown, descriptorValue: PixelFrameDescriptorV1,
	limits: PixelFrameLimitsV1): Readonly<PreparedLinearOpticalVignetteV1> {
	const descriptor = captureLinearKernelDescriptorV1(descriptorValue), output = planPixelFrameV1(descriptor, limits);
	const effect = prepareOpticalVignetteEffectV1(effectValue), kernel = prepareImageOpticalVignetteKernelV1(effect.amount, descriptor.width, descriptor.height);
	const plan = Object.freeze({ descriptor, sampleCount: output.sampleCount, byteLength: output.byteLength, scratchBytes: 0 as const, neutral: !effect.enabled || effect.neutral });
	PLANS.set(plan, Object.freeze({ descriptor, kernel })); return plan;
}

/** Multiply native linear RGB directly, rounding only at the Float32 stage
 * write. Source/target are dedicated disjoint caller-owned planes; the outer
 * owner joins and retires output on overflow, cancellation or other failure. */
export async function writeLinearOpticalVignetteV1(plan: PreparedLinearOpticalVignetteV1, sourceValue: unknown,
	target: Float32Array<ArrayBuffer>, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue);
	let state: NonNullable<ReturnType<typeof PLANS.get>>, planes: ReturnType<typeof captureLinearKernelPlanesV1>;
	try {
		const admitted = PLANS.get(plan);
		if (!admitted) throw new TypeError('Linear optical vignette requires its original prepared plan.');
		state = admitted;
		if (typeof sourceValue !== 'object' || sourceValue === null) throw new TypeError('Linear optical vignette requires a source frame.');
		const descriptor = captureLinearKernelDescriptorV1(field(sourceValue as Readonly<Record<string, unknown>>, 'descriptor', 'linear optical vignette source'));
		if (descriptor.width !== state.descriptor.width || descriptor.height !== state.descriptor.height || descriptor.primaries !== state.descriptor.primaries) {
			throw new RangeError('Linear optical vignette source differs from its prepared descriptor.');
		}
		const source = record(sourceValue, 'linear optical vignette source', ['descriptor', 'pixels']);
		planes = captureLinearKernelPlanesV1(state.descriptor, field(source, 'pixels', 'linear optical vignette source'), target);
	} catch (error) { checkRepairSignalV1(signal); throw error; }
	const check = () => { checkRepairSignalV1(signal); planes.check(); }; check();
	if (plan.neutral) { Float32Array.prototype.set.call(planes.target, planes.source); check(); return; }
	const { width, height } = state.descriptor, budget = new RepairTaskBudgetV1(check);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const index = (y * width + x) * 4, alpha = planes.source[index + 3]!;
		const gain = alpha === 0 ? 1 : imageOpticalVignetteGainV1(state.kernel, x, y);
		const red = planes.source[index]!, green = planes.source[index + 1]!, blue = planes.source[index + 2]!;
		writeLinearKernelPixelV1(planes.target, index, gain === 1 || red === 0 ? red : red * gain,
			gain === 1 || green === 0 ? green : green * gain, gain === 1 || blue === 0 ? blue : blue * gain, alpha);
		if (budget.visit()) await budget.yield();
	}
	check();
}

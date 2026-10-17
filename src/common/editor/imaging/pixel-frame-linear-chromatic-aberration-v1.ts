/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { planImageChromaticAberrationV1, writeImageChromaticAberrationTapsV1, type ImageChromaticAberrationPlanV1, type ImageChromaticAberrationTapsV1 } from './image-chromatic-aberration-plan-v1.ts';
import { captureLinearKernelDescriptorV1, captureLinearKernelPlanesV1, writeLinearKernelPixelV1, type LinearKernelDescriptorV1 } from './linear-kernel-planes-v1.ts';
import { planPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface PreparedLinearChromaticAberrationV1 {
	readonly descriptor: LinearKernelDescriptorV1;
	readonly sampleCount: number; readonly byteLength: number;
	readonly scratchBytes: 0; readonly neutral: boolean;
}
const PLANS = new WeakMap<PreparedLinearChromaticAberrationV1, Readonly<{ descriptor: LinearKernelDescriptorV1; mapping: Readonly<ImageChromaticAberrationPlanV1> }>>();

export function prepareLinearChromaticAberrationV1(redValue: unknown, blueValue: unknown, descriptorValue: PixelFrameDescriptorV1,
	limits: PixelFrameLimitsV1): Readonly<PreparedLinearChromaticAberrationV1> {
	const descriptor = captureLinearKernelDescriptorV1(descriptorValue), output = planPixelFrameV1(descriptor, limits);
	const mapping = planImageChromaticAberrationV1(redValue, blueValue, descriptor.width, descriptor.height);
	const plan = Object.freeze({ descriptor, sampleCount: output.sampleCount, byteLength: output.byteLength, scratchBytes: 0 as const, neutral: mapping.neutral });
	PLANS.set(plan, Object.freeze({ descriptor, mapping })); return plan;
}

/** Dedicated caller-owned planes, no scratch or encoded intermediate. R/B
 * reconstruction normalizes each channel's own alpha-weighted taps. Green,
 * original alpha and every zero-controlled channel retain exact source bits. */
export async function writeLinearChromaticAberrationV1(plan: PreparedLinearChromaticAberrationV1, sourceValue: unknown,
	target: Float32Array<ArrayBuffer>, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue);
	let state: NonNullable<ReturnType<typeof PLANS.get>>, planes: ReturnType<typeof captureLinearKernelPlanesV1>;
	try {
		const admitted = PLANS.get(plan);
		if (!admitted) throw new TypeError('Linear chromatic aberration requires its original prepared plan.');
		state = admitted;
		if (typeof sourceValue !== 'object' || sourceValue === null) throw new TypeError('Linear chromatic aberration requires a source frame.');
		const descriptor = captureLinearKernelDescriptorV1(field(sourceValue as Readonly<Record<string, unknown>>, 'descriptor', 'linear CA source'));
		if (descriptor.width !== state.descriptor.width || descriptor.height !== state.descriptor.height || descriptor.primaries !== state.descriptor.primaries) {
			throw new RangeError('Linear chromatic aberration source differs from its prepared descriptor.');
		}
		const source = record(sourceValue, 'linear CA source', ['descriptor', 'pixels']);
		planes = captureLinearKernelPlanesV1(state.descriptor, field(source, 'pixels', 'linear CA source'), target);
	} catch (error) { checkRepairSignalV1(signal); throw error; }
	const check = () => { checkRepairSignalV1(signal); planes.check(); }; check();
	if (plan.neutral) { Float32Array.prototype.set.call(planes.target, planes.source); check(); return; }
	const mapping = state.mapping, { width, height } = mapping, budget = new RepairTaskBudgetV1(check);
	const taps: ImageChromaticAberrationTapsV1 = { x: 0, y: 0, stepX: 1, stepY: 1, fractionX: 0, fractionY: 0 };
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const offset = (y * width + x) * 4;
		let red = planes.source[offset]!, blue = planes.source[offset + 2]!;
		if (mapping.red !== 0) red = writeImageChromaticAberrationTapsV1(mapping, 'red', x, y, taps)
			? sample(planes.source, 0, width, height, taps) : 0;
		if (mapping.blue !== 0) blue = writeImageChromaticAberrationTapsV1(mapping, 'blue', x, y, taps)
			? sample(planes.source, 2, width, height, taps) : 0;
		writeLinearKernelPixelV1(planes.target, offset, red, planes.source[offset + 1]!, blue, planes.source[offset + 3]!);
		if (budget.visit()) await budget.yield();
	}
	check();
}

function sample(source: Float32Array<ArrayBuffer>, channel: 0 | 2, width: number, height: number, taps: ImageChromaticAberrationTapsV1): number {
	let value = 0, alpha = 0;
	for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
		const sx = taps.x + dx * taps.stepX, sy = taps.y + dy * taps.stepY;
		if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
		const from = (sy * width + sx) * 4, weight = (dx ? taps.fractionX : 1 - taps.fractionX) * (dy ? taps.fractionY : 1 - taps.fractionY), a = source[from + 3]! * weight;
		alpha += a; value += source[from + channel]! * a;
	}
	return alpha === 0 ? 0 : value / alpha;
}
